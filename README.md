# Taxi Los Cabos

Plataforma web de taxis con **tarifa fija definida por la base**, **pago en efectivo** y **asignación mixta** (automática a la unidad más cercana + respaldo de la central). Sin regateo: el pasajero ve el precio antes de pedir, el taxista acepta o rechaza, y al terminar cobra exactamente ese precio.

- **Pasajero** (`pasajero.html`): marca el punto A y el punto B (en el mapa, con su ubicación o escribiendo la dirección), ve las rutas posibles con distancia, tiempo estimado y precio, pide el taxi y sigue a la unidad con su tiempo estimado de llegada. Al final confirma el pago y califica.
- **Taxista** (`taxista.html`): se registra, la central lo aprueba, se conecta, recibe solicitudes cercanas con el precio ya calculado, acepta o rechaza, abre la navegación en su app de mapas (Google Maps, Waze u otra) y confirma el cobro en efectivo.
- **Central** (`central.html`): define tarifas (por zonas, por kilómetro o mixto), dibuja las zonas en el mapa, ve a las unidades en vivo, asigna o reasigna viajes, captura viajes por teléfono, aprueba taxistas y consulta el historial con el corte por unidad.

Todo funciona con **GitHub Pages + Firebase (plan gratuito Spark) + OpenStreetMap**. Los mapas, las rutas y el buscador de direcciones **no requieren clave ni tarjeta**. No necesitas instalar nada en tu computadora: todo se configura desde el navegador.

---

## Cómo se calcula el precio

La central elige el **modo de tarifa**:

| Modo | Cómo cobra |
|---|---|
| **Mixto** (recomendado) | Si la salida y la llegada caen en zonas con tarifa registrada en la matriz, cobra esa tarifa fija. Si no, cobra por kilómetro. |
| **Solo zonas** | Solo da servicio entre zonas con tarifa registrada. |
| **Solo kilómetro** | Banderazo + $ por km + $ por minuto, con tarifa mínima. |

Después se suman los **recargos** configurados: nocturno (% y horario), día festivo (% y fechas) y equipaje extra ($ por pieza), y se redondea a $1, $5 o $10.

El precio se guarda en el viaje al momento de pedirlo y **nadie puede cambiarlo después**: ni el pasajero ni el taxista tienen permiso en la base de datos para modificar la tarifa.

## Cómo se asignan los viajes

1. El pasajero pide el taxi y el sistema lo ofrece a la **unidad disponible más cercana**, que tiene unos segundos (20 por defecto) para aceptar.
2. Si la rechaza o no responde, se ofrece a la siguiente más cercana.
3. Si ninguna acepta, el viaje pasa a la **cola de la central**, que lo asigna con un clic.
4. La central puede asignar o reasignar cualquier viaje en cualquier momento, y capturar viajes que llegan por teléfono.

---

## Instalación paso a paso

### Paso 1. Crear el proyecto de Firebase
1. Entra a <https://console.firebase.google.com> y crea un proyecto (por ejemplo `taxi-los-cabos`). Puedes desactivar Google Analytics.
2. En la página principal del proyecto, haz clic en el ícono **`</>` (Web)** para registrar una app web. Ponle un nombre y **no** marques Firebase Hosting.
3. Firebase te mostrará un bloque `firebaseConfig`. Copia esos valores en **`js/config.js`**, en la sección `FIREBASE_CONFIG`.

### Paso 2. Activar el inicio de sesión
En Firebase → **Authentication** → **Comenzar** → pestaña **Método de acceso**, activa:
- **Anónimo** (para los pasajeros, que no necesitan crear cuenta).
- **Correo electrónico/contraseña** (para taxistas y central).

En **Authentication → Configuración → Dominios autorizados**, agrega el dominio de GitHub Pages: `rhinobuild.github.io` (o el de tu cuenta).

### Paso 3. Crear la base de datos y sus reglas
1. Firebase → **Firestore Database** → **Crear base de datos** → modo **producción** → elige una ubicación (por ejemplo `nam5 (United States)`).
2. Pestaña **Reglas**: borra lo que tenga, pega **todo** el contenido del archivo `firestore.rules` y haz clic en **Publicar**.

### Paso 4. Mapas (OpenStreetMap) — no requiere configuración
La plataforma usa servicios abiertos, sin clave:

| Función | Servicio | Ajuste en `js/config.js` |
|---|---|---|
| Mapa | Teselas de OpenStreetMap con Leaflet | `MAPAS.teselas` |
| Rutas alternativas, distancia y tiempo | OSRM (servidor público) | `MAPAS.osrm` |
| Buscador de direcciones | Photon (Komoot) | `MAPAS.photon`, `MAPAS.busquedaDirecciones` |

- **OSRM no considera el tráfico en tiempo real.** Por eso el tiempo estimado se multiplica por `MAPAS.factorTrafico` (1.2 = +20 %). Ajústalo según la experiencia en la ciudad.
- El buscador está limitado al área de Los Cabos (`MAPAS.limites`). Si una dirección no aparece, el pasajero puede tocar el mapa o usar su ubicación.
- Los servidores públicos de OpenStreetMap, OSRM y Photon son gratuitos pero **no garantizan disponibilidad** y piden uso moderado. Para un piloto son suficientes. Si la operación crece, cambia esas tres direcciones en `config.js` por un proveedor con plan (por ejemplo MapTiler, Stadia Maps, Geoapify) o por servidores propios; el resto del código no cambia.

### Paso 5. Publicar en GitHub Pages
1. En GitHub, crea un repositorio nuevo (por ejemplo `RHINOBUILD/taxi-los-cabos`).
2. **Add file → Upload files** y arrastra **todo el contenido** de esta carpeta (incluidas las carpetas `css`, `js` e `img`). Haz *Commit*.
3. **Settings → Pages → Build and deployment**: *Deploy from a branch*, rama `main`, carpeta `/ (root)` → **Save**.
4. En uno o dos minutos tu plataforma estará en `https://rhinobuild.github.io/taxi-los-cabos/`.

Cada vez que edites `js/config.js` u otro archivo en GitHub, la página se actualiza sola.

> Si el repositorio ya existe (por ejemplo `RHINOBUILD/taxi-los-cabos`), solo activa Pages en **Settings → Pages**.

### Paso 6. Crear el usuario de la central
1. Firebase → **Authentication → Usuarios → Agregar usuario**: escribe el correo y la contraseña del operador de la central.
2. Abre `https://…/central.html` e inicia sesión. Aparecerá el mensaje *Sin permiso de central* con un **UID**: cópialo.
3. Firebase → **Firestore Database → Iniciar colección** → ID de colección: `admins` → ID del documento: **pega el UID** → agrega un campo `nombre` (texto) con el nombre del operador → **Guardar**.
4. Recarga `central.html`. Repite estos pasos por cada operador.

### Paso 7. Configurar tarifas y zonas
En la central → **Tarifas y zonas**:
1. Haz clic en **Cargar zonas de ejemplo (Los Cabos)** o dibuja tus propias zonas con **+ Nueva zona** (clic en cada esquina del área).
2. Con **Editar forma** puedes arrastrar los vértices para ajustar cada zona. **Las zonas de ejemplo son aproximadas: revísalas.**
3. Captura la **matriz de tarifas** (salida ↓ · llegada →). Las de ejemplo son solo de referencia.
4. Ajusta el tabulador por kilómetro, los recargos y el modo de tarifa.
5. Usa **Probar una tarifa** para verificar, y luego **Guardar cambios**.

### Paso 8. Dar de alta a los taxistas
1. Comparte con los taxistas el enlace `https://…/taxista.html`. Cada uno se registra con su correo, número económico, placas y teléfono.
2. En la central → **Taxistas**, marca sus documentos vigentes (licencia, tarjetón y seguro de pasajero) y haz clic en **Aprobar**.
3. El taxista ya puede tocar **Conectarme** y empezar a recibir viajes.

### Paso 9. Instalar en el celular
Abre `pasajero.html` o `taxista.html` en Chrome (Android) o Safari (iPhone) y elige **Agregar a pantalla de inicio**. Queda como un ícono de app.

---

## Archivos

```
index.html          Portada con acceso a las tres apps
pasajero.html       App del pasajero
taxista.html        App del taxista
central.html        Central de la base
js/config.js        ← ÚNICO archivo a editar (claves y parámetros)
js/nucleo.js        Firebase, mapas (OpenStreetMap/OSRM/Photon), motor de tarifas y asignación
js/pasajero.js      Lógica del pasajero
js/taxista.js       Lógica del taxista
js/central.js       Lógica de la central
css/estilos.css     Estilos (azul marino y dorado)
firestore.rules     Reglas de seguridad de la base de datos
manifest-*.json     Instalación como app en el celular
img/icono.svg       Ícono
```

## Datos en Firestore

| Colección | Contenido |
|---|---|
| `config/tarifas` | Modo de tarifa, tabulador por km, recargos, zonas (polígonos) y matriz de tarifas |
| `taxistas/{uid}` | Número económico, nombre, placas, documentos, aprobado, en línea, ocupado, última ubicación |
| `viajes/{id}` | Pasajero, salida, llegada, ruta, tarifa con desglose, estado, taxista, bitácora, validación y calificación |
| `admins/{uid}` | Usuarios con acceso a la central |

Estados de un viaje: `buscando → ofrecido → aceptado → en_origen → en_curso → completado` (o `cola` si nadie acepta, o `cancelado`).

## Límites del plan gratuito y consumo

- **Firestore (Spark)**: tiene un límite diario de lecturas y escrituras. Para cuidarlo, el taxista solo envía su ubicación cada 20 s **y** si se movió 40 m o más (y un aviso cada 5 min si está estacionado). Puedes ajustar `gpsCadaSeg` y `gpsMinMetros` en `config.js`. Con decenas de taxistas conectados todo el día, conviene pasar al plan **Blaze** (pago por uso, normalmente de bajo costo).
- **Mapas y rutas**: cada vez que el pasajero marca A y B se pide una ruta a OSRM, y mientras espera su taxi se recalcula el tiempo de llegada cada 60 s (`etaCadaSeg`) solo si el taxi se movió. El taxista navega con la app de mapas de su teléfono.

## Limitaciones conocidas (versión web)

- **Tiempos sin tráfico real**: OSRM calcula con velocidades típicas de cada calle; el tiempo mostrado es una estimación.
- **El taxista debe mantener la app abierta** para recibir ofertas y enviar su ubicación (la app pide mantener la pantalla encendida). Las apps web no reciben avisos con la app cerrada; para eso se necesita una app nativa o notificaciones push con Cloud Functions (plan Blaze).
- **La tarifa se calcula en el teléfono del pasajero** con el tabulador oficial. Las reglas impiden modificarla después de creada el viaje, y la app del taxista muestra un aviso si no coincide con el tabulador vigente. Para blindarla por completo se necesita calcularla en un servidor (Cloud Functions, plan Blaze).
- Los datos del taxista asignado (nombre, número económico, placas y teléfono) son visibles para el pasajero de ese viaje, y la ubicación de las unidades conectadas es visible para la app del pasajero (para encontrar la más cercana).

## Antes de operar con el público

- Consulta con la autoridad de movilidad de Baja California Sur qué registro o permiso aplica a una plataforma para taxis concesionados.
- Publica un aviso de privacidad (se guardan nombre, teléfono y ubicaciones).
- Sustituye las zonas y tarifas de ejemplo por el tabulador oficial de la base.

---
Creado por RHINOBUILD
