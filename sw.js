importScripts('pendientes.js');

const PREFIJO = 'temperature-converter-';
const CACHE_VERSION = 'v9';
const CACHE = PREFIJO + CACHE_VERSION;
// Caché propia del widget: su nombre no empieza con PREFIJO, así activate no la borra.
const CACHE_WIDGET = 'convertidor-widget';
const URL_ULTIMO = 'widgets/ultimo.json';
const TAG = 'convertidor-ultima';
// Etiqueta de la sincronización periódica que actualiza los archivos de la app.
const TAG_ACTUALIZAR = 'actualizar-app';
// Etiqueta de Background Sync: envía la cola de cambios pendientes cuando vuelve la red.
const TAG_SYNC = 'sincronizar-pendientes';
// Estado compartido con la página (el service worker no tiene localStorage).
const CACHE_ESTADO = 'convertidor-estado';
const URL_ESTADO = 'estado/sync.json';
const URL_DIAGNOSTICO = 'estado/diagnostico.json';
const ICONO = 'icons/icon512.png';
const PLANTILLA = 'widgets/convertidor-plantilla.json';
const DATOS = 'widgets/convertidor-datos.json';
const ARCHIVOS = ['./', './index.html', './converter.css', './converter.js', './export.js', './pendientes.js', './sincronizacion.js', PLANTILLA, DATOS];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIJO) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(actualizarWidgets)
  );
});

self.addEventListener('fetch', e => {
  // Las funciones de Vercel (/api/...) siempre van a la red: nunca se sirven desde la caché.
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

// ---- Widgets (panel de widgets de Windows 11) ----
async function leerJSON(ruta) {
  const r = await caches.match(ruta);
  return r ? r.text() : (await fetch(ruta)).text();
}

async function leerDatos() {
  const c = await caches.open(CACHE_WIDGET);
  const guardado = await c.match(URL_ULTIMO);
  return guardado ? guardado.text() : leerJSON(DATOS);
}

async function actualizarWidget(tag) {
  const [template, data] = await Promise.all([leerJSON(PLANTILLA), leerDatos()]);
  await self.widgets.updateByTag(tag, { template, data });
}

async function actualizarWidgets() {
  if (!self.widgets) return;
  const instalados = await self.widgets.matchAll({ tag: TAG });
  if (instalados && instalados.length) await actualizarWidget(TAG);
}

self.addEventListener('widgetinstall', e => {
  e.waitUntil((async () => {
    await actualizarWidget(e.widget.definition.tag);
    try {
      await self.registration.periodicSync.register(e.widget.definition.tag, { minInterval: 60 * 60 * 1000 });
    } catch { /* sin permiso de periodicSync */ }
  })());
});

self.addEventListener('widgetresume', e => {
  e.waitUntil(actualizarWidget(e.widget.definition.tag));
});

self.addEventListener('widgetuninstall', e => {
  e.waitUntil((async () => {
    const tag = e.widget.definition.tag;
    const restantes = await self.widgets.matchAll({ tag });
    if (!(restantes && restantes.length) && self.registration.periodicSync) {
      await self.registration.periodicSync.unregister(tag);
    }
  })());
});

// ---- Sincronización periódica en segundo plano: actualiza los archivos de la app ----
async function actualizarArchivos() {
  const c = await caches.open(CACHE);
  let fallos = 0;
  await Promise.all(ARCHIVOS.map(async ruta => {
    try {
      const r = await fetch(ruta, { cache: 'reload' });
      if (!r.ok) throw new Error(r.status);
      await c.put(ruta, r);
    } catch {
      fallos++; // sin red o error del servidor: se conserva la copia en caché
    }
  }));
  // Si no se pudo actualizar nada, la promesa se rechaza para indicar que la sincronización falló.
  if (fallos === ARCHIVOS.length) throw new Error('No se pudo actualizar la app');
  await actualizarWidgets();
}

self.addEventListener('periodicsync', e => {
  if (e.tag === TAG) e.waitUntil(actualizarWidgets());
  if (e.tag === TAG_ACTUALIZAR) e.waitUntil(actualizarPeriodica());
});

// Ejecución periódica: refresca los archivos; si falla sin red, deja un sync de reintento.
async function actualizarPeriodica() {
  const fecha = new Date().toISOString();
  try {
    await actualizarArchivos();
    await guardarEstado({ periodica: { fecha, ok: true } });
  } catch (err) {
    await guardarEstado({ periodica: { fecha, ok: false, error: mensajeError(err) } });
    try { await self.registration.sync.register(TAG_SYNC); } catch { /* sin Background Sync */ }
  }
}

// ---- Estado compartido con la página (Cache API + postMessage) ----
function mensajeError(err) {
  return String((err && err.message) || err);
}

async function guardarJSON(url, datos) {
  try {
    const c = await caches.open(CACHE_ESTADO);
    await c.put(url, new Response(JSON.stringify(datos), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* sin caché: la página simplemente no verá el estado */ }
}

async function leerEstado() {
  try {
    const c = await caches.open(CACHE_ESTADO);
    const r = await c.match(URL_ESTADO);
    return r ? await r.json() : {};
  } catch {
    return {};
  }
}

// Mezcla el estado nuevo con el guardado, lo persiste y avisa a las ventanas abiertas.
async function guardarEstado(parcial) {
  const estado = Object.assign(await leerEstado(), parcial);
  await guardarJSON(URL_ESTADO, estado);
  try {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    ventanas.forEach(v => v.postMessage({ tipo: 'estado-sync', estado }));
  } catch { /* sin ventanas */ }
  return estado;
}

// ---- Background Sync: vacía la cola de cambios pendientes ----
async function limpiarDistintivo() {
  try {
    if (self.navigator && self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch { /* distintivo no disponible */ }
}

async function sincronizarPendientes() {
  const fecha = new Date().toISOString();
  let pendientes = 0;
  try {
    pendientes = await pendContar();
    const ultimoId = await pendUltimoId();
    await actualizarArchivos(); // si falla, lanza y los pendientes se conservan
    await pendVaciar(ultimoId); // solo lo que se contó: lo añadido durante la sincronización queda en cola
    if (!(await pendContar())) await limpiarDistintivo();
    await guardarEstado({ sincronizacion: { fecha, ok: true, pendientes } });
  } catch (err) {
    await guardarEstado({ sincronizacion: { fecha, ok: false, pendientes, error: mensajeError(err) } });
    throw err; // el navegador reintentará más tarde
  }
  await notificarSincronizacion(pendientes);
}

self.addEventListener('sync', e => {
  if (e.tag === TAG_SYNC) e.waitUntil(sincronizarPendientes());
});

// ---- Notificaciones ----
const ACCIONES = [
  { action: 'abrir', title: 'Abrir' },
  { action: 'cerrar', title: 'Cerrar' }
];

// Guarda (y escribe en consola) qué pasó en cada intento, para depurar cuando Windows no muestra nada.
async function guardarDiagnostico(diag) {
  console.log('[notificaciones] diagnóstico', diag);
  await guardarJSON(URL_DIAGNOSTICO, diag);
}

async function notificarSincronizacion(pendientes) {
  const diag = { fecha: new Date().toISOString(), pendientes, permiso: 'desconocido', ventanas: [], resultado: '' };
  try {
    diag.permiso = self.Notification ? Notification.permission : 'no disponible';
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    diag.ventanas = ventanas.map(v => v.visibilityState);
    if (diag.permiso !== 'granted') {
      diag.resultado = 'sin permiso';
    } else if (!pendientes) {
      diag.resultado = 'sin pendientes';
    } else if (diag.ventanas.includes('visible')) {
      diag.resultado = 'app a la vista';
    } else {
      await self.registration.showNotification(
        pendientes === 1 ? 'Se actualizó 1 cambio' : `Se actualizaron ${pendientes} cambios`,
        {
          body: 'Tus conversiones hechas sin conexión ya están sincronizadas.',
          icon: ICONO,
          tag: 'sincronizacion',
          renotify: true,
          actions: ACCIONES
        }
      );
      diag.resultado = 'enviada';
    }
  } catch (err) {
    diag.resultado = mensajeError(err);
  }
  await guardarDiagnostico(diag);
}

async function abrirApp() {
  const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existente = ventanas.find(v => v.url.startsWith(self.registration.scope));
  if (existente && 'focus' in existente) return existente.focus();
  return self.clients.openWindow(new URL('./index.html', self.registration.scope).href);
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'cerrar') return;
  e.waitUntil(abrirApp());
});

// ---- Notificaciones push (enviadas desde la función /api/enviar de Vercel) ----
self.addEventListener('push', e => {
  let datos = {};
  if (e.data) {
    try { datos = e.data.json(); }
    catch { try { datos = { cuerpo: e.data.text() }; } catch { /* sin contenido legible */ } }
  }
  if (!datos || typeof datos !== 'object') datos = { cuerpo: String(datos) };
  // Con userVisibleOnly siempre hay que mostrar una notificación.
  e.waitUntil(self.registration.showNotification(datos.titulo || 'Convertidor de temperatura', {
    body: datos.cuerpo || '',
    icon: ICONO,
    tag: 'push',
    renotify: true,
    actions: ACCIONES
  }));
});

self.addEventListener('widgetclick', e => {
  const destino = e.action === 'nuevo' ? './index.html?nuevo=1' : './index.html';
  e.waitUntil(clients.openWindow(new URL(destino, self.registration.scope).href));
});

self.addEventListener('message', e => {
  if (e.data && e.data.tipo === 'widget-actualizar') e.waitUntil(actualizarWidgets());
});
