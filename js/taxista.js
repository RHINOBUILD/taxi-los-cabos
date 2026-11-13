// =====================================================================
//  APP DEL TAXISTA: se conecta, recibe ofertas con precio fijo,
//  acepta o rechaza, avanza el viaje y confirma el cobro en efectivo
// =====================================================================
import * as N from './nucleo.js';
const { $, esc, dinero } = N;

const S = {
  uid: null, yo: null, cfg: N.normalizarTarifas(), map: null, mkYo: null, pos: null, gpsError: '',
  watch: null, ultimoEnvio: { t: 0, pos: null }, ofertas: [], activo: null, activoCargado: false, hoy: [],
  wake: null, registro: false, pendienteRegistro: null, unsub: [], vistos: new Set(),
  mkO: null, mkD: null, linea: null, dibujadoId: null, terminarConfirm: false, termine: null
};
$('titulo').textContent = N.APP.nombre;
document.title = 'Taxista · ' + N.APP.nombre;

if (!N.configurado) N.bannerConfig(); else iniciar();

function vista(v) {
  ['v-login', 'v-pendiente', 'v-main'].forEach(id => $(id).classList.toggle('hidden', id !== v));
  $('btn-salir').classList.toggle('hidden', v === 'v-login');
}

/* ----------------------------- Acceso ----------------------------- */
function modoReg(r) {
  S.registro = r;
  $('t-entrar').classList.toggle('on', !r); $('t-registro').classList.toggle('on', r);
  $('reg-campos').classList.toggle('hidden', !r);
  $('btn-acceso').textContent = r ? 'Crear cuenta' : 'Entrar';
}
$('t-entrar').onclick = () => modoReg(false);
$('t-registro').onclick = () => modoReg(true);
function mensajeError(e) {
  return ({
    'auth/invalid-credential': 'Correo o contraseña incorrectos', 'auth/wrong-password': 'Contraseña incorrecta',
    'auth/user-not-found': 'No existe una cuenta con ese correo', 'auth/email-already-in-use': 'Ese correo ya tiene cuenta: usa "Entrar"',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres', 'auth/invalid-email': 'Correo no válido',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.'
  })[e.code] || ('Error: ' + (e.code || e.message));
}
$('btn-acceso').onclick = async () => {
  const email = $('l-email').value.trim(), pass = $('l-pass').value;
  try {
    if (S.registro) {
      const datos = { eco: $('r-eco').value.trim(), nombre: $('r-nombre').value.trim(), placas: $('r-placas').value.trim().toUpperCase(), telefono: $('r-tel').value.replace(/\D/g, ''), email };
      if (!datos.eco || !datos.nombre || !datos.placas) return N.toast('Completa número económico, nombre y placas');
      S.pendienteRegistro = datos;
      const u = N.auth.currentUser;
      if (u && !u.isAnonymous) { await crearPerfil(u.uid); iniciarSesion(u); return; }
      if (!email || pass.length < 6) return N.toast('Correo y contraseña (mínimo 6 caracteres)');
      await N.createUserWithEmailAndPassword(N.auth, email, pass);
    } else {
      if (!email || !pass) return N.toast('Escribe tu correo y contraseña');
      await N.signInWithEmailAndPassword(N.auth, email, pass);
    }
  } catch (e) { N.toast(mensajeError(e)); }
};
$('btn-olvide').onclick = async () => {
  const email = $('l-email').value.trim(); if (!email) return N.toast('Escribe tu correo arriba');
  try { await N.sendPasswordResetEmail(N.auth, email); N.toast('Te enviamos un correo para restablecer tu contraseña'); } catch (e) { N.toast(mensajeError(e)); }
};
$('btn-salir').onclick = async () => {
  if (S.activo) return N.toast('Termina tu viaje antes de salir');
  try { if (S.yo && S.yo.enLinea) await N.updateDoc(N.doc(N.db, 'taxistas', S.uid), { enLinea: false }); } catch (e) { }
  await N.signOut(N.auth); location.reload();
};
async function crearPerfil(uid) {
  await N.setDoc(N.doc(N.db, 'taxistas', uid), {
    ...S.pendienteRegistro, docs: { licencia: false, tarjeton: false, seguro: false },
    aprobado: false, enLinea: false, ocupado: false, pos: null, posAt: 0, creadoMs: Date.now()
  });
  S.pendienteRegistro = null;
}

function iniciar() {
  N.onAuthStateChanged(N.auth, u => { if (!u || u.isAnonymous) { S.unsub.forEach(f => f()); S.unsub = []; vista('v-login'); return; } iniciarSesion(u); });
}
async function iniciarSesion(u) {
  if (S.uid === u.uid && S.unsub.length) return;
  S.uid = u.uid;
  const ref = N.doc(N.db, 'taxistas', u.uid);
  const s = await N.getDoc(ref);
  if (!s.exists()) {
    if (S.pendienteRegistro) await crearPerfil(u.uid);
    else { vista('v-login'); modoReg(true); N.toast('Completa tus datos de registro'); return; }
  }
  S.unsub.push(N.onSnapshot(ref, d => {
    S.yo = { uid: u.uid, ...d.data() };
    if (!S.yo.aprobado) {
      vista('v-pendiente'); detenerGPS();
      $('pend-datos').textContent = `Unidad ${S.yo.eco} · ${S.yo.nombre} · ${S.yo.placas}`;
      return;
    }
    entrarOperacion(); sincronizarOcupado(); render();
  }));
  S.unsub.push(N.escucharTarifas(c => { S.cfg = c; render(); }));
  S.unsub.push(N.onSnapshot(N.query(N.collection(N.db, 'viajes'), N.where('ofrecidoA', '==', u.uid), N.where('estado', '==', 'ofrecido')), q => {
    S.ofertas = q.docs.map(x => ({ id: x.id, ...x.data() }));
    const nuevas = S.ofertas.filter(o => !S.vistos.has(o.id)); nuevas.forEach(o => S.vistos.add(o.id));
    if (nuevas.length) alerta();
    render(); dibujar();
  }, e => console.error(e)));
  S.unsub.push(N.onSnapshot(N.query(N.collection(N.db, 'viajes'), N.where('taxistaUid', '==', u.uid), N.where('estado', 'in', ['aceptado', 'en_origen', 'en_curso'])), q => {
    const prev = S.activo;
    S.activo = q.docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => (a.aceptadoAt || 0) - (b.aceptadoAt || 0))[0] || null;
    if (prev && !S.activo && S.termine !== prev.id) { N.toast('El viaje ' + N.folio(prev.id) + ' fue cancelado'); alerta(); }
    if (!prev && S.activo && S.activoCargado) { N.toast('La central te asignó el viaje ' + N.folio(S.activo.id)); alerta(); }
    S.activoCargado = true;
    sincronizarOcupado(); render(); dibujar();
  }, e => console.error(e)));
  S.unsub.push(N.onSnapshot(N.query(N.collection(N.db, 'viajes'), N.where('taxistaUid', '==', u.uid), N.where('diaCompletado', '==', N.hoyISO())), q => {
    S.hoy = q.docs.map(x => ({ id: x.id, ...x.data() })); render();
  }, e => console.error(e)));
}
function sincronizarOcupado() {
  if (!S.yo || !S.activoCargado) return;
  const debe = !!S.activo;
  if (!!S.yo.ocupado !== debe) N.updateDoc(N.doc(N.db, 'taxistas', S.uid), { ocupado: debe }).catch(console.error);
}

/* --------------------------- Mapa y GPS --------------------------- */
async function entrarOperacion() {
  vista('v-main');
  if (!S.map) {
    S.map = 'cargando';
    try { S.map = await N.crearMapa($('mapa')); } catch (e) { S.map = null; N.toast('No se pudo cargar el mapa'); return; }
    moverYo(); dibujar();
  }
  iniciarGPS();
}
function iniciarGPS() {
  if (S.watch != null || !navigator.geolocation) return;
  S.watch = navigator.geolocation.watchPosition(p => {
    S.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; S.gpsError = '';
    moverYo(); enviarPos(false);
  }, e => { S.gpsError = e.message || 'sin permiso'; render(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}
function detenerGPS() { if (S.watch != null) { navigator.geolocation.clearWatch(S.watch); S.watch = null; } }
const mapaListo = () => S.map && S.map !== 'cargando';
async function moverYo() {
  if (!mapaListo() || !S.pos) return;
  if (!S.mkYo) {
    S.mkYo = true;
    S.mkYo = await N.marcador(S.map, S.pos, { clase: 'taxi', texto: S.yo?.eco || '🚖' });
    S.map.panTo(S.pos); S.map.setZoom(14);
  } else if (S.mkYo !== true) {
    S.mkYo.position = S.pos;
    S.mkYo.content.className = 'mk taxi' + (S.activo ? ' ocupado' : '');
  }
}
async function enviarPos(forzar) {
  if (!S.yo || !S.yo.enLinea || !S.pos) return;
  const ahora = Date.now(), u = S.ultimoEnvio, op = N.OPERACION;
  const dist = u.pos ? N.haversine(u.pos, S.pos) : Infinity;
  const toca = (ahora - u.t >= op.gpsCadaSeg * 1000 && dist >= op.gpsMinMetros) || ahora - u.t >= 5 * 60000;
  if (!forzar && !toca) return;
  S.ultimoEnvio = { t: ahora, pos: S.pos };
  try { await N.updateDoc(N.doc(N.db, 'taxistas', S.uid), { pos: S.pos, posAt: ahora }); } catch (e) { console.error(e); }
}
setInterval(() => enviarPos(false), 30000); // latido: avisa que sigue conectado aunque esté estacionado

async function dibujar() {
  if (!mapaListo()) return;
  const v = S.activo || S.ofertas[0] || null;
  const id = v ? v.id + (S.activo ? ':a' : ':o') : null;
  if (id === S.dibujadoId) return;
  S.dibujadoId = id;
  [S.mkO, S.mkD].forEach(m => m && (m.map = null)); S.mkO = S.mkD = null;
  if (S.linea) { S.linea.setMap(null); S.linea = null; }
  if (!v) return;
  const a = await N.marcador(S.map, v.origen, { clase: 'a', texto: 'A' });
  const b = await N.marcador(S.map, v.destino, { clase: 'b', texto: 'B' });
  const l = await N.linea(S.map, v.ruta?.puntos?.length ? v.ruta.puntos : [v.origen, v.destino], { color: '#1b315c', grosor: 5 });
  if (S.dibujadoId !== id) { a.map = null; b.map = null; l.setMap(null); return; }
  S.mkO = a; S.mkD = b; S.linea = l;
  N.encuadrar(S.map, [S.pos, v.origen, v.destino]);
}

/* ------------------------ Conexión y alertas ---------------------- */
async function conectar() {
  prepararAudio();
  if (!S.pos) N.toast('Esperando señal de GPS…');
  try {
    await N.updateDoc(N.doc(N.db, 'taxistas', S.uid), { enLinea: true, ...(S.pos ? { pos: S.pos, posAt: Date.now() } : {}) });
    S.ultimoEnvio = { t: Date.now(), pos: S.pos };
    pedirWakeLock(); N.toast('Estás en línea');
  } catch (e) { console.error(e); N.toast('No se pudo conectar'); }
}
async function desconectar() {
  try { await N.updateDoc(N.doc(N.db, 'taxistas', S.uid), { enLinea: false }); } catch (e) { console.error(e); }
  try { S.wake && S.wake.release(); } catch (e) { } S.wake = null;
}
async function pedirWakeLock() { try { if ('wakeLock' in navigator) S.wake = await navigator.wakeLock.request('screen'); } catch (e) { } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.yo && S.yo.enLinea) { pedirWakeLock(); enviarPos(true); } });
let audio;
function prepararAudio() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) { } }
function alerta() {
  try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch (e) { }
  try {
    if (!audio) return;
    [0, .25, .5].forEach(t => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(.25, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + t + .2);
      o.start(audio.currentTime + t); o.stop(audio.currentTime + t + .22);
    });
  } catch (e) { }
}

/* ------------------------- Ciclo del viaje ------------------------ */
async function aceptar(id) {
  const me = S.yo;
  try {
    await N.runTransaction(N.db, async tx => {
      const ref = N.doc(N.db, 'viajes', id);
      const v = (await tx.get(ref)).data();
      if (!v || v.estado !== 'ofrecido' || v.ofrecidoA !== S.uid) throw new Error('expirada');
      tx.update(ref, {
        estado: 'aceptado', taxistaUid: S.uid,
        taxista: { eco: me.eco, nombre: me.nombre, placas: me.placas, telefono: me.telefono || '' },
        ofrecidoA: null, ofrecidoEco: null, aceptadoAt: Date.now(),
        bitacora: N.arrayUnion(N.item(`Aceptado por la unidad ${me.eco} · ${me.nombre}`))
      });
      tx.update(N.doc(N.db, 'taxistas', S.uid), { ocupado: true });
    });
    enviarPos(true); N.toast('Viaje aceptado. Ve por el pasajero.');
  } catch (e) { console.error(e); N.toast('La oferta ya no está disponible'); }
}
async function rechazar(id) {
  try {
    await N.updateDoc(N.doc(N.db, 'viajes', id), {
      estado: 'buscando', ofrecidoA: null, ofrecidoEco: null, intentados: N.arrayUnion(S.uid),
      bitacora: N.bitacora(`La unidad ${S.yo.eco} rechazó el viaje`)
    });
  } catch (e) { console.error(e); }
}
async function avanzar() {
  const v = S.activo; if (!v) return;
  const ref = N.doc(N.db, 'viajes', v.id);
  try {
    if (v.estado === 'aceptado') {
      await N.updateDoc(ref, { estado: 'en_origen', llegadaAt: Date.now(), bitacora: N.bitacora(`La unidad ${S.yo.eco} llegó al punto de salida`) });
    } else if (v.estado === 'en_origen') {
      await N.updateDoc(ref, { estado: 'en_curso', abordoAt: Date.now(), bitacora: N.bitacora('Pasajero a bordo') });
    } else if (v.estado === 'en_curso') {
      if (!S.terminarConfirm) { S.terminarConfirm = true; render(); setTimeout(() => { S.terminarConfirm = false; render(); }, 6000); return; }
      S.terminarConfirm = false;
      const gpsOk = !!S.pos && (N.haversine(S.pos, v.destino) <= N.OPERACION.radioValidacionM || (!!v.zonaD && N.zonaDe(S.cfg.zonas, S.pos)?.id === v.zonaD));
      S.termine = v.id;
      await N.updateDoc(ref, {
        estado: 'completado', completadoAt: Date.now(), diaCompletado: N.hoyISO(), gpsOk,
        bitacora: N.bitacora(`Viaje terminado · la unidad ${S.yo.eco} confirma cobro en efectivo de ${dinero(v.tarifa.total)}` + (gpsOk ? ' · GPS en destino ✓' : ' · GPS lejos del destino'))
      });
      await N.updateDoc(N.doc(N.db, 'taxistas', S.uid), { ocupado: false });
      N.toast('Viaje terminado. Cobraste ' + dinero(v.tarifa.total));
    }
    enviarPos(true);
  } catch (e) { console.error(e); N.toast('No se pudo actualizar el viaje'); }
}
function tarifaCoincide(v) {
  try {
    const q = N.cotizar(S.cfg, { o: v.origen, d: v.destino, distM: v.ruta?.distM || 0, durMs: v.ruta?.durMs || 0, equipaje: v.equipaje || 0, fecha: new Date(v.creadoMs || Date.now()) });
    return !q.ok || Math.abs(q.total - v.tarifa.total) <= 1;
  } catch (e) { return true; }
}

/* ---------------------------- Pantalla ---------------------------- */
let ultimo = '';
function render() {
  if (!S.yo || !S.yo.aprobado) return;
  const yo = S.yo, v = S.activo;
  const ofertas = v ? [] : S.ofertas.filter(o => Date.now() <= (o.ofertaExpira || 0) + 3000);
  const docsOk = yo.docs && yo.docs.licencia && yo.docs.tarjeton && yo.docs.seguro;
  let h = `<div class="online"><div><span class="pill" style="background:${yo.enLinea ? '#1f9d55' : '#b9c0cc'}"></span><b>${yo.enLinea ? 'En línea' : 'Desconectado'}</b>
    <div class="muted">Unidad ${esc(yo.eco)} · ${esc(yo.placas)}</div></div>
    ${v ? '' : `<button class="btn sm ${yo.enLinea ? 'ghost' : 'ok'}" data-a="online">${yo.enLinea ? 'Desconectarme' : 'Conectarme'}</button>`}</div>`;
  if (!docsOk) h += '<div class="note bad">La central marcó documentos pendientes. Acude a regularizarlos.</div>';
  if (S.gpsError) h += `<div class="note bad">GPS: ${esc(S.gpsError)}. Activa la ubicación del teléfono y da permiso a esta página.</div>`;
  if (yo.enLinea && !v) h += '<div class="muted" style="margin:-4px 0 8px">Mantén esta pantalla abierta para recibir viajes.</div>';
  ofertas.forEach(o => {
    const dist = S.pos ? N.km(N.haversine(S.pos, o.origen)) : '';
    h += `<div class="offer"><span class="cd" data-cd="${o.id}"></span><b style="font-size:16px;color:#0f1f3d">Nueva solicitud</b>
      <div class="pts"><div><i class="dot" style="background:#1f9d55"></i>${esc(o.origen.txt)}${dist ? ` <span class="muted">· a ${dist}</span>` : ''}</div>
      <div><i class="dot" style="background:#c53030"></i>${esc(o.destino.txt)}</div></div>
      <div class="muted">${N.km(o.ruta?.distM || 0)} · ${N.minutos(o.ruta?.durMs || 60000)} de viaje${o.equipaje ? ` · ${o.equipaje} equipaje extra` : ''}</div>
      <div class="big">${dinero(o.tarifa.total)} <span class="muted" style="font-size:12px;font-weight:600">efectivo · tarifa fija</span></div>
      <div class="row" style="margin-top:8px"><button class="btn ok grow" data-a="aceptar" data-id="${o.id}">Aceptar</button>
      <button class="btn bad" data-a="rechazar" data-id="${o.id}">Rechazar</button></div></div>`;
  });
  if (v) {
    const dest = v.estado === 'en_curso' ? v.destino : v.origen;
    const titulo = { aceptado: 'Ve por el pasajero', en_origen: 'Esperando al pasajero', en_curso: 'Llevando al pasajero' }[v.estado];
    const boton = {
      aceptado: 'Llegué al punto de salida', en_origen: 'Pasajero a bordo',
      en_curso: S.terminarConfirm ? `Confirmar: cobré ${dinero(v.tarifa.total)} en efectivo` : `Terminar viaje · cobrar ${dinero(v.tarifa.total)}`
    }[v.estado];
    h += `<div class="status"><div class="row"><h4 style="margin:0">${titulo}</h4><span class="muted" style="margin-left:auto">${N.folio(v.id)}</span></div>
      <p><b>${esc(v.pasajero?.nombre || 'Pasajero')}</b>${v.pasajero?.tel ? ` · <a href="tel:${esc(v.pasajero.tel)}">${esc(v.pasajero.tel)}</a>` : ''}${v.canal === 'central' ? ' · 📞 vía central' : ''}</p>
      <div class="pts"><div><i class="dot" style="background:#1f9d55"></i>${esc(v.origen.txt)}</div><div><i class="dot" style="background:#c53030"></i>${esc(v.destino.txt)}</div></div>
      <div class="qtotal"><span>Cobrar en efectivo</span><span>${dinero(v.tarifa.total)}</span></div>
      ${tarifaCoincide(v) ? '' : '<div class="note bad">Esta tarifa no coincide con el tabulador vigente. Repórtalo a la central.</div>'}</div>
      ${v.estado !== 'en_origen' ? `<a class="btn ghost block" style="margin-bottom:8px" href="${N.enlaceNavegar(dest)}" rel="noopener">🧭 Navegar (abrir app de mapas)</a>` : ''}
      <button class="btn ${v.estado === 'en_curso' ? 'ok' : 'gold'} block" data-a="avanzar">${boton}</button>`;
  } else if (yo.enLinea && !ofertas.length) h += '<div class="empty">Esperando solicitudes… te llegarán las más cercanas a tu ubicación.</div>';
  const hoy = [...S.hoy].sort((a, b) => (b.completadoAt || 0) - (a.completadoAt || 0));
  h += `<div class="online" style="margin-top:10px"><div><div class="muted">Hoy</div><b>${hoy.length} ${hoy.length === 1 ? 'viaje' : 'viajes'}</b></div>
    <div style="text-align:right"><div class="muted">Efectivo cobrado</div><b>${dinero(hoy.reduce((s, x) => s + (x.tarifa?.total || 0), 0))}</b></div></div>`;
  h += hoy.slice(0, 6).map(x => `<div class="qline"><span>${N.hora(x.completadoAt)} · ${esc(N.folio(x.id))}</span><span>${dinero(x.tarifa?.total)}</span></div>`).join('');
  h += '<div class="pie">Creado por RHINOBUILD</div>';
  if (h !== ultimo) { ultimo = h; $('panel').innerHTML = h; }
  document.querySelectorAll('[data-cd]').forEach(el => {
    const o = S.ofertas.find(x => x.id === el.dataset.cd);
    if (o) el.textContent = Math.max(0, Math.ceil((o.ofertaExpira - Date.now()) / 1000)) + ' s';
  });
}
$('panel').addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a;
  if (a === 'online') (S.yo.enLinea ? desconectar : conectar)();
  else if (a === 'aceptar') aceptar(b.dataset.id);
  else if (a === 'rechazar') rechazar(b.dataset.id);
  else if (a === 'avanzar') avanzar();
});
setInterval(() => { render(); if (S.mkYo && S.mkYo !== true) S.mkYo.content.className = 'mk taxi' + (S.activo ? ' ocupado' : ''); }, 1000);
