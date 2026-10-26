const PREFIJO = 'temperature-converter-';
const CACHE_VERSION = 'v6';
const CACHE = PREFIJO + CACHE_VERSION;
// Caché propia del widget: su nombre no empieza con PREFIJO, así activate no la borra.
const CACHE_WIDGET = 'convertidor-widget';
const URL_ULTIMO = 'widgets/ultimo.json';
const TAG = 'convertidor-ultima';
const PLANTILLA = 'widgets/convertidor-plantilla.json';
const DATOS = 'widgets/convertidor-datos.json';
const ARCHIVOS = ['./', './index.html', './converter.css', './converter.js', './export.js', PLANTILLA, DATOS];

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
  const instalados = await self.widgets.getByTag(TAG);
  if (instalados.length) await actualizarWidget(TAG);
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
    const restantes = await self.widgets.getByTag(tag);
    if (!restantes.length && self.registration.periodicSync) {
      await self.registration.periodicSync.unregister(tag);
    }
  })());
});

self.addEventListener('periodicsync', e => {
  if (e.tag === TAG) e.waitUntil(actualizarWidgets());
});

self.addEventListener('widgetclick', e => {
  const destino = e.action === 'nuevo' ? './index.html?nuevo=1' : './index.html';
  e.waitUntil(clients.openWindow(new URL(destino, self.registration.scope).href));
});

self.addEventListener('message', e => {
  if (e.data && e.data.tipo === 'widget-actualizar') e.waitUntil(actualizarWidgets());
});
