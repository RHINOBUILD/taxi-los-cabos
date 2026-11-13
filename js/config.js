// =====================================================================
//  CONFIGURACIÓN — es el ÚNICO archivo que necesitas editar.
//  Sigue el README.md (pasos 1 a 3) para obtener estos valores.
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
  apiKey: '// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA4s0s_Jz44S-qN1gvTYyNl0qA-4GyDIyU",
  authDomain: "taxi-los-cabos-b006c.firebaseapp.com",
  projectId: "taxi-los-cabos-b006c",
  storageBucket: "taxi-los-cabos-b006c.firebasestorage.app",
  messagingSenderId: "961387638604",
  appId: "1:961387638604:web:f484ae0e8d6a78035be9e9"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);',
  authDomain: 'tu-proyecto.firebaseapp.com',
  projectId: 'tu-proyecto',
  storageBucket: 'tu-proyecto.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000'
};

// 3) Mapas con OpenStreetMap (sin clave ni costo)
export const MAPAS = {
  teselas: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  atribucion: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  osrm: 'https://router.project-osrm.org',   // rutas, distancia y tiempo (servidor público de prueba)
  photon: 'https://photon.komoot.io',        // buscador de direcciones
  busquedaDirecciones: true,
  factorTrafico: 1.2,                         // OSRM no considera tráfico: se suma 20 % al tiempo estimado
  limites: { oeste: -110.10, sur: 22.80, este: -109.40, norte: 23.30 } // área de búsqueda (Los Cabos)
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
