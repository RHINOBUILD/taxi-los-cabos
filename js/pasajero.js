// =====================================================================
//  APP DEL PASAJERO: marca A y B → ve rutas, tiempo y precio fijo → pide
// =====================================================================
import * as N from './nucleo.js';
const { $, esc, dinero } = N;

const S = {
  uid: null, cfg: N.normalizarTarifas(), map: null, modo: 'o',
  o: null, d: null, oTxt: '', dTxt: '', mkO: null, mkD: null, rutas: [], sel: 0, lineas: [], calculando: 0,
  viajeId: null, viaje: null, unsubViaje: null, dibujado: false, mkVO: null, mkVD: null, lineaViaje: null,
  taxiUid: null, unsubTaxi: null, mkTaxi: null, taxiPos: null, eta: null, etaAt: 0, etaPara: null, etaPos: null,
  rating: 0, confirmCancel: false
};
$('titulo').textContent = N.APP.nombre;
document.title = 'Pide tu taxi · ' + N.APP.nombre;

if (!N.configurado) N.bannerConfig(); else iniciar();

function perfil() { try { return JSON.parse(localStorage.getItem('tlc_perfil') || 'null'); } catch (e) { return null; } }
function vista(v) {
  ['v-perfil', 'v-pedir', 'v-viaje'].forEach(id => $(id).classList.toggle('hidden', id !== v));
  $('btn-perfil').classList.toggle('hidden', v !== 'v-pedir');
}

async function iniciar() {
  N.onAuthStateChanged(N.auth, async u => {
    if (!u) { try { await N.signInAnonymously(N.auth); } catch (e) { N.toast('No se pudo conectar (' + e.code + '). Activa el acceso anónimo en Firebase.'); } return; }
    if (S.uid) return;
    S.uid = u.uid;
    N.escucharTarifas(c => { S.cfg = c; if (S.rutas.length) pintarRutas(); });
    try { S.map = await N.crearMapa($('mapa')); } catch (e) { console.error(e); N.toast('No se pudo cargar el mapa. Revisa tu conexión.'); return; }
    S.map.addListener('click', e => { if (!S.viajeId) fijarPunto(S.modo, e.latLng.toJSON(), 'Punto marcado en el mapa'); });
    N.buscadorDireccion($('ac-o'), '¿Dónde te recogemos?', (p, t) => fijarPunto('o', p, t, true))
      .then(ac => { if (!ac) $('ac-o').innerHTML = '<div class="txt" id="lbl-o">Toca el mapa · salida</div>'; });
    N.buscadorDireccion($('ac-d'), '¿A dónde vas?', (p, t) => fijarPunto('d', p, t, true))
      .then(ac => { if (!ac) $('ac-d').innerHTML = '<div class="txt" id="lbl-d">Toca el mapa · llegada</div>'; });
    vista(perfil() ? 'v-pedir' : 'v-perfil');
    actualizarHint();
    // ¿Quedó un viaje pendiente? (por ejemplo, si se cerró la app)
    try {
      const s = await N.getDocs(N.query(N.collection(N.db, 'viajes'), N.where('pasajeroUid', '==', S.uid)));
      const pend = s.docs.map(x => ({ id: x.id, ...x.data() }))
        .filter(v => N.ACTIVOS.includes(v.estado) || (v.estado === 'completado' && !v.confirmadoPasajero && Date.now() - (v.creadoMs || 0) < 3 * 3600e3))
        .sort((a, b) => (b.creadoMs || 0) - (a.creadoMs || 0))[0];
      if (pend && perfil()) seguirViaje(pend.id);
    } catch (e) { console.error(e); }
  });
}

/* ---------------------------- Perfil ---------------------------- */
$('btn-guardar-perfil').onclick = () => {
  const nombre = $('p-nombre').value.trim(), tel = $('p-tel').value.replace(/\D/g, '');
  if (nombre.length < 2) return N.toast('Escribe tu nombre');
  if (tel.length < 10) return N.toast('Escribe tu teléfono a 10 dígitos');
  try { localStorage.setItem('tlc_perfil', JSON.stringify({ nombre, tel })); } catch (e) { /* sin almacenamiento */ }
  vista(S.viajeId ? 'v-viaje' : 'v-pedir');
};
$('btn-perfil').onclick = () => { const p = perfil() || {}; $('p-nombre').value = p.nombre || ''; $('p-tel').value = p.tel || ''; vista('v-perfil'); };

/* ------------------------ Marcar A y B --------------------------- */
function setModo(m) { S.modo = m; $('m-o').classList.toggle('on', m === 'o'); $('m-d').classList.toggle('on', m === 'd'); }
$('m-o').onclick = () => setModo('o');
$('m-d').onclick = () => setModo('d');
$('btn-gps').onclick = () => {
  if (!navigator.geolocation) return N.toast('Tu dispositivo no comparte ubicación');
  N.toast('Buscando tu ubicación…');
  navigator.geolocation.getCurrentPosition(
    p => fijarPunto('o', { lat: p.coords.latitude, lng: p.coords.longitude }, 'Mi ubicación actual', true),
    () => N.toast('No se pudo obtener tu ubicación. Revisa los permisos.'),
    { enableHighAccuracy: true, timeout: 12000 });
};
function actualizarHint() {
  $('hint').classList.toggle('hidden', !!(S.o && S.d));
  $('hint').textContent = !S.o ? 'Toca el mapa o escribe tu punto de salida (A).' : 'Ahora marca tu llegada (B) en el mapa o escríbela.';
}
async function fijarPunto(tipo, p, txt, centrar) {
  const z = N.zonaDe(S.cfg.zonas, p);
  if (S.cfg.modo === 'zonas' && !z) N.toast('Ese punto está fuera de las zonas de servicio');
  S[tipo] = p; S[tipo + 'Txt'] = txt + (z ? ' · ' + z.nombre : '');
  const k = tipo === 'o' ? 'mkO' : 'mkD';
  if (!S[k]) {
    S[k] = await N.marcador(S.map, p, { clase: tipo === 'o' ? 'a' : 'b', texto: tipo === 'o' ? 'A' : 'B', arrastrable: true });
    S[k].addListener('dragend', () => fijarPunto(tipo, N.posDe(S[k]), 'Punto marcado en el mapa'));
  } else S[k].position = p;
  $('txt-' + tipo).textContent = S[tipo + 'Txt'];
  const lbl = $('lbl-' + tipo); if (lbl) lbl.textContent = txt;
  if (tipo === 'o' && !S.d) setModo('d');
  if (S.o && S.d) { N.encuadrar(S.map, [S.o, S.d]); calcular(); } else if (centrar) { S.map.panTo(p); S.map.setZoom(15); }
  actualizarHint();
}

/* ------------------- Rutas, tiempos y precio --------------------- */
const estiloRuta = i => i === S.sel ? { color: '#1b315c', grosor: 6, z: 3, opacidad: .95 } : { color: '#8f9bb3', grosor: 5, z: 1, opacidad: .7 };
function limpiarLineas() { S.lineas.forEach(l => l.setMap(null)); S.lineas = []; }
async function calcular() {
  const id = ++S.calculando;
  limpiarLineas(); S.rutas = [];
  $('rutas').innerHTML = '<div class="muted"><span class="spin"></span>Calculando rutas y tarifa…</div>';
  $('cotiz').innerHTML = ''; $('btn-pedir').disabled = true;
  try {
    const r = await N.calcularRutas(S.o, S.d, true);
    if (id !== S.calculando) return;
    S.rutas = r; S.sel = 0;
    if (!r.length) { $('rutas').innerHTML = '<div class="note bad">No encontramos una ruta en auto entre esos puntos.</div>'; return; }
    const lineas = await Promise.all(r.map((ruta, i) => N.linea(S.map, N.puntosDeRuta(ruta), estiloRuta(i))));
    if (id !== S.calculando) { lineas.forEach(l => l.setMap(null)); return; }
    S.lineas = lineas;
    pintarRutas();
  } catch (e) {
    console.error(e);
    if (id === S.calculando) $('rutas').innerHTML = '<div class="note bad">No se pudo calcular la ruta en este momento. Intenta de nuevo o mueve ligeramente los puntos.</div>';
  }
}
function pintarRutas() {
  S.lineas.forEach((l, i) => { const e = estiloRuta(i); l.setOptions({ strokeColor: e.color, strokeWeight: e.grosor, zIndex: e.z, strokeOpacity: e.opacidad }); });
  const eq = +$('equipaje').value;
  const qs = S.rutas.map(r => N.cotizar(S.cfg, { o: S.o, d: S.d, distM: r.distanceMeters, durMs: r.durationMillis, equipaje: eq }));
  $('rutas').innerHTML = `<h3>${S.rutas.length > 1 ? 'Rutas posibles' : 'Ruta'}</h3>` + S.rutas.map((r, i) => `
    <div class="ruta ${i === S.sel ? 'on' : ''}" data-i="${i}">
      <div><div class="t">${N.minutos(r.durationMillis)}</div>
      <div class="muted">${N.km(r.distanceMeters)}${r.description ? ' · vía ' + esc(r.description) : ''} · llegas ≈ ${N.hora(Date.now() + r.durationMillis)}</div></div>
      <div class="p">${qs[i].ok ? dinero(qs[i].total) : '—'}</div>
    </div>`).join('');
  $('rutas').querySelectorAll('.ruta').forEach(el => el.onclick = () => { S.sel = +el.dataset.i; pintarRutas(); });
  const q = qs[S.sel];
  if (!q.ok) { $('cotiz').innerHTML = `<div class="note bad">${esc(q.mensaje)}</div>`; $('btn-pedir').disabled = true; $('extra').classList.add('hidden'); return; }
  $('extra').classList.remove('hidden');
  $('cotiz').innerHTML = `<div class="quote">${N.desgloseHTML(q)}<div class="muted" style="margin-top:4px">${q.modo === 'zonas'
    ? 'Tarifa fija por zona definida por la base de taxis.' : 'Tarifa calculada con el tabulador por kilómetro de la base.'} El taxista no puede cambiarla.</div></div>`;
  $('btn-pedir').disabled = false;
  $('btn-pedir').textContent = 'Pedir taxi · ' + dinero(q.total);
}
$('equipaje').onchange = () => { if (S.rutas.length) pintarRutas(); };

/* ------------------------- Pedir el taxi -------------------------- */
$('btn-pedir').onclick = async () => {
  const p = perfil(); if (!p) return vista('v-perfil');
  const r = S.rutas[S.sel]; if (!r) return;
  const eq = +$('equipaje').value;
  const q = N.cotizar(S.cfg, { o: S.o, d: S.d, distM: r.distanceMeters, durMs: r.durationMillis, equipaje: eq });
  if (!q.ok) return;
  $('btn-pedir').disabled = true;
  try {
    const ref = await N.addDoc(N.collection(N.db, 'viajes'), {
      pasajeroUid: S.uid, pasajero: { nombre: p.nombre, tel: p.tel }, canal: 'app',
      origen: { lat: S.o.lat, lng: S.o.lng, txt: S.oTxt }, destino: { lat: S.d.lat, lng: S.d.lng, txt: S.dTxt },
      zonaO: q.zonaO, zonaD: q.zonaD,
      ruta: { distM: r.distanceMeters || 0, durMs: r.durationMillis || 0, desc: r.description || '', puntos: N.puntosDeRuta(r) },
      tarifa: { total: q.total, items: q.items, modo: q.modo }, equipaje: eq,
      estado: 'buscando', ofrecidoA: null, ofrecidoEco: null, ofertaExpira: 0, intentados: [], taxistaUid: null,
      creado: N.serverTimestamp(), creadoMs: Date.now(), dia: N.hoyISO(),
      bitacora: [N.item('Solicitud creada desde la app · tarifa fija ' + dinero(q.total))]
    });
    limpiarLineas(); [S.mkO, S.mkD].forEach(m => m && (m.map = null)); S.mkO = S.mkD = null;
    seguirViaje(ref.id);
  } catch (e) { console.error(e); N.toast('No se pudo enviar la solicitud'); $('btn-pedir').disabled = false; }
};

/* ------------------------ Seguir el viaje ------------------------- */
function seguirViaje(id) {
  S.viajeId = id; vista('v-viaje');
  if (S.unsubViaje) S.unsubViaje();
  [S.mkO, S.mkD].forEach(m => m && (m.map = null)); S.mkO = S.mkD = null; limpiarLineas();
  S.unsubViaje = N.onSnapshot(N.doc(N.db, 'viajes', id), s => {
    if (!s.exists()) return;
    const antes = S.viaje && S.viaje.estado;
    S.viaje = { id, ...s.data() };
    if (antes && antes !== S.viaje.estado) avisoCambio(S.viaje);
    dibujarViaje(); seguirTaxi(); actualizarETA(); render(); revisarDespacho();
  }, e => console.error(e));
}
function avisoCambio(v) {
  const m = { aceptado: '¡Tu taxi va en camino!', en_origen: 'Tu taxi llegó', cola: 'La central está asignando tu taxi', completado: 'Llegaste a tu destino', cancelado: 'El viaje fue cancelado' }[v.estado];
  if (m) { N.toast(m); try { navigator.vibrate && navigator.vibrate(200); } catch (e) { } }
}
async function dibujarViaje() {
  if (S.dibujado) return; S.dibujado = true;
  const v = S.viaje;
  S.mkVO = await N.marcador(S.map, v.origen, { clase: 'a', texto: 'A' });
  S.mkVD = await N.marcador(S.map, v.destino, { clase: 'b', texto: 'B' });
  S.lineaViaje = await N.linea(S.map, v.ruta?.puntos?.length ? v.ruta.puntos : [v.origen, v.destino], { color: '#1b315c', grosor: 5 });
  N.encuadrar(S.map, [v.origen, v.destino]);
}
function seguirTaxi() {
  const v = S.viaje;
  const activo = ['aceptado', 'en_origen', 'en_curso'].includes(v.estado) && v.taxistaUid;
  if (!activo) {
    if (S.unsubTaxi) { S.unsubTaxi(); S.unsubTaxi = null; S.taxiUid = null; }
    if (S.mkTaxi && S.mkTaxi !== true) S.mkTaxi.map = null; S.mkTaxi = null;
    return;
  }
  if (S.taxiUid === v.taxistaUid) return;
  if (S.unsubTaxi) S.unsubTaxi();
  if (S.mkTaxi && S.mkTaxi !== true) S.mkTaxi.map = null; S.mkTaxi = null;
  S.taxiUid = v.taxistaUid; S.eta = null; S.taxiPos = null;
  S.unsubTaxi = N.onSnapshot(N.doc(N.db, 'taxistas', v.taxistaUid), async s => {
    const t = s.data(); if (!t || !t.pos) return;
    S.taxiPos = t.pos;
    if (!S.mkTaxi) { S.mkTaxi = true; S.mkTaxi = await N.marcador(S.map, t.pos, { clase: 'taxi ocupado', texto: t.eco || '🚕' }); }
    else if (S.mkTaxi !== true) S.mkTaxi.position = t.pos;
    actualizarETA();
  });
}
async function actualizarETA() {
  const v = S.viaje; if (!v || !S.taxiPos) return;
  const para = v.estado === 'aceptado' ? 'o' : v.estado === 'en_curso' ? 'd' : null;
  if (!para) { if (S.eta) { S.eta = null; render(); } return; }
  const movido = !S.etaPos || N.haversine(S.etaPos, S.taxiPos) > 150;
  const vencido = Date.now() - S.etaAt > N.OPERACION.etaCadaSeg * 1000;
  if (S.eta && S.etaPara === para && !(vencido && movido)) return;
  S.etaAt = Date.now(); S.etaPara = para; S.etaPos = S.taxiPos;
  const r = await N.tiempoEstimado(S.taxiPos, para === 'o' ? v.origen : v.destino);
  S.eta = { ...r, en: Date.now() }; render();
}
function revisarDespacho() {
  const v = S.viaje; if (!v) return;
  if (v.estado === 'buscando' || (v.estado === 'ofrecido' && Date.now() > v.ofertaExpira + 1500)) N.despachar(v.id, S.cfg.segundosParaAceptar || 20);
}
setInterval(() => { revisarDespacho(); if (S.viaje) render(); }, 2000);

/* --------------------------- Pantalla ----------------------------- */
let ultimo = '';
function render() {
  const v = S.viaje; if (!v) return;
  const t = v.taxista;
  const unidad = t ? `<div class="unit"><span class="eco">${esc(t.eco)}</span><div><b>${esc(t.nombre)}</b>
    <div class="muted">Placas ${esc(t.placas)}${t.telefono ? ` · <a href="tel:${esc(t.telefono)}">${esc(t.telefono)}</a>` : ''}</div></div></div>` : '';
  const eta = S.eta ? `<div class="eta"><span>${v.estado === 'aceptado' ? 'Tu taxi llega en' : 'Llegas a tu destino en'}</span>
    <b>≈ ${N.minutos(Math.max(60000, S.eta.ms - (Date.now() - S.eta.en)))}</b><span style="color:#c8d1e4;font-size:12px">${S.eta.real ? 'por calle' : 'aprox.'}</span></div>` : '';
  let h = `<div class="row" style="margin-bottom:8px"><b>${N.folio(v.id)}</b>${N.badge(v.estado)}<span class="muted" style="margin-left:auto">${v.creadoMs ? N.hora(v.creadoMs) : ''}</span></div><div class="status">`;
  switch (v.estado) {
    case 'buscando': case 'ofrecido': h += '<h4><span class="spin"></span>Buscando tu taxi…</h4><p>Le ofrecemos tu viaje a la unidad disponible más cercana.</p>'; break;
    case 'cola': h += '<h4><span class="spin"></span>La central está asignando tu taxi</h4><p>Las unidades cercanas están ocupadas; un operador te asigna una en breve.</p>'; break;
    case 'aceptado': h += '<h4>🚕 Tu taxi va en camino</h4>' + unidad + eta + '<p>Verifica el número económico y las placas antes de subir.</p>'; break;
    case 'en_origen': h += '<h4>🚕 Tu taxi llegó</h4>' + unidad + '<p>Te espera en tu punto de salida.</p>'; break;
    case 'en_curso': h += `<h4>En viaje a tu destino</h4>${unidad}${eta}<p>Al llegar paga <b>${dinero(v.tarifa.total)}</b> en efectivo al conductor.</p>`; break;
    case 'completado':
      h += v.confirmadoPasajero
        ? `<h4>✅ ¡Gracias por viajar con nosotros!</h4><p>Viaje confirmado${v.calificacion ? ' · calificaste con ' + '★'.repeat(v.calificacion) : ''}.</p>`
        : `<h4>Llegaste a tu destino</h4><p>¿Pagaste <b>${dinero(v.tarifa.total)}</b> en efectivo a la unidad ${esc(t?.eco || '')}?</p>
           <p class="muted">Califica tu viaje (opcional):</p><div class="stars">${[1, 2, 3, 4, 5].map(n => `<button data-n="${n}" class="${S.rating >= n ? 'on' : ''}">★</button>`).join('')}</div>
           <button class="btn ok block" id="btn-confirmar">Confirmar llegada y pago</button>`;
      break;
    case 'cancelado': h += `<h4>Viaje cancelado</h4><p class="muted">${v.canceladoPor === 'central' ? 'La central canceló el viaje.' : 'Cancelaste el viaje.'}</p>`; break;
  }
  if (N.ACTIVOS.includes(v.estado)) h += `<div class="pts"><div><i class="dot" style="background:#1f9d55"></i>${esc(v.origen.txt)}</div>
    <div><i class="dot" style="background:#c53030"></i>${esc(v.destino.txt)}</div></div>
    <div class="qtotal" style="font-size:16px"><span>Tarifa fija · efectivo</span><span>${dinero(v.tarifa.total)}</span></div>`;
  h += '</div>';
  if (['buscando', 'ofrecido', 'cola', 'aceptado', 'en_origen'].includes(v.estado))
    h += `<button class="btn bad block" id="btn-cancelar">${S.confirmCancel ? 'Toca de nuevo para confirmar la cancelación' : 'Cancelar viaje'}</button>`;
  if (v.estado === 'cancelado' || (v.estado === 'completado' && v.confirmadoPasajero)) h += '<button class="btn gold block" id="btn-otro">Pedir otro taxi</button>';
  if (h === ultimo) return;
  ultimo = h; $('v-viaje').innerHTML = h;
  $('v-viaje').querySelectorAll('.stars button').forEach(b => b.onclick = () => { S.rating = +b.dataset.n; render(); });
  const c = $('btn-confirmar'); if (c) c.onclick = confirmar;
  const x = $('btn-cancelar'); if (x) x.onclick = cancelar;
  const o = $('btn-otro'); if (o) o.onclick = nuevoViaje;
}
async function confirmar() {
  try {
    await N.updateDoc(N.doc(N.db, 'viajes', S.viajeId), {
      confirmadoPasajero: true, calificacion: S.rating || 0,
      bitacora: N.bitacora('El pasajero confirmó llegada y pago' + (S.rating ? ` · ${S.rating}★` : ''))
    });
  } catch (e) { console.error(e); N.toast('No se pudo confirmar'); }
}
async function cancelar() {
  if (!S.confirmCancel) { S.confirmCancel = true; render(); setTimeout(() => { S.confirmCancel = false; render(); }, 5000); return; }
  S.confirmCancel = false;
  try {
    await N.updateDoc(N.doc(N.db, 'viajes', S.viajeId), { estado: 'cancelado', canceladoPor: 'pasajero', ofrecidoA: null, bitacora: N.bitacora('Cancelado por el pasajero') });
  } catch (e) { console.error(e); N.toast('No se pudo cancelar: el viaje ya está en curso'); }
}
function nuevoViaje() {
  if (S.unsubViaje) S.unsubViaje(); if (S.unsubTaxi) S.unsubTaxi();
  [S.mkVO, S.mkVD, S.mkTaxi].forEach(m => m && m !== true && (m.map = null));
  if (S.lineaViaje) S.lineaViaje.setMap(null);
  Object.assign(S, { viajeId: null, viaje: null, unsubViaje: null, unsubTaxi: null, taxiUid: null, mkTaxi: null, mkVO: null, mkVD: null,
    lineaViaje: null, dibujado: false, eta: null, etaPara: null, etaPos: null, rating: 0, o: null, d: null, rutas: [], confirmCancel: false });
  ultimo = '';
  ['rutas', 'cotiz'].forEach(id => $(id).innerHTML = '');
  ['txt-o', 'txt-d'].forEach(id => $(id).textContent = '');
  $('btn-pedir').disabled = true; $('btn-pedir').textContent = 'Pedir taxi'; $('extra').classList.add('hidden');
  setModo('o'); actualizarHint(); vista('v-pedir');
  S.map.setCenter(N.APP.centro); S.map.setZoom(N.APP.zoom);
}
