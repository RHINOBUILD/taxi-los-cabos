// =====================================================================
//  CENTRAL DE LA BASE: operación en vivo, asignación manual, captura
//  telefónica, tarifas (zonas / km / mixto), taxistas e historial · mapas OpenStreetMap
// =====================================================================
import * as N from './nucleo.js';
const { $, esc, dinero } = N;

const PALETA = ['#c9a227', '#d9773a', '#5f9e6e', '#3f8f8a', '#4b6cb7', '#8a5fb7', '#b7476b', '#8a7f5c', '#2f7fbf', '#7a9e2f'];
const S = {
  uid: null, cfg: N.normalizarTarifas(), borrador: null, sucio: false, tab: 'op',
  taxistas: [], activos: [], hoy: [], unsub: [],
  mapOp: null, mkTaxis: {}, mkSol: {}, sel: null, lineaSel: null, reasignar: null, confirmar: null,
  cap: { o: null, d: null, oTxt: '', dTxt: '', modo: null, ruta: null, mkO: null, mkD: null, linea: null, calc: 0 },
  mapZ: null, polys: [], etiquetas: [], dibujo: null, editando: null,
  histDia: N.hoyISO(), hist: [], unsubHist: null, histAbierto: null
};
$('titulo').textContent = 'Central · ' + N.APP.nombre;
document.title = 'Central · ' + N.APP.nombre;

if (!N.configurado) N.bannerConfig(); else iniciar();

function vista(v) { ['v-login', 'v-sinpermiso', 'v-main'].forEach(id => $(id).classList.toggle('hidden', id !== v)); $('tabs').classList.toggle('hidden', v !== 'v-main'); $('btn-salir').classList.toggle('hidden', v === 'v-login'); }

/* ----------------------------- Acceso ----------------------------- */
$('btn-entrar').onclick = async () => {
  try { await N.signInWithEmailAndPassword(N.auth, $('l-email').value.trim(), $('l-pass').value); }
  catch (e) { N.toast(e.code === 'auth/invalid-credential' ? 'Correo o contraseña incorrectos' : 'Error: ' + e.code); }
};
$('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-entrar').click(); });
$('btn-salir').onclick = async () => { await N.signOut(N.auth); location.reload(); };

function iniciar() {
  N.onAuthStateChanged(N.auth, async u => {
    if (!u || u.isAnonymous) { vista('v-login'); return; }
    if (S.uid) return;
    const admin = await N.getDoc(N.doc(N.db, 'admins', u.uid)).catch(() => null);
    if (!admin || !admin.exists()) { $('mi-uid').textContent = u.uid; vista('v-sinpermiso'); return; }
    S.uid = u.uid; $('quien').textContent = u.email || '';
    vista('v-main');
    S.mapOp = await N.crearMapa($('mapa-op'));
    S.mapOp.addListener('click', e => { if (S.cap.modo) fijarCap(S.cap.modo, e.latLng.toJSON(), 'Punto marcado por la central'); });
    N.buscadorDireccion($('cap-ac-o'), 'Dirección de salida', (p, t) => fijarCap('o', p, t))
      .then(ac => { if (!ac) $('cap-ac-o').innerHTML = '<div class="txt">Salida: usa 🗺️ y marca en el mapa</div>'; });
    N.buscadorDireccion($('cap-ac-d'), 'Dirección de llegada', (p, t) => fijarCap('d', p, t))
      .then(ac => { if (!ac) $('cap-ac-d').innerHTML = '<div class="txt">Llegada: usa 🗺️ y marca en el mapa</div>'; });
    S.unsub.push(N.escucharTarifas(c => {
      S.cfg = c;
      if (!S.sucio) { S.borrador = structuredClone(c); if (S.mapZ) pintarZonas(); pintarFormulario(); }
      else $('c-sucio').textContent = 'Hay cambios sin guardar (otra persona también modificó las tarifas)';
      pintarCap();
    }));
    S.unsub.push(N.onSnapshot(N.collection(N.db, 'taxistas'), q => { S.taxistas = q.docs.map(x => ({ uid: x.id, ...x.data() })); pintarTodo(); }));
    S.unsub.push(N.onSnapshot(N.query(N.collection(N.db, 'viajes'), N.where('estado', 'in', N.ACTIVOS)), q => { S.activos = q.docs.map(x => ({ id: x.id, ...x.data() })); pintarTodo(); }, e => console.error(e)));
    S.unsub.push(N.onSnapshot(N.query(N.collection(N.db, 'viajes'), N.where('dia', '==', N.hoyISO())), q => { S.hoy = q.docs.map(x => ({ id: x.id, ...x.data() })); pintarKpis(); }, e => console.error(e)));
    $('h-dia').value = S.histDia; cargarHistorial();
    setInterval(despachador, 3000);
    setInterval(() => { pintarCola(); pintarKpis(); }, 1000);
  });
}

/* ----------------------------- Pestañas --------------------------- */
$('tabs').addEventListener('click', async e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab;
  $('tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  ['op', 'tar', 'tax', 'his'].forEach(t => $('t-' + t).classList.toggle('hidden', t !== S.tab));
  setTimeout(() => { [S.mapOp, S.mapZ].forEach(m => m && m.invalidateSize && m.invalidateSize()); }, 50);
  if (S.tab === 'tar' && !S.mapZ) {
    S.mapZ = await N.crearMapa($('mapa-zonas'));
    S.mapZ.addListener('click', e => { if (S.dibujo) agregarVertice(e.latLng.toJSON()); });
    pintarZonas();
  }
});

/* ------------------- Despacho de respaldo (central) ---------------- */
// La app del pasajero ofrece el viaje mientras espera. Si el pasajero cerró la app
// o el viaje se capturó por teléfono, la central continúa el proceso.
function despachador() {
  const ahora = Date.now(), seg = S.cfg.segundosParaAceptar || 20;
  S.activos.forEach(v => {
    if (v.estado === 'buscando' && (v.canal === 'central' || ahora - (v.creadoMs || 0) > 8000)) N.despachar(v.id, seg);
    else if (v.estado === 'ofrecido' && ahora > (v.ofertaExpira || 0) + 4000) N.despachar(v.id, seg);
  });
}

/* ------------------------------ Pintado --------------------------- */
function pintarTodo() { pintarKpis(); pintarMapaOp(); pintarCola(); pintarActivos(); pintarTaxistas(); }
const vigente = t => (t.posAt || 0) > Date.now() - N.OPERACION.minutosUbicacionVigente * 60000;
const libres = () => S.taxistas.filter(t => t.aprobado && t.enLinea && !t.ocupado && t.pos && vigente(t));
function setHTML(id, h) { const el = $(id); if (el && el._h !== h) { el._h = h; el.innerHTML = h; } }

function pintarKpis() {
  const vs = S.hoy.filter(v => v.estado !== 'cancelado'), comp = S.hoy.filter(v => v.estado === 'completado');
  const val = comp.filter(v => v.confirmadoPasajero || v.gpsOk).length;
  const cal = comp.filter(v => v.calificacion), prom = cal.length ? (cal.reduce((s, v) => s + v.calificacion, 0) / cal.length).toFixed(1) : '—';
  const aprob = S.taxistas.filter(t => t.aprobado);
  const k = [
    [vs.length, 'Viajes hoy'], [S.activos.filter(v => ['aceptado', 'en_origen', 'en_curso'].includes(v.estado)).length, 'En servicio'],
    [S.activos.filter(v => ['buscando', 'ofrecido', 'cola'].includes(v.estado)).length, 'Esperando taxi'],
    [aprob.filter(t => t.enLinea).length + ' / ' + aprob.length, 'Unidades en línea'],
    [dinero(comp.reduce((s, v) => s + (v.tarifa?.total || 0), 0)), 'Efectivo cobrado hoy'],
    [comp.length ? Math.round(val / comp.length * 100) + '%' : '—', 'Viajes validados'], [prom + (cal.length ? ' ★' : ''), 'Calificación promedio']
  ];
  setHTML('kpis', k.map(x => `<div class="kpi"><b>${x[0]}</b><span>${x[1]}</span></div>`).join(''));
}

async function pintarMapaOp() {
  if (!S.mapOp) return;
  const vivos = new Set();
  for (const t of S.taxistas) {
    if (!t.pos || !t.aprobado || (!t.enLinea && !t.ocupado)) continue;
    vivos.add(t.uid);
    const clase = 'mk taxi' + (t.ocupado ? ' ocupado' : '') + (!vigente(t) ? ' off' : '');
    const m = S.mkTaxis[t.uid];
    if (!m) { S.mkTaxis[t.uid] = true; S.mkTaxis[t.uid] = await N.marcador(S.mapOp, t.pos, { clase: clase.slice(3), texto: t.eco, titulo: t.nombre }); }
    else if (m !== true) { m.position = t.pos; m.content.className = clase; }
  }
  Object.keys(S.mkTaxis).forEach(uid => { if (!vivos.has(uid) && S.mkTaxis[uid] !== true) { S.mkTaxis[uid].map = null; delete S.mkTaxis[uid]; } });
  const sol = new Set();
  for (const v of S.activos) {
    if (!['buscando', 'ofrecido', 'cola'].includes(v.estado)) continue;
    sol.add(v.id);
    if (!S.mkSol[v.id]) { S.mkSol[v.id] = true; S.mkSol[v.id] = await N.marcador(S.mapOp, v.origen, { clase: 'a mini', titulo: N.folio(v.id) }); }
  }
  Object.keys(S.mkSol).forEach(id => { if (!sol.has(id) && S.mkSol[id] !== true) { S.mkSol[id].map = null; delete S.mkSol[id]; } });
}

function chips(v) {
  const ls = libres().filter(t => t.uid !== v.taxistaUid).sort((a, b) => N.haversine(a.pos, v.origen) - N.haversine(b.pos, v.origen)).slice(0, 8);
  if (!ls.length) return '<div class="muted">No hay unidades libres en este momento.</div>';
  return '<div class="chips">' + ls.map((t, i) => `<button class="chip${i === 0 ? ' near' : ''}" data-a="asignar" data-v="${v.id}" data-t="${t.uid}" title="${esc(t.nombre)}">${i === 0 ? '★ ' : ''}${esc(t.eco)} · ${N.km(N.haversine(t.pos, v.origen))}</button>`).join('') + '</div>';
}
const ruta = v => `${esc((v.origen.txt || '').split(' · ').pop())} → ${esc((v.destino.txt || '').split(' · ').pop())}`;
const hace = ms => { const m = Math.floor((Date.now() - ms) / 60000); return m < 1 ? 'ahora' : 'hace ' + m + ' min'; };

function pintarCola() {
  const q = S.activos.filter(v => ['buscando', 'ofrecido', 'cola'].includes(v.estado)).sort((a, b) => (a.creadoMs || 0) - (b.creadoMs || 0));
  setHTML('cola', q.length ? q.map(v => `<div class="qitem${v.estado === 'cola' ? ' alerta' : ''}">
    <div class="row"><b>${N.folio(v.id)}</b>${N.badge(v.estado)}<span class="muted" style="margin-left:auto">${dinero(v.tarifa?.total)}</span></div>
    <div class="muted">${ruta(v)} · ${esc(v.pasajero?.nombre || '')}${v.canal === 'central' ? ' · 📞' : ''} · ${hace(v.creadoMs)}</div>
    ${v.estado === 'ofrecido' ? `<div class="muted">Ofrecido a la unidad ${esc(v.ofrecidoEco || '')} · quedan ${Math.max(0, Math.ceil((v.ofertaExpira - Date.now()) / 1000))} s</div>` : ''}
    <div class="muted" style="margin-top:4px">Asignar a:</div>${chips(v)}
    <div class="row" style="margin-top:6px"><button class="btn ghost sm" data-a="ver" data-v="${v.id}">Ver en mapa</button>
    <button class="btn bad sm" data-a="cancelar" data-v="${v.id}">${S.confirmar === v.id ? '¿Seguro? Cancelar' : 'Cancelar'}</button></div></div>`).join('')
    : '<div class="empty">Sin viajes esperando asignación.</div>');
}
function pintarActivos() {
  const r = S.activos.filter(v => ['aceptado', 'en_origen', 'en_curso'].includes(v.estado)).sort((a, b) => (a.aceptadoAt || 0) - (b.aceptadoAt || 0));
  setHTML('activos', r.length ? `<div class="tw"><table><tr><th>Folio</th><th>Ruta</th><th>Pasajero</th><th>Unidad</th><th>Estado</th><th>Tarifa</th><th></th></tr>` +
    r.map(v => `<tr><td><b>${N.folio(v.id)}</b><div class="muted">${v.aceptadoAt ? hace(v.aceptadoAt) : ''}</div></td><td>${ruta(v)}</td>
      <td>${esc(v.pasajero?.nombre || '')}${v.canal === 'central' ? ' 📞' : ''}<div class="muted">${esc(v.pasajero?.tel || '')}</div></td>
      <td><b>${esc(v.taxista?.eco || '—')}</b></td><td>${N.badge(v.estado)}</td><td>${dinero(v.tarifa?.total)}</td>
      <td style="white-space:nowrap"><button class="btn ghost sm" data-a="ver" data-v="${v.id}">Ver</button>
      ${v.estado !== 'en_curso' ? `<button class="btn ghost sm" data-a="reasignar" data-v="${v.id}">Reasignar</button>` : ''}
      <button class="btn bad sm" data-a="cancelar" data-v="${v.id}">${S.confirmar === v.id ? '¿Seguro?' : 'Cancelar'}</button></td></tr>
      ${S.reasignar === v.id ? `<tr><td colspan="7">${chips(v)}</td></tr>` : ''}`).join('') + '</table></div>'
    : '<div class="empty">No hay viajes en servicio.</div>');
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, v = S.activos.find(x => x.id === b.dataset.v);
  if (a === 'asignar') { const t = S.taxistas.find(x => x.uid === b.dataset.t); if (v && t) asignar(v, t); }
  else if (a === 'reasignar') { S.reasignar = S.reasignar === b.dataset.v ? null : b.dataset.v; pintarActivos(); }
  else if (a === 'ver' && v) verViaje(v);
  else if (a === 'cancelar' && v) {
    if (S.confirmar !== v.id) { S.confirmar = v.id; pintarCola(); pintarActivos(); setTimeout(() => { if (S.confirmar === v.id) { S.confirmar = null; pintarCola(); pintarActivos(); } }, 5000); return; }
    S.confirmar = null; cancelar(v);
  }
});
async function asignar(v, t) {
  try {
    await N.runTransaction(N.db, async tx => {
      const ref = N.doc(N.db, 'viajes', v.id), tref = N.doc(N.db, 'taxistas', t.uid);
      const w = (await tx.get(ref)).data(), tt = (await tx.get(tref)).data();
      if (!w || !['buscando', 'ofrecido', 'cola', 'aceptado', 'en_origen'].includes(w.estado)) throw new Error('estado');
      if (tt.ocupado && w.taxistaUid !== t.uid) throw new Error('ocupado');
      if (w.taxistaUid && w.taxistaUid !== t.uid) tx.update(N.doc(N.db, 'taxistas', w.taxistaUid), { ocupado: false });
      tx.update(ref, {
        estado: 'aceptado', taxistaUid: t.uid, taxista: { eco: t.eco, nombre: t.nombre, placas: t.placas, telefono: t.telefono || '' },
        ofrecidoA: null, ofrecidoEco: null, aceptadoAt: Date.now(),
        bitacora: N.arrayUnion(N.item(`${w.taxistaUid ? 'Reasignado' : 'Asignado'} por la central a la unidad ${t.eco}`))
      });
      tx.update(tref, { ocupado: true });
    });
    S.reasignar = null; N.toast(`${N.folio(v.id)} asignado a la unidad ${t.eco}`);
  } catch (e) { N.toast(e.message === 'ocupado' ? 'Esa unidad acaba de ocuparse' : 'No se pudo asignar: el viaje cambió de estado'); }
}
async function cancelar(v) {
  try {
    await N.updateDoc(N.doc(N.db, 'viajes', v.id), { estado: 'cancelado', canceladoPor: 'central', ofrecidoA: null, bitacora: N.bitacora('Cancelado por la central') });
    if (v.taxistaUid) await N.updateDoc(N.doc(N.db, 'taxistas', v.taxistaUid), { ocupado: false });
    N.toast(N.folio(v.id) + ' cancelado');
  } catch (e) { console.error(e); N.toast('No se pudo cancelar'); }
}
async function verViaje(v) {
  if (S.lineaSel) S.lineaSel.setMap(null);
  S.lineaSel = await N.linea(S.mapOp, v.ruta?.puntos?.length ? v.ruta.puntos : [v.origen, v.destino], { color: '#c53030', grosor: 5, z: 5 });
  const t = v.taxistaUid && S.taxistas.find(x => x.uid === v.taxistaUid);
  N.encuadrar(S.mapOp, [v.origen, v.destino, t && t.pos]);
  $('mapa-op').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ------------------------ Captura telefónica ---------------------- */
function modoCap(m) {
  S.cap.modo = S.cap.modo === m ? null : m;
  $('cap-mo').classList.toggle('gold', S.cap.modo === 'o'); $('cap-md').classList.toggle('gold', S.cap.modo === 'd');
  $('cap-aviso').classList.toggle('hidden', !S.cap.modo);
  $('cap-aviso').textContent = S.cap.modo ? `Haz clic en el mapa para marcar la ${S.cap.modo === 'o' ? 'salida (A)' : 'llegada (B)'} del viaje telefónico.` : '';
  if (S.cap.modo) $('mapa-op').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('cap-mo').onclick = () => modoCap('o');
$('cap-md').onclick = () => modoCap('d');
$('cap-eq').onchange = () => pintarCap();
async function fijarCap(tipo, p, txt) {
  const z = N.zonaDe(S.cfg.zonas, p);
  S.cap[tipo] = p; S.cap[tipo + 'Txt'] = txt + (z ? ' · ' + z.nombre : '');
  $('cap-txt-' + tipo).textContent = S.cap[tipo + 'Txt'];
  const k = tipo === 'o' ? 'mkO' : 'mkD';
  if (!S.cap[k]) S.cap[k] = await N.marcador(S.mapOp, p, { clase: tipo === 'o' ? 'a' : 'b', texto: tipo === 'o' ? 'A' : 'B' });
  else S.cap[k].position = p;
  if (S.cap.modo === tipo) modoCap(tipo);
  if (tipo === 'o' && !S.cap.d) modoCap('d');
  if (S.cap.o && S.cap.d) {
    const id = ++S.cap.calc; S.cap.ruta = null;
    $('cap-cotiz').innerHTML = '<div class="muted"><span class="spin"></span>Calculando ruta…</div>';
    try {
      const [r] = await N.calcularRutas(S.cap.o, S.cap.d, false);
      if (id !== S.cap.calc) return;
      S.cap.ruta = r || null;
      if (S.cap.linea) S.cap.linea.setMap(null);
      if (r) S.cap.linea = await N.linea(S.mapOp, N.puntosDeRuta(r), { color: '#1b315c', grosor: 5 });
      N.encuadrar(S.mapOp, [S.cap.o, S.cap.d]);
    } catch (e) { console.error(e); }
    pintarCap();
  }
}
function pintarCap() {
  const c = S.cap;
  if (!c.o || !c.d) { $('cap-registrar').disabled = true; return; }
  if (!c.ruta) { $('cap-cotiz').innerHTML = '<div class="note bad">No se pudo calcular la ruta en este momento. Intenta de nuevo.</div>'; $('cap-registrar').disabled = true; return; }
  const q = N.cotizar(S.cfg, { o: c.o, d: c.d, distM: c.ruta.distanceMeters, durMs: c.ruta.durationMillis, equipaje: +$('cap-eq').value });
  if (!q.ok) { $('cap-cotiz').innerHTML = `<div class="note bad">${esc(q.mensaje)}</div>`; $('cap-registrar').disabled = true; return; }
  $('cap-cotiz').innerHTML = `<div class="muted">${N.km(c.ruta.distanceMeters)} · ${N.minutos(c.ruta.durationMillis)}</div><div class="quote">${N.desgloseHTML(q)}</div>`;
  $('cap-registrar').disabled = false; $('cap-registrar').textContent = 'Registrar viaje · ' + dinero(q.total);
}
$('cap-registrar').onclick = async () => {
  const c = S.cap, nombre = $('cap-nombre').value.trim(), tel = $('cap-tel').value.replace(/\D/g, '');
  if (!nombre) return N.toast('Escribe el nombre del pasajero');
  const eq = +$('cap-eq').value, manual = $('cap-manual').checked;
  const q = N.cotizar(S.cfg, { o: c.o, d: c.d, distM: c.ruta.distanceMeters, durMs: c.ruta.durationMillis, equipaje: eq });
  if (!q.ok) return;
  $('cap-registrar').disabled = true;
  try {
    await N.addDoc(N.collection(N.db, 'viajes'), {
      pasajeroUid: S.uid, pasajero: { nombre, tel }, canal: 'central',
      origen: { lat: c.o.lat, lng: c.o.lng, txt: c.oTxt }, destino: { lat: c.d.lat, lng: c.d.lng, txt: c.dTxt },
      zonaO: q.zonaO, zonaD: q.zonaD,
      ruta: { distM: c.ruta.distanceMeters || 0, durMs: c.ruta.durationMillis || 0, desc: c.ruta.description || '', puntos: N.puntosDeRuta(c.ruta) },
      tarifa: { total: q.total, items: q.items, modo: q.modo }, equipaje: eq,
      estado: manual ? 'cola' : 'buscando', ofrecidoA: null, ofrecidoEco: null, ofertaExpira: 0, intentados: [], taxistaUid: null,
      creado: N.serverTimestamp(), creadoMs: Date.now(), dia: N.hoyISO(),
      bitacora: [N.item('Registrado por la central (llamada) · tarifa fija ' + dinero(q.total) + (manual ? ' · asignación manual' : ''))]
    });
    N.toast('Viaje registrado');
    [c.mkO, c.mkD].forEach(m => m && (m.map = null)); if (c.linea) c.linea.setMap(null);
    Object.assign(S.cap, { o: null, d: null, oTxt: '', dTxt: '', ruta: null, mkO: null, mkD: null, linea: null });
    ['cap-nombre', 'cap-tel'].forEach(id => $(id).value = ''); ['cap-txt-o', 'cap-txt-d', 'cap-cotiz'].forEach(id => $(id).innerHTML = '');
    $('cap-registrar').textContent = 'Registrar viaje';
  } catch (e) { console.error(e); N.toast('No se pudo registrar'); $('cap-registrar').disabled = false; }
};

/* --------------------------- Tarifas ------------------------------- */
const getPath = (o, p) => p.split('.').reduce((x, k) => x && x[k], o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((x, k) => x[k], o)[last] = v; };
function marcarSucio() { S.sucio = true; $('c-sucio').textContent = 'Cambios sin guardar'; probar(); }
function pintarFormulario() {
  const b = S.borrador; if (!b) return;
  $('c-modo').value = b.modo;
  document.querySelectorAll('[data-c]').forEach(el => el.value = getPath(b, el.dataset.c));
  $('c-festivohoy').checked = !!b.recargos.festivoHoy;
  $('c-fechas').value = (b.recargos.fechasFestivas || []).join(', ');
  $('c-simetrica').checked = b.matrizSimetrica !== false;
  pintarMatriz(); pintarListaZonas(); probar();
}
$('c-modo').onchange = e => { S.borrador.modo = e.target.value; marcarSucio(); };
document.querySelectorAll('[data-c]').forEach(el => el.addEventListener('change', () => { setPath(S.borrador, el.dataset.c, Math.max(0, +el.value || 0)); marcarSucio(); }));
$('c-festivohoy').onchange = e => { S.borrador.recargos.festivoHoy = e.target.checked; marcarSucio(); };
$('c-fechas').onchange = e => { S.borrador.recargos.fechasFestivas = e.target.value.split(/[,\s]+/).map(s => s.trim()).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)); marcarSucio(); };
$('c-simetrica').onchange = e => { S.borrador.matrizSimetrica = e.target.checked; marcarSucio(); };
$('c-guardar').onclick = async () => {
  if (S.dibujo) return N.toast('Termina o cancela la zona que estás dibujando');
  try {
    await N.setDoc(N.doc(N.db, 'config', 'tarifas'), S.borrador);
    S.sucio = false; $('c-sucio').textContent = ''; N.toast('Tarifas guardadas. Ya aplican para nuevos viajes.');
  } catch (e) { console.error(e); N.toast('No se pudo guardar: ' + e.code); }
};
window.addEventListener('beforeunload', e => { if (S.sucio) { e.preventDefault(); e.returnValue = ''; } });

function pintarMatriz() {
  const zs = S.borrador.zonas, m = S.borrador.matriz;
  if (!zs.length) { $('matriz').innerHTML = '<div class="empty">Primero dibuja o carga las zonas.</div>'; return; }
  $('matriz').innerHTML = '<table class="matriz"><tr><th></th>' + zs.map(z => `<th>${esc(z.nombre)}</th>`).join('') + '</tr>' +
    zs.map(a => `<tr><th style="text-align:left">${esc(a.nombre)}</th>` + zs.map(b => {
      const k = a.id + '|' + b.id; return `<td class="${a.id === b.id ? 'diag' : ''}"><input type="number" min="0" step="10" data-k="${k}" value="${m[k] ?? ''}"></td>`;
    }).join('') + '</tr>').join('') + '</table>';
  // selector de prueba
  const op = '<option value="">Fuera de zona</option>' + zs.map(z => `<option value="${z.id}">${esc(z.nombre)}</option>`).join('');
  const po = $('p-o').value, pd = $('p-d').value;
  $('p-o').innerHTML = op; $('p-d').innerHTML = op; $('p-o').value = po; $('p-d').value = pd;
}
$('matriz').addEventListener('change', e => {
  const k = e.target.dataset.k; if (!k) return;
  const v = e.target.value === '' ? null : Math.max(0, Math.round(+e.target.value));
  const [a, b] = k.split('|'), inv = b + '|' + a;
  const put = (key, val) => { if (val == null || val === 0) delete S.borrador.matriz[key]; else S.borrador.matriz[key] = val; };
  put(k, v);
  if (S.borrador.matrizSimetrica !== false && a !== b) { put(inv, v); const el = $('matriz').querySelector(`[data-k="${inv}"]`); if (el) el.value = v ?? ''; }
  marcarSucio();
});
['p-o', 'p-d', 'p-km', 'p-min'].forEach(id => $(id).addEventListener('input', probar));
function probar() {
  const b = S.borrador; if (!b) return;
  const zo = b.zonas.find(z => z.id === $('p-o').value), zd = b.zonas.find(z => z.id === $('p-d').value);
  const fuera = { lat: 0, lng: 0 };
  const q = N.cotizar(b, { o: zo ? N.centroide(zo.puntos) : fuera, d: zd ? N.centroide(zd.puntos) : fuera, distM: (+$('p-km').value || 0) * 1000, durMs: (+$('p-min').value || 0) * 60000 });
  $('p-res').innerHTML = q.ok ? `<div class="quote">${N.desgloseHTML(q)}<div class="muted">Calculado ${q.modo === 'zonas' ? 'por zona' : 'por kilómetro'} con la hora actual.</div></div>` : `<div class="note bad">${esc(q.mensaje)}</div>`;
}

/* ---------------------------- Zonas -------------------------------- */
async function pintarZonas() {
  if (!S.mapZ || !S.borrador) return;
  const L = await N.cargarMapas();
  S.polys.forEach(p => p.remove()); S.etiquetas.forEach(m => m.remove()); S.polys = []; S.etiquetas = [];
  for (const z of S.borrador.zonas) {
    const editable = S.editando === z.id;
    const poly = L.polygon(z.puntos.map(p => [p.lat, p.lng]), { color: z.color, weight: editable ? 3 : 2, fillColor: z.color, fillOpacity: editable ? .35 : .22, interactive: false }).addTo(S.mapZ);
    poly.bindTooltip(z.nombre, { permanent: true, direction: 'center', className: 'zlabel' }).openTooltip();
    S.polys.push(poly);
    if (editable) {
      // Vértices arrastrables: arrastra para mover; clic derecho (o mantener presionado) para borrar
      z.puntos.forEach((p, i) => {
        const v = L.marker([p.lat, p.lng], { draggable: true, icon: L.divIcon({ className: 'vtx', iconSize: [14, 14] }) }).addTo(S.mapZ);
        v.on('drag', e => { const q = e.target.getLatLng(); z.puntos[i] = { lat: +q.lat.toFixed(6), lng: +q.lng.toFixed(6) }; poly.setLatLngs(z.puntos.map(x => [x.lat, x.lng])); });
        v.on('dragend', () => marcarSucio());
        v.on('contextmenu', () => { if (z.puntos.length <= 3) return N.toast('Una zona necesita al menos 3 esquinas'); z.puntos.splice(i, 1); marcarSucio(); pintarZonas(); });
        S.etiquetas.push(v);
      });
      // Puntos intermedios: arrástralos para agregar una esquina nueva
      z.puntos.forEach((p, i) => {
        const q = z.puntos[(i + 1) % z.puntos.length], m = { lat: (p.lat + q.lat) / 2, lng: (p.lng + q.lng) / 2 };
        const v = L.marker([m.lat, m.lng], { draggable: true, opacity: .6, icon: L.divIcon({ className: 'vtx mid', iconSize: [10, 10] }) }).addTo(S.mapZ);
        v.on('dragend', e => { const r = e.target.getLatLng(); z.puntos.splice(i + 1, 0, { lat: +r.lat.toFixed(6), lng: +r.lng.toFixed(6) }); marcarSucio(); pintarZonas(); });
        S.etiquetas.push(v);
      });
    }
  }
  if (S.borrador.zonas.length && !S.zonasEncuadradas) { S.zonasEncuadradas = true; N.encuadrar(S.mapZ, S.borrador.zonas.flatMap(z => z.puntos)); }
}
function pintarListaZonas() {
  const zs = S.borrador.zonas;
  $('lista-zonas').innerHTML = zs.length ? zs.map(z => `<div class="zona"><span class="sw" style="background:${z.color}"></span>
    <input value="${esc(z.nombre)}" data-zn="${z.id}" class="grow" style="width:auto">
    <button class="btn ${S.editando === z.id ? 'ok' : 'ghost'} sm" data-ze="${z.id}">${S.editando === z.id ? 'Listo' : 'Editar forma'}</button>
    <button class="btn bad sm" data-zb="${z.id}">${S.confirmar === 'z' + z.id ? '¿Seguro?' : 'Eliminar'}</button></div>`).join('')
    : '<div class="empty">Aún no hay zonas. Dibuja la primera o carga las de ejemplo.</div>';
}
$('lista-zonas').addEventListener('change', e => { const id = e.target.dataset.zn; if (!id) return; const z = S.borrador.zonas.find(x => x.id === id); z.nombre = e.target.value.trim() || z.nombre; marcarSucio(); pintarMatriz(); pintarZonas(); });
$('lista-zonas').addEventListener('click', e => {
  const ed = e.target.dataset.ze, bo = e.target.dataset.zb;
  if (ed) { S.editando = S.editando === ed ? null : ed; pintarListaZonas(); pintarZonas(); }
  if (bo) {
    if (S.confirmar !== 'z' + bo) { S.confirmar = 'z' + bo; pintarListaZonas(); return; }
    S.confirmar = null;
    S.borrador.zonas = S.borrador.zonas.filter(z => z.id !== bo);
    Object.keys(S.borrador.matriz).forEach(k => { if (k.split('|').includes(bo)) delete S.borrador.matriz[k]; });
    marcarSucio(); pintarListaZonas(); pintarMatriz(); pintarZonas();
  }
});
$('z-nueva').onclick = async () => {
  if (S.dibujo) return;
  const L = await N.cargarMapas();
  S.editando = null; pintarListaZonas(); pintarZonas();
  const color = PALETA[S.borrador.zonas.length % PALETA.length];
  S.dibujo = { puntos: [], color, poly: L.polygon([], { color, fillColor: color, fillOpacity: .3, interactive: false, dashArray: '6 4' }).addTo(S.mapZ) };
  $('z-dibujo').classList.remove('hidden'); $('z-nombre').value = ''; $('z-nombre').focus();
};
function agregarVertice(p) { S.dibujo.puntos.push({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }); S.dibujo.poly.setLatLngs(S.dibujo.puntos.map(x => [x.lat, x.lng])); }
$('z-deshacer').onclick = () => { if (!S.dibujo) return; S.dibujo.puntos.pop(); S.dibujo.poly.setLatLngs(S.dibujo.puntos.map(x => [x.lat, x.lng])); };
function cerrarDibujo() { if (S.dibujo) S.dibujo.poly.remove(); S.dibujo = null; $('z-dibujo').classList.add('hidden'); }
$('z-cancelar').onclick = cerrarDibujo;
$('z-terminar').onclick = () => {
  const nombre = $('z-nombre').value.trim();
  if (S.dibujo.puntos.length < 3) return N.toast('Marca al menos 3 esquinas en el mapa');
  if (!nombre) return N.toast('Escribe el nombre de la zona');
  S.borrador.zonas.push({ id: 'z' + Date.now().toString(36), nombre, color: S.dibujo.color, puntos: S.dibujo.puntos });
  cerrarDibujo(); marcarSucio(); pintarListaZonas(); pintarMatriz(); pintarZonas();
  N.toast('Zona agregada. Captura sus tarifas en la matriz y guarda.');
};
$('z-ejemplo').onclick = () => {
  if (S.borrador.zonas.length && S.confirmar !== 'ejemplo') { S.confirmar = 'ejemplo'; $('z-ejemplo').textContent = 'Esto reemplaza tus zonas y la matriz. ¿Continuar?'; return; }
  S.confirmar = null; $('z-ejemplo').textContent = 'Cargar zonas de ejemplo (Los Cabos)';
  S.borrador.zonas = structuredClone(N.ZONAS_EJEMPLO); S.borrador.matriz = N.matrizEjemplo(S.borrador.zonas);
  S.zonasEncuadradas = false; marcarSucio(); pintarFormulario(); pintarZonas();
  N.toast('Zonas y tarifas de ejemplo cargadas: ajústalas y guarda');
};

/* ---------------------------- Taxistas ----------------------------- */
function pintarTaxistas() {
  const ts = [...S.taxistas].sort((a, b) => (a.aprobado === b.aprobado ? String(a.eco).localeCompare(String(b.eco), 'es', { numeric: true }) : a.aprobado ? 1 : -1));
  if (!ts.length) { setHTML('taxistas', '<div class="empty">Aún no hay taxistas registrados. Comparte con ellos el enlace de la app del taxista.</div>'); return; }
  setHTML('taxistas', '<table><tr><th>Eco.</th><th>Nombre</th><th>Placas</th><th>Contacto</th><th>Licencia</th><th>Tarjetón</th><th>Seguro pasajero</th><th>Estado</th><th></th></tr>' + ts.map(t => {
    const docs = t.docs || {}, ok = docs.licencia && docs.tarjeton && docs.seguro;
    const est = !t.aprobado ? '<span class="badge b-warn">Pendiente</span>' : t.ocupado ? '<span class="badge b-navy">En viaje</span>' : t.enLinea ? (vigente(t) ? '<span class="badge b-ok">Disponible</span>' : '<span class="badge b-bad">Sin señal</span>') : '<span class="badge b-mute">Desconectado</span>';
    return `<tr><td><b>${esc(t.eco)}</b></td><td>${esc(t.nombre)}</td><td>${esc(t.placas)}</td><td>${esc(t.telefono || '')}<div class="muted">${esc(t.email || '')}</div></td>
      ${['licencia', 'tarjeton', 'seguro'].map(k => `<td><input type="checkbox" data-doc="${k}" data-u="${t.uid}" ${docs[k] ? 'checked' : ''}></td>`).join('')}
      <td>${est}${t.posAt ? `<div class="muted">GPS ${N.hora(t.posAt)}</div>` : ''}</td>
      <td style="white-space:nowrap">${t.aprobado ? `<button class="btn bad sm" data-tx="suspender" data-u="${t.uid}">Suspender</button>` : `<button class="btn ok sm" data-tx="aprobar" data-u="${t.uid}" ${ok ? '' : 'disabled title="Marca los 3 documentos"'}>Aprobar</button>`}
      ${t.enLinea && !t.ocupado ? `<button class="btn ghost sm" data-tx="desconectar" data-u="${t.uid}">Desconectar</button>` : ''}</td></tr>`;
  }).join('') + '</table>');
}
$('taxistas').addEventListener('change', async e => {
  const k = e.target.dataset.doc, uid = e.target.dataset.u; if (!k) return;
  const t = S.taxistas.find(x => x.uid === uid);
  const cambios = { ['docs.' + k]: e.target.checked };
  if (!e.target.checked && t.aprobado) Object.assign(cambios, { aprobado: false, enLinea: false });
  try { await N.updateDoc(N.doc(N.db, 'taxistas', uid), cambios); if (cambios.aprobado === false) N.toast(`Unidad ${t.eco} suspendida hasta regularizar documentos`); } catch (er) { N.toast('No se pudo actualizar'); }
});
$('taxistas').addEventListener('click', async e => {
  const a = e.target.dataset.tx, uid = e.target.dataset.u; if (!a) return;
  const ref = N.doc(N.db, 'taxistas', uid);
  try {
    if (a === 'aprobar') await N.updateDoc(ref, { aprobado: true });
    if (a === 'suspender') await N.updateDoc(ref, { aprobado: false, enLinea: false });
    if (a === 'desconectar') await N.updateDoc(ref, { enLinea: false });
  } catch (er) { N.toast('No se pudo actualizar'); }
});

/* ---------------------------- Historial ---------------------------- */
$('h-dia').onchange = e => { S.histDia = e.target.value || N.hoyISO(); cargarHistorial(); };
function cargarHistorial() {
  if (S.unsubHist) S.unsubHist();
  S.unsubHist = N.onSnapshot(N.query(N.collection(N.db, 'viajes'), N.where('dia', '==', S.histDia)), q => {
    S.hist = q.docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => (b.creadoMs || 0) - (a.creadoMs || 0)); pintarHistorial();
  }, e => console.error(e));
}
function pintarHistorial() {
  const comp = S.hist.filter(v => v.estado === 'completado');
  const porUnidad = {};
  comp.forEach(v => { const k = v.taxista?.eco || '—'; porUnidad[k] = porUnidad[k] || { n: 0, t: 0 }; porUnidad[k].n++; porUnidad[k].t += v.tarifa?.total || 0; });
  $('corte').innerHTML = comp.length ? `<h3>Corte por unidad</h3><div class="chips" style="margin-bottom:12px">${Object.entries(porUnidad).sort((a, b) => b[1].t - a[1].t).map(([k, x]) => `<span class="chip">Unidad ${esc(k)} · ${x.n} viajes · ${dinero(x.t)}</span>`).join('')}
    <span class="chip near">Total · ${comp.length} viajes · ${dinero(comp.reduce((s, v) => s + (v.tarifa?.total || 0), 0))}</span></div>` : '';
  $('historial').innerHTML = S.hist.length ? '<table><tr><th>Folio</th><th>Hora</th><th>Ruta</th><th>Pasajero</th><th>Canal</th><th>Unidad</th><th>Tarifa</th><th>Estado</th><th>Validación</th><th>★</th></tr>' + S.hist.map(v => {
    const val = v.estado !== 'completado' ? '—' : (v.confirmadoPasajero ? '<span class="badge b-ok">Pasajero ✓</span> ' : '') + (v.gpsOk ? '<span class="badge b-ok">GPS ✓</span>' : '') + (!v.confirmadoPasajero && !v.gpsOk ? '<span class="badge b-bad">Sin validar</span>' : '');
    return `<tr data-h="${v.id}" style="cursor:pointer"><td><b>${N.folio(v.id)}</b></td><td>${v.creadoMs ? N.hora(v.creadoMs) : ''}</td><td>${ruta(v)}</td><td>${esc(v.pasajero?.nombre || '')}</td>
      <td>${v.canal === 'central' ? 'Teléfono' : 'App'}</td><td>${esc(v.taxista?.eco || '—')}</td><td>${dinero(v.tarifa?.total)}</td><td>${N.badge(v.estado)}</td><td>${val}</td><td>${v.calificacion || ''}</td></tr>
      ${S.histAbierto === v.id ? `<tr><td colspan="10"><div class="log">${(v.bitacora || []).map(l => `<div>${N.hora(l.t)} · ${esc(l.m)}</div>`).join('')}
      <div style="margin-top:6px"><b>Desglose:</b> ${(v.tarifa?.items || []).map(i => `${esc(i.l)} ${dinero(i.v)}`).join(' · ')}</div></div></td></tr>` : ''}`;
  }).join('') + '</table><p class="muted">Haz clic en un viaje para ver su bitácora.</p>' : '<div class="empty">No hay viajes en esta fecha.</div>';
}
$('historial').addEventListener('click', e => { const tr = e.target.closest('[data-h]'); if (!tr) return; S.histAbierto = S.histAbierto === tr.dataset.h ? null : tr.dataset.h; pintarHistorial(); });
$('h-csv').onclick = () => {
  const filas = [['Folio', 'Fecha', 'Hora', 'Salida', 'Llegada', 'Pasajero', 'Telefono', 'Canal', 'Unidad', 'Taxista', 'Km', 'Minutos', 'Modo tarifa', 'Tarifa', 'Estado', 'Validado pasajero', 'Validado GPS', 'Calificacion']];
  S.hist.forEach(v => filas.push([N.folio(v.id), v.dia, v.creadoMs ? N.hora(v.creadoMs) : '', v.origen?.txt, v.destino?.txt, v.pasajero?.nombre, v.pasajero?.tel, v.canal === 'central' ? 'Telefono' : 'App',
    v.taxista?.eco || '', v.taxista?.nombre || '', ((v.ruta?.distM || 0) / 1000).toFixed(1), Math.round((v.ruta?.durMs || 0) / 60000), v.tarifa?.modo, v.tarifa?.total,
    (N.ESTADOS[v.estado] || [v.estado])[0], v.confirmadoPasajero ? 'Si' : 'No', v.gpsOk ? 'Si' : 'No', v.calificacion || '']));
  const csv = '﻿' + filas.map(f => f.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `viajes-${S.histDia}.csv`; document.body.appendChild(a); a.click(); a.remove();
};
