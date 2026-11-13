// =====================================================================
//  NÚCLEO COMPARTIDO: Firebase, mapas (OpenStreetMap), motor de tarifas y despacho
// =====================================================================
import { APP, FIREBASE_CONFIG, MAPAS, OPERACION } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where,
  onSnapshot, getDocs, serverTimestamp, arrayUnion, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export { APP, MAPAS, OPERACION };
export {
  onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where,
  onSnapshot, getDocs, serverTimestamp, arrayUnion, runTransaction
};

const pendiente = v => !v || String(v).startsWith('PEGA_AQUI');
export const configurado = !pendiente(FIREBASE_CONFIG.apiKey);
export const app = configurado ? initializeApp(FIREBASE_CONFIG) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

/* ---------------------------- Utilidades ---------------------------- */
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const dinero = n => { const v = Math.round(n || 0); return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('es-MX'); };
export const hora = ms => new Date(ms).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
export const hoyISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const folio = id => APP.prefijoFolio + '-' + String(id).slice(0, 6).toUpperCase();
export const km = m => (m / 1000).toFixed(1) + ' km';
export function minutos(ms) { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; }
export const item = m => ({ t: Date.now(), m });
export const bitacora = (...ms) => arrayUnion(...ms.map(item));
export const ACTIVOS = ['buscando', 'ofrecido', 'cola', 'aceptado', 'en_origen', 'en_curso'];
export const ESTADOS = {
  buscando: ['Buscando taxi', 'b-warn'], ofrecido: ['Ofrecido', 'b-warn'], cola: ['En cola de la central', 'b-bad'],
  aceptado: ['Taxi en camino', 'b-info'], en_origen: ['Taxi en el origen', 'b-info'], en_curso: ['En viaje', 'b-navy'],
  completado: ['Completado', 'b-ok'], cancelado: ['Cancelado', 'b-mute']
};
export const badge = e => `<span class="badge ${(ESTADOS[e] || ['', 'b-mute'])[1]}">${(ESTADOS[e] || [e])[0]}</span>`;

let toastT;
export function toast(m) {
  let el = $('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = m; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3000);
}
export function bannerConfig() {
  document.body.insertAdjacentHTML('afterbegin', `<div class="banner-setup"><b>Falta configurar la plataforma.</b>
    Abre <code>js/config.js</code> y pega la configuración de Firebase (README, pasos 1 a 3).</div>`);
}

/* ---------------------------- Geometría ----------------------------- */
export function haversine(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function dentro(pt, puntos) {
  let ins = false;
  for (let i = 0, j = puntos.length - 1; i < puntos.length; j = i++) {
    const xi = puntos[i].lng, yi = puntos[i].lat, xj = puntos[j].lng, yj = puntos[j].lat;
    if (((yi > pt.lat) !== (yj > pt.lat)) && (pt.lng < (xj - xi) * (pt.lat - yi) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
}
export const zonaDe = (zonas, pt) => pt ? (zonas || []).find(z => z.puntos && z.puntos.length >= 3 && dentro(pt, z.puntos)) || null : null;
export const centroide = pts => ({ lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length });
// Estimación sin API (respaldo): distancia en línea recta × 1.35 a 30 km/h
export const estimarMs = (a, b) => haversine(a, b) * 1.35 / (30000 / 3600000);

/* -------------------------- Motor de tarifas ------------------------ */
export const TARIFAS_DEFAULT = {
  modo: 'mixto', // 'zonas' | 'km' | 'mixto' (zonas si hay tarifa registrada; si no, por kilómetro)
  km: { banderazo: 50, porKm: 18, porMin: 2, minima: 80 },
  recargos: { nocturnoPct: 20, nocturnoDesde: 22, nocturnoHasta: 6, festivoHoy: false, festivoPct: 15, fechasFestivas: [], equipaje: 50 },
  redondeo: 10,
  matriz: {},
  matrizSimetrica: true,
  zonas: [],
  segundosParaAceptar: OPERACION.segundosParaAceptar
};
export function normalizarTarifas(d = {}) {
  return {
    ...TARIFAS_DEFAULT, ...d,
    km: { ...TARIFAS_DEFAULT.km, ...(d.km || {}) },
    recargos: { ...TARIFAS_DEFAULT.recargos, ...(d.recargos || {}) },
    matriz: d.matriz || {}, zonas: d.zonas || []
  };
}
export const escucharTarifas = cb => onSnapshot(doc(db, 'config', 'tarifas'),
  s => cb(normalizarTarifas(s.exists() ? s.data() : {})),
  e => { console.error(e); cb(normalizarTarifas({})); });

export function esNocturno(cfg, fecha = new Date()) {
  const h = fecha.getHours(), f = +cfg.recargos.nocturnoDesde, t = +cfg.recargos.nocturnoHasta;
  if (f === t) return false;
  return f > t ? (h >= f || h < t) : (h >= f && h < t);
}
export const esFestivo = (cfg, fecha = new Date()) => !!cfg.recargos.festivoHoy || (cfg.recargos.fechasFestivas || []).includes(hoyISO(fecha));

/**
 * Calcula la tarifa fija de un viaje según lo que configuró la central.
 * @returns {{ok:boolean,total:number,items:{l:string,v:number}[],modo:string,zonaO:string|null,zonaD:string|null,mensaje?:string}}
 */
export function cotizar(cfg, { o, d, distM = 0, durMs = 0, equipaje = 0, fecha = new Date() }) {
  const zo = zonaDe(cfg.zonas, o), zd = zonaDe(cfg.zonas, d);
  const items = []; let base, modo;
  const deZona = zo && zd ? +cfg.matriz[zo.id + '|' + zd.id] : 0;
  if ((cfg.modo === 'zonas' || cfg.modo === 'mixto') && deZona > 0) {
    base = deZona; modo = 'zonas';
    items.push({ l: `Tarifa ${zo.nombre} → ${zd.nombre}`, v: base });
  } else if (cfg.modo === 'zonas') {
    return { ok: false, total: 0, items: [], modo: 'zonas', zonaO: zo?.id || null, zonaD: zd?.id || null,
      mensaje: zo && zd ? 'La base aún no registra tarifa para esa ruta.' : 'El origen o el destino está fuera de las zonas de servicio.' };
  } else {
    const k = cfg.km, kms = distM / 1000, mins = durMs / 60000;
    const sub = +k.banderazo + kms * k.porKm + mins * k.porMin;
    base = Math.max(+k.minima, sub); modo = 'km';
    items.push({ l: 'Banderazo', v: +k.banderazo }, { l: `${kms.toFixed(1)} km × ${dinero(k.porKm)}`, v: kms * k.porKm });
    if (+k.porMin) items.push({ l: `${Math.round(mins)} min × ${dinero(k.porMin)}`, v: mins * k.porMin });
    if (sub < k.minima) items.push({ l: 'Ajuste a tarifa mínima', v: k.minima - sub });
  }
  const r = cfg.recargos;
  if (esNocturno(cfg, fecha) && +r.nocturnoPct) items.push({ l: `Recargo nocturno (${r.nocturnoPct}%)`, v: base * r.nocturnoPct / 100 });
  if (esFestivo(cfg, fecha) && +r.festivoPct) items.push({ l: `Recargo día festivo (${r.festivoPct}%)`, v: base * r.festivoPct / 100 });
  if (equipaje > 0 && +r.equipaje) items.push({ l: `Equipaje extra × ${equipaje}`, v: equipaje * r.equipaje });
  const suma = items.reduce((s, i) => s + i.v, 0);
  const red = Math.max(1, +cfg.redondeo || 1);
  const total = Math.round(suma / red) * red;
  if (total !== Math.round(suma)) items.push({ l: 'Redondeo', v: total - suma });
  return { ok: true, total, items: items.map(i => ({ l: i.l, v: Math.round(i.v * 100) / 100 })), modo, zonaO: zo?.id || null, zonaD: zd?.id || null };
}
export const desgloseHTML = q => q.items.map(i => `<div class="qline"><span>${esc(i.l)}</span><span>${dinero(i.v)}</span></div>`).join('') +
  `<div class="qtotal"><span>Total · pago en efectivo</span><span>${dinero(q.total)}</span></div>`;

/* ---------------- Mapas: OpenStreetMap + Leaflet + OSRM + Photon ----------------
   Leaflet se carga en cada página (<script> en el HTML). Estas funciones envuelven
   Leaflet con una interfaz sencilla que usan las tres apps. */
let mapasListos;
export function cargarMapas() {
  if (!mapasListos) mapasListos = window.L ? Promise.resolve(window.L) : Promise.reject(new Error('Leaflet no cargó'));
  return mapasListos;
}
export async function crearMapa(el, opts = {}) {
  const L = await cargarMapas();
  const map = L.map(el, { zoomControl: true, attributionControl: true, ...opts }).setView([APP.centro.lat, APP.centro.lng], APP.zoom);
  L.tileLayer(MAPAS.teselas, { maxZoom: 19, attribution: MAPAS.atribucion }).addTo(map);
  // Interfaz común: clic → {latLng: {toJSON}}
  map.addListener = (ev, f) => map.on(ev, e => f({ latLng: { toJSON: () => ({ lat: e.latlng.lat, lng: e.latlng.lng }) } }));
  map.setCenter = p => map.setView([p.lat, p.lng]);
  (window.__mapas = window.__mapas || []).push(map);
  setTimeout(() => map.invalidateSize(), 250);
  return map;
}
class Marcador {
  constructor(L, map, position, clase, texto, arrastrable, titulo) {
    const html = `<div class="mk ${clase}">${esc(texto)}</div>`;
    this.m = L.marker([position.lat, position.lng], {
      draggable: arrastrable, title: titulo, keyboard: false, zIndexOffset: clase.includes('taxi') ? 500 : 0,
      icon: L.divIcon({ html, className: 'mk-wrap', iconSize: null })
    }).addTo(map);
  }
  get position() { const p = this.m.getLatLng(); return { lat: p.lat, lng: p.lng }; }
  set position(p) { this.m.setLatLng([p.lat, p.lng]); }
  set map(v) { if (v === null) this.m.remove(); }
  get content() { const el = this.m.getElement(); return (el && el.querySelector('.mk')) || { className: '' }; }
  addListener(ev, f) { this.m.on(ev, f); }
}
export async function marcador(map, position, { clase = 'a', texto = '', arrastrable = false, titulo = '' } = {}) {
  return new Marcador(await cargarMapas(), map, position, clase, texto, arrastrable, titulo);
}
export function posDe(m) { return m.position; }
export async function encuadrar(map, puntos) {
  const L = await cargarMapas(); const ps = puntos.filter(Boolean).map(p => [p.lat, p.lng]);
  if (ps.length === 1) map.setView(ps[0], 15);
  else if (ps.length > 1) map.fitBounds(L.latLngBounds(ps), { padding: [50, 50], maxZoom: 16 });
}
class Linea {
  constructor(L, map, puntos, o) { this.l = L.polyline(puntos.map(p => [p.lat, p.lng]), { color: o.color, weight: o.grosor, opacity: o.opacidad, interactive: false }).addTo(map); if (o.z > 1) this.l.bringToFront(); }
  setMap(v) { if (v === null) this.l.remove(); }
  setOptions(o) { this.l.setStyle({ color: o.strokeColor, weight: o.strokeWeight, opacity: o.strokeOpacity }); if (o.zIndex > 1) this.l.bringToFront(); else this.l.bringToBack(); }
}
export async function linea(map, puntos, { color = '#2e6cf6', grosor = 5, z = 1, opacidad = .9 } = {}) {
  return new Linea(await cargarMapas(), map, puntos, { color, grosor, z, opacidad });
}

/** Rutas por calle con OSRM (incluye alternativas). Devuelve [{distanceMeters, durationMillis, description, path}] */
export async function calcularRutas(o, d, alternativas = true) {
  const url = `${MAPAS.osrm}/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=full&geometries=geojson&steps=true&alternatives=${alternativas ? 'true' : 'false'}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('OSRM ' + r.status);
  const j = await r.json();
  if (j.code !== 'Ok') throw new Error('OSRM ' + j.code);
  return (j.routes || []).map(rt => ({
    distanceMeters: rt.distance,
    durationMillis: rt.duration * 1000 * (MAPAS.factorTrafico || 1),
    description: (rt.legs || []).map(l => l.summary).filter(Boolean).join(', '),
    path: rt.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }))
  }));
}
/** Tiempo estimado (ms) por calle; si el servicio falla, una estimación aproximada */
export async function tiempoEstimado(o, d) {
  try { const [r] = await calcularRutas(o, d, false); if (r) return { ms: r.durationMillis, m: r.distanceMeters, real: true }; } catch (e) { console.warn(e); }
  return { ms: estimarMs(o, d), m: haversine(o, d) * 1.35, real: false };
}
/** Puntos simplificados de la ruta (máx. ~150) para guardarlos en el viaje */
export function puntosDeRuta(route) {
  const path = route.path || [];
  const paso = Math.max(1, Math.ceil(path.length / 150));
  const out = path.filter((_, i) => i % paso === 0); if (path.length) out.push(path[path.length - 1]);
  return out.map(p => ({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) }));
}
/** Abre la app de navegación del teléfono (Android: elige Google Maps, Waze, OsmAnd…; iPhone: Mapas) */
export function enlaceNavegar(p) {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return `geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}`;
  if (/iphone|ipad|ipod/i.test(ua)) return `https://maps.apple.com/?daddr=${p.lat},${p.lng}&dirflg=d`;
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=%3B${p.lat}%2C${p.lng}#map=15/${p.lat}/${p.lng}`;
}

/** Buscador de direcciones con Photon (OpenStreetMap). Si está desactivado devuelve null. */
export async function buscadorDireccion(contenedor, placeholder, onSel) {
  if (!MAPAS.busquedaDirecciones) return null;
  contenedor.innerHTML = `<div class="buscador"><input type="search" placeholder="${esc(placeholder)}" autocomplete="off"><div class="sugerencias hidden"></div></div>`;
  const inp = contenedor.querySelector('input'), lista = contenedor.querySelector('.sugerencias');
  let t, ultimo = '', res = [];
  const b = MAPAS.limites;
  const etiqueta = f => {
    const p = f.properties || {};
    const calle = [p.street, p.housenumber].filter(Boolean).join(' ');
    return [p.name, calle, p.district || p.locality, p.city].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
  };
  async function buscar(q) {
    if (q === ultimo) return; ultimo = q;
    try {
      const url = `${MAPAS.photon}/api/?q=${encodeURIComponent(q)}&limit=6&lat=${APP.centro.lat}&lon=${APP.centro.lng}` + (b ? `&bbox=${b.oeste},${b.sur},${b.este},${b.norte}` : '');
      const j = await (await fetch(url)).json();
      if (inp.value.trim() !== q) return;
      res = (j.features || []).map(f => ({ txt: etiqueta(f), p: { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] } })).filter(x => x.txt);
      lista.innerHTML = res.length ? res.map((x, i) => `<button type="button" data-i="${i}">${esc(x.txt)}</button>`).join('') : '<div class="muted" style="padding:8px">Sin resultados. Marca el punto en el mapa.</div>';
      lista.classList.remove('hidden');
    } catch (e) { console.warn('Photon', e); }
  }
  inp.addEventListener('input', () => {
    clearTimeout(t); const q = inp.value.trim();
    if (q.length < 3) { lista.classList.add('hidden'); return; }
    t = setTimeout(() => buscar(q), 450);
  });
  lista.addEventListener('mousedown', e => e.preventDefault());
  lista.addEventListener('click', e => {
    const btn = e.target.closest('[data-i]'); if (!btn) return;
    const x = res[+btn.dataset.i]; inp.value = x.txt; lista.classList.add('hidden'); onSel(x.p, x.txt);
  });
  inp.addEventListener('blur', () => setTimeout(() => lista.classList.add('hidden'), 150));
  return inp;
}

/* ------------------- Despacho (asignación automática) ---------------- */
/**
 * Ofrece el viaje a la unidad disponible más cercana que no lo haya rechazado.
 * Si nadie queda disponible, el viaje pasa a la cola de la central.
 * Lo ejecuta la app del pasajero mientras espera, y la central como respaldo.
 * La transacción evita que dos dispositivos ofrezcan el mismo viaje a la vez.
 */
const enDespacho = new Set();
export async function despachar(viajeId, segundos) {
  if (enDespacho.has(viajeId)) return; enDespacho.add(viajeId);
  try {
    const ref = doc(db, 'viajes', viajeId);
    const s = await getDoc(ref); if (!s.exists()) return;
    const v = s.data();
    if (v.estado === 'ofrecido' && Date.now() <= v.ofertaExpira) return;
    if (v.estado !== 'buscando' && v.estado !== 'ofrecido') return;
    const intentados = [...(v.intentados || [])];
    if (v.estado === 'ofrecido' && v.ofrecidoA && !intentados.includes(v.ofrecidoA)) intentados.push(v.ofrecidoA);
    const snap = await getDocs(query(collection(db, 'taxistas'), where('enLinea', '==', true), where('aprobado', '==', true), where('ocupado', '==', false)));
    const vigente = Date.now() - OPERACION.minutosUbicacionVigente * 60000;
    const cands = snap.docs.map(x => ({ uid: x.id, ...x.data() }))
      .filter(t => t.pos && (t.posAt || 0) > vigente && !intentados.includes(t.uid))
      .sort((a, b) => haversine(a.pos, v.origen) - haversine(b.pos, v.origen));
    await runTransaction(db, async tx => {
      const w = (await tx.get(ref)).data();
      if (w.estado !== v.estado || (w.ofrecidoA || null) !== (v.ofrecidoA || null)) return; // alguien más ya lo movió
      const notas = v.estado === 'ofrecido' ? [item(`La unidad ${v.ofrecidoEco || ''} no respondió a tiempo`)] : [];
      if (!cands.length) {
        tx.update(ref, { estado: 'cola', ofrecidoA: null, ofrecidoEco: null, intentados, bitacora: arrayUnion(...notas, item('Sin unidades disponibles: pasa a la cola de la central')) });
      } else {
        const t = cands[0];
        tx.update(ref, {
          estado: 'ofrecido', ofrecidoA: t.uid, ofrecidoEco: t.eco || '', ofertaExpira: Date.now() + segundos * 1000, intentados,
          bitacora: arrayUnion(...notas, item(`Ofrecido a la unidad ${t.eco} (a ${km(haversine(t.pos, v.origen))} en línea recta)`))
        });
      }
    });
  } catch (e) { console.error('despachar', e); }
  finally { enDespacho.delete(viajeId); }
}

/* -------------------- Zonas de ejemplo (Los Cabos) ------------------- */
// Polígonos APROXIMADOS para arrancar. La central debe ajustarlos arrastrando los vértices.
export const ZONAS_EJEMPLO = [
  { id: 'pedregal', nombre: 'Pedregal', color: '#ec4899', puntos: [[22.886, -109.934], [22.886, -109.919], [22.873, -109.917], [22.866, -109.926], [22.872, -109.936]] },
  { id: 'csl', nombre: 'CSL Centro / Marina', color: '#f59e0b', puntos: [[22.896, -109.919], [22.896, -109.905], [22.880, -109.904], [22.873, -109.917], [22.886, -109.919]] },
  { id: 'medano', nombre: 'El Médano / ZH CSL', color: '#ef6c3a', puntos: [[22.896, -109.905], [22.902, -109.887], [22.887, -109.879], [22.880, -109.904]] },
  { id: 'colcsl', nombre: 'Colonias CSL', color: '#a16207', puntos: [[22.940, -109.945], [22.940, -109.885], [22.902, -109.887], [22.896, -109.919], [22.886, -109.934], [22.905, -109.950]] },
  { id: 'coro', nombre: 'Corredor Oeste (Cabo del Sol / Cabo Real)', color: '#10b981', puntos: [[22.940, -109.885], [22.990, -109.778], [22.955, -109.760], [22.887, -109.879], [22.902, -109.887]] },
  { id: 'core', nombre: 'Corredor Este (Palmilla / Querencia)', color: '#14b8a6', puntos: [[22.990, -109.778], [23.046, -109.712], [23.026, -109.698], [22.955, -109.760]] },
  { id: 'sjdzh', nombre: 'Zona Hotelera SJD', color: '#8b5cf6', puntos: [[23.046, -109.712], [23.052, -109.684], [23.036, -109.676], [23.026, -109.698]] },
  { id: 'sjd', nombre: 'San José del Cabo Centro', color: '#3b82f6', puntos: [[23.078, -109.718], [23.078, -109.688], [23.052, -109.684], [23.046, -109.712]] },
  { id: 'colsjd', nombre: 'Colonias SJD', color: '#06b6d4', puntos: [[23.125, -109.745], [23.125, -109.690], [23.078, -109.688], [23.078, -109.718], [23.060, -109.745]] },
  { id: 'apto', nombre: 'Aeropuerto SJD', color: '#6366f1', puntos: [[23.178, -109.748], [23.178, -109.700], [23.133, -109.700], [23.133, -109.748]] }
].map(z => ({ ...z, puntos: z.puntos.map(([lat, lng]) => ({ lat, lng })) }));
/** Matriz de ejemplo: $80 dentro de la misma zona; entre zonas, $80 + $22 por km en línea recta × 1.3 */
export function matrizEjemplo(zonas) {
  const m = {};
  zonas.forEach(a => zonas.forEach(b => {
    const k = haversine(centroide(a.puntos), centroide(b.puntos)) / 1000 * 1.3;
    m[a.id + '|' + b.id] = a.id === b.id ? 80 : Math.round((80 + 22 * k) / 10) * 10;
  }));
  return m;
}
