/* Conexión, cola de pendientes, sincronización en segundo plano, distintivo, notificaciones y push.
   Se carga después de converter.js y reutiliza sus globales ($, debounce, avisar, inputTemp, nombres…). */
const TAG_SYNC_PENDIENTES = 'sincronizar-pendientes';
const TAG_SYNC_PERIODICA = 'actualizar-app';

const puntoConexion = $('punto-conexion');
const textoConexion = $('texto-conexion');
const textoPendientes = $('texto-pendientes');
const textoSync = $('texto-sync');
const textoAviso = $('texto-aviso');
const btnNotif = $('btn-notif');
const btnPush = $('btn-push');

// Mensaje visible en la propia tarjeta de estado (la barra de título se oculta en ventanas estrechas).
let avisoEstadoTimer;
function avisarEstado(texto, ms = 4000) {
  textoAviso.textContent = texto;
  textoAviso.hidden = false;
  avisar(texto, ms);
  clearTimeout(avisoEstadoTimer);
  avisoEstadoTimer = setTimeout(() => { textoAviso.hidden = true; }, ms);
}

// ---- 1. Indicador de conexión ----
function pintarConexion() {
  const enLinea = navigator.onLine;
  puntoConexion.classList.toggle('offline', !enLinea);
  textoConexion.textContent = enLinea ? 'En línea' : 'Sin conexión · puedes seguir calculando';
}
window.addEventListener('online', () => {
  pintarConexion();
  if (pendientes > 0) pedirSync(); // por si el navegador aún no había disparado el sync
});
window.addEventListener('offline', pintarConexion);
pintarConexion();

// Estado de las sincronizaciones: lo escribe el service worker en la Cache API y avisa con postMessage.
let estadoSync = {};
let estadoPeriodica = 'comprobando…'; // activa | sin permiso | no disponible

function horaLocal(iso) {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? '' : fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

function pintarSync() {
  const ultima = estadoSync.periodica && estadoSync.periodica.fecha;
  let texto = `Sincronización periódica: ${estadoPeriodica}`;
  if (ultima) texto += ` · última ejecución ${horaLocal(ultima)}`;
  else if (estadoPeriodica === 'activa') texto += ' · aún sin ejecutarse';
  textoSync.textContent = texto;
}

async function leerEstadoGuardado() {
  try {
    const cache = await caches.open('convertidor-estado');
    const r = await cache.match('estado/sync.json');
    if (r) estadoSync = await r.json();
  } catch { /* sin caché */ }
  pintarSync();
}

// ---- 2. Cola de cambios pendientes ----
let pendientes = 0;

// ---- 5. Distintivo del icono (App Badging API) ----
async function pintarDistintivo(n) {
  try {
    if (n > 0 && 'setAppBadge' in navigator) await navigator.setAppBadge(n);
    else if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
  } catch { /* distintivo no disponible (app sin instalar) */ }
}

async function actualizarPendientes() {
  try { pendientes = await pendContar(); } catch { pendientes = 0; }
  if (pendientes > 0) {
    textoPendientes.textContent = `${pendientes} ${pendientes === 1 ? 'cambio pendiente' : 'cambios pendientes'} de actualizar`;
    textoPendientes.hidden = false;
  } else {
    textoPendientes.hidden = true;
  }
  pintarDistintivo(pendientes);
}

// ---- 3. Background Sync ----
async function pedirSync() {
  try {
    const registro = await navigator.serviceWorker.ready;
    if (registro.sync) await registro.sync.register(TAG_SYNC_PENDIENTES);
  } catch (err) {
    console.warn('Background Sync no disponible', err);
  }
}

// Sin conexión, cada conversión se guarda en la cola (con retraso para no guardar cada pulsación).
const guardarConversionPendiente = debounce(async () => {
  const valor = parseFloat(inputTemp.value);
  if (Number.isNaN(valor)) return;
  try {
    await pendAgregar({
      entrada: `${valor} ${nombres[inputUnit.value]}`,
      resultado: outputTemp.textContent,
      fecha: new Date().toISOString()
    });
  } catch (err) {
    console.warn('No se pudo guardar el cambio pendiente', err);
    return;
  }
  await actualizarPendientes();
  pedirSync();
}, 600);

function alCambiarConversion() {
  if (!navigator.onLine) guardarConversionPendiente();
}
[inputTemp, inputUnit, outputUnit].forEach(el => el.addEventListener('input', alCambiarConversion));
$('btn-swap').addEventListener('click', alCambiarConversion);
$('btn-reset').addEventListener('click', alCambiarConversion);

// ---- Aviso de push dentro de la app (baja desde arriba) ----
const bannerPush = $('banner-push');
let bannerTimer;
function ocultarBanner() {
  clearTimeout(bannerTimer);
  bannerPush.classList.remove('visible');
  setTimeout(() => { if (!bannerPush.classList.contains('visible')) bannerPush.hidden = true; }, 400);
}
function mostrarBanner(titulo, cuerpo) {
  $('banner-titulo').textContent = titulo;
  $('banner-cuerpo').textContent = cuerpo;
  bannerPush.hidden = false;
  void bannerPush.offsetWidth; // fuerza el reflujo para que la animación arranque
  bannerPush.classList.add('visible');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(ocultarBanner, 7000);
}
$('banner-cerrar').addEventListener('click', ocultarBanner);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data && e.data.tipo === 'push-app' && document.visibilityState === 'visible') {
      mostrarBanner(e.data.titulo, e.data.cuerpo);
    }
    if (e.data && e.data.tipo === 'estado-sync') {
      estadoSync = e.data.estado || {};
      pintarSync();
      actualizarPendientes();
    }
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { leerEstadoGuardado(); actualizarPendientes(); }
});

// ---- 4. Sincronización periódica (solo Edge/Chromium con la app instalada) ----
async function registrarSyncPeriodica() {
  try {
    if (!('serviceWorker' in navigator)) { estadoPeriodica = 'no disponible'; return; }
    const registro = await navigator.serviceWorker.ready;
    if (!registro.periodicSync) { estadoPeriodica = 'no disponible'; return; }
    const permiso = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (permiso.state !== 'granted') { estadoPeriodica = 'sin permiso'; return; }
    await registro.periodicSync.register(TAG_SYNC_PERIODICA, { minInterval: 60 * 60 * 1000 });
    estadoPeriodica = 'activa';
  } catch (err) {
    estadoPeriodica = 'no disponible';
    console.warn('Sincronización periódica no disponible', err);
  } finally {
    pintarSync();
  }
}

// ---- 7. Notificaciones push ----
let suscripcionActual = null;

function claveAUint8(base64url) {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const binario = atob((base64url + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binario, c => c.charCodeAt(0));
}

// Devuelve la suscripción existente o, si `crear`, pide la clave pública al servidor y suscribe.
async function obtenerSuscripcion(crear) {
  const registro = await navigator.serviceWorker.ready;
  if (!registro.pushManager) return null;
  const existente = await registro.pushManager.getSubscription();
  if (existente || !crear) return existente;
  const respuesta = await fetch('/api/clave', { cache: 'no-store' });
  if (!respuesta.ok) throw new Error(`/api/clave respondió ${respuesta.status}`);
  const { clave } = await respuesta.json();
  if (typeof clave !== 'string' || !clave) throw new Error('El servidor no devolvió la clave pública');
  return registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveAUint8(clave) });
}

// ---- 6. Botones de notificaciones ----
function pintarBotones() {
  btnNotif.hidden = !('Notification' in window) || Notification.permission !== 'default';
  btnPush.hidden = !suscripcionActual;
}

async function iniciarPush(crear) {
  try {
    suscripcionActual = await obtenerSuscripcion(crear);
  } catch (err) {
    suscripcionActual = null; // sin servidor de push: la app funciona igual y el botón no aparece
    console.warn('Push no disponible', err);
  }
  pintarBotones();
}

btnNotif.addEventListener('click', async () => {
  try {
    const permiso = await Notification.requestPermission();
    avisarEstado(permiso === 'granted' ? 'Notificaciones activadas'
      : permiso === 'denied' ? 'Notificaciones bloqueadas' : 'Notificaciones sin activar');
    pintarBotones();
    if (permiso === 'granted') iniciarPush(true);
  } catch {
    avisarEstado('No se pudieron activar las notificaciones');
  }
});

btnPush.addEventListener('click', async () => {
  if (!suscripcionActual) return;
  try {
    const respuesta = await fetch('/api/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        suscripcion: suscripcionActual.toJSON(),
        titulo: 'Push de prueba desde Vercel',
        cuerpo: 'Si ves esta notificación, el push funciona.'
      })
    });
    if (respuesta.status === 410) {
      try { await suscripcionActual.unsubscribe(); } catch { /* ya cancelada */ }
      suscripcionActual = null;
      pintarBotones();
      avisarEstado('La suscripción caducó y se canceló. Recarga la app para suscribirte de nuevo.', 8000);
      return;
    }
    if (!respuesta.ok) {
      let detalle = '';
      try { const d = await respuesta.json(); detalle = d.detalle || d.error || ''; } catch { /* sin JSON */ }
      avisarEstado(`No se pudo enviar el push (${respuesta.status})${detalle ? ': ' + detalle : ''}`, 8000);
      return;
    }
    avisarEstado('Push enviado');
  } catch {
    avisarEstado(navigator.onLine ? 'No se pudo contactar con el servidor' : 'Sin conexión: no se puede enviar el push', 6000);
  }
});

// ---- Arranque ----
leerEstadoGuardado();
actualizarPendientes();
registrarSyncPeriodica();
pintarBotones();
if ('Notification' in window && Notification.permission === 'granted') iniciarPush(true);
else iniciarPush(false); // si ya hay una suscripción, muestra el botón de prueba
