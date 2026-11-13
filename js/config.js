// =====================================================================
//  CONFIGURACIÓN — es el ÚNICO archivo que necesitas editar.
//  Sigue el README.md (pasos 1 a 4) para obtener estos valores.
// =====================================================================

// 1) Datos de la plataforma
export const APP = {
  nombre: 'Taxi Los Cabos',
  prefijoFolio: 'TLC',
  ciudad: 'Los Cabos, B.C.S.',
  centro: { lat: 22.98, lng: -109.80 }, // centro inicial del mapa
  zoom: 11
};

// 2) Firebase → Configuración del proyecto → Tus apps → App web → "firebaseConfig"
export const FIREBASE_CONFIG = {
  apiKey: 'PEGA_AQUI_TU_API_KEY_DE_FIREBASE',
  authDomain: 'tu-proyecto.firebaseapp.com',
  projectId: 'tu-proyecto',
  storageBucket: 'tu-proyecto.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000'
};

// 3) Google Cloud → APIs y servicios → Credenciales → Clave de API
export const GOOGLE_MAPS = {
  apiKey: 'PEGA_AQUI_TU_API_KEY_DE_GOOGLE_MAPS',
  mapId: 'DEMO_MAP_ID',        // cámbialo por tu propio Map ID (gratis) antes de producción
  busquedaDirecciones: true    // buscador de direcciones (Places). Ponlo en false para ahorrar consultas
};

// 4) Parámetros de operación
export const OPERACION = {
  segundosParaAceptar: 20,  // tiempo que tiene cada taxista para aceptar una oferta (la central puede cambiarlo)
  gpsCadaSeg: 20,           // cada cuánto el taxista envía su ubicación (mínimo)
  gpsMinMetros: 40,         // solo envía ubicación si se movió al menos esto
  etaCadaSeg: 60,           // cada cuánto se recalcula el tiempo estimado de llegada
  radioValidacionM: 400,    // el viaje se valida por GPS si el taxi termina a esta distancia del destino
  minutosUbicacionVigente: 10 // un taxista sin reportar ubicación en este tiempo no recibe ofertas
};
