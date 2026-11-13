// =====================================================================
//  NÚCLEO COMPARTIDO: Firebase, Google Maps, motor de tarifas y despacho
// =====================================================================
import { APP, FIREBASE_CONFIG, GOOGLE_MAPS, OPERACION } from './config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where,
  onSnapshot, getDocs, serverTimestamp, arrayUnion, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export { APP, GOOGLE_MAPS, OPERACION };
export {
  onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, doc, getDoc, setDoc, updateDoc, addDoc, collection, query, where,
  onSnapshot, getDocs, serverTimestamp, arrayUnion, runTransaction
};

const pendiente = v => !v || String(v).startsWith('PEGA_AQUI');
export const configurado = !pendiente(FIREBASE_CONFIG.apiKey) && !pendiente(GOOGLE_MAPS.apiKey);
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
    Abre <code>js/config.js</code> y pega las claves de Firebase y de Google Maps (README, pasos 1 a 4).</div>`);
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

/* --------------------------- Google Maps ---------------------------- */
let mapsPromise;
export function cargarMapas() {
  if (mapsPromise) return mapsPromise;
  // Cargador oficial de Google Maps (importLibrary)
  ((g) => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement("script")); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a) })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)) })({ key: GOOGLE_MAPS.apiKey, v: 'weekly', language: 'es', region: 'MX' });
  mapsPromise = Promise.all([google.maps.importLibrary('maps'), google.maps.importLibrary('marker'), google.maps.importLibrary('core')])
    .then(([maps, marker, core]) => ({ maps, marker, core }));
  return mapsPromise;
}
export async function crearMapa(el, opts = {}) {
  const { maps } = await cargarMapas();
  return new maps.Map(el, {
    center: APP.centro, zoom: APP.zoom, mapId: GOOGLE_MAPS.mapId, disableDefaultUI: true, zoomControl: true,
    clickableIcons: false, gestureHandling: 'greedy', ...opts
  });
}
export async function marcador(map, position, { clase = 'a', texto = '', arrastrable = false, titulo = '' } = {}) {
  const { marker } = await cargarMapas();
  const el = document.createElement('div'); el.className = 'mk ' + clase; el.textContent = texto;
  return new marker.AdvancedMarkerElement({ map, position, content: el, gmpDraggable: arrastrable, title: titulo });
}
export function posDe(m) { const p = m.position; return typeof p.lat === 'function' ? { lat: p.lat(), lng: p.lng() } : { lat: p.lat, lng: p.lng }; }
export async function encuadrar(map, puntos) {
  const { core } = await cargarMapas(); const b = new core.LatLngBounds();
  puntos.filter(Boolean).forEach(p => b.extend(p));
  if (!b.isEmpty()) map.fitBounds(b, 60);
}
/** Rutas reales con tráfico (Routes library). Devuelve un arreglo de google.maps.routes.Route */
export async function calcularRutas(o, d, alternativas = true) {
  const { Route } = await google.maps.importLibrary('routes');
  const { routes } = await Route.computeRoutes({
    origin: o, destination: d, travelMode: 'DRIVING', routingPreference: 'TRAFFIC_AWARE',
    computeAlternativeRoutes: alternativas, language: 'es-MX', region: 'MX',
    fields: ['distanceMeters', 'durationMillis', 'path', 'description']
  });
  return routes || [];
}
/** Tiempo estimado (ms) con la ruta real; si falla, una estimación aproximada */
export async function tiempoEstimado(o, d) {
  try { const [r] = await calcularRutas(o, d, false); if (r && r.durationMillis) return { ms: r.durationMillis, m: r.distanceMeters, real: true }; } catch (e) { console.warn(e); }
  return { ms: estimarMs(o, d), m: haversine(o, d) * 1.35, real: false };
}
/** Puntos simplificados de la ruta (máx. ~150) para guardarlos en el viaje y dibujarla sin volver a consultar */
export function puntosDeRuta(route) {
  const path = (route.path || []).map(p => typeof p.lat === 'function' ? { lat: p.lat(), lng: p.lng() } : { lat: p.lat, lng: p.lng });
  const paso = Math.max(1, Math.ceil(path.length / 150));
  const out = path.filter((_, i) => i % paso === 0); if (path.length) out.push(path[path.length - 1]);
  return out.map(p => ({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) }));
}
export async function linea(map, puntos, { color = '#1b315c', grosor = 5, z = 1, opacidad = .9 } = {}) {
  const { maps } = await cargarMapas();
  return new maps.Polyline({ map, path: puntos, strokeColor: color, strokeWeight: grosor, strokeOpacity: opacidad, zIndex: z, clickable: false });
}
export const enlaceNavegar = p => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;

/** Buscador de direcciones (Places). Si no está disponible, devuelve null y se usa solo el mapa. */
export async function buscadorDireccion(contenedor, placeholder, onSel) {
  if (!GOOGLE_MAPS.busquedaDirecciones) return null;
  try {
    const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');
    const ac = new PlaceAutocompleteElement({ includedRegionCodes: ['mx'], locationBias: { center: APP.centro, radius: 40000 } });
    try { ac.placeholder = placeholder; } catch (e) { /* versiones sin placeholder */ }
    contenedor.innerHTML = ''; contenedor.appendChild(ac);
    ac.addEventListener('gmp-select', async ({ placePrediction }) => {
      try {
        const place = placePrediction.toPlace();
        await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
        onSel({ lat: place.location.lat(), lng: place.location.lng() }, place.displayName || place.formattedAddress || 'Dirección');
      } catch (e) { console.error(e); toast('No se pudo leer esa dirección'); }
    });
    return ac;
  } catch (e) { console.warn('Buscador no disponible:', e); return null; }
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
  { id: 'pedregal', nombre: 'Pedregal', color: '#e8a33d', puntos: [[22.886, -109.934], [22.886, -109.919], [22.873, -109.917], [22.866, -109.926], [22.872, -109.936]] },
  { id: 'csl', nombre: 'CSL Centro / Marina', color: '#c9a227', puntos: [[22.896, -109.919], [22.896, -109.905], [22.880, -109.904], [22.873, -109.917], [22.886, -109.919]] },
  { id: 'medano', nombre: 'El Médano / ZH CSL', color: '#d9773a', puntos: [[22.896, -109.905], [22.902, -109.887], [22.887, -109.879], [22.880, -109.904]] },
  { id: 'colcsl', nombre: 'Colonias CSL', color: '#8a7f5c', puntos: [[22.940, -109.945], [22.940, -109.885], [22.902, -109.887], [22.896, -109.919], [22.886, -109.934], [22.905, -109.950]] },
  { id: 'coro', nombre: 'Corredor Oeste (Cabo del Sol / Cabo Real)', color: '#5f9e6e', puntos: [[22.940, -109.885], [22.990, -109.778], [22.955, -109.760], [22.887, -109.879], [22.902, -109.887]] },
  { id: 'core', nombre: 'Corredor Este (Palmilla / Querencia)', color: '#3f8f8a', puntos: [[22.990, -109.778], [23.046, -109.712], [23.026, -109.698], [22.955, -109.760]] },
  { id: 'sjdzh', nombre: 'Zona Hotelera SJD', color: '#d9773a', puntos: [[23.046, -109.712], [23.052, -109.684], [23.036, -109.676], [23.026, -109.698]] },
  { id: 'sjd', nombre: 'San José del Cabo Centro', color: '#c9a227', puntos: [[23.078, -109.718], [23.078, -109.688], [23.052, -109.684], [23.046, -109.712]] },
  { id: 'colsjd', nombre: 'Colonias SJD', color: '#8a7f5c', puntos: [[23.125, -109.745], [23.125, -109.690], [23.078, -109.688], [23.078, -109.718], [23.060, -109.745]] },
  { id: 'apto', nombre: 'Aeropuerto SJD', color: '#4b6cb7', puntos: [[23.178, -109.748], [23.178, -109.700], [23.133, -109.700], [23.133, -109.748]] }
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
