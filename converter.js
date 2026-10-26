const inputTemp = document.getElementById('input-temp');
const inputUnit = document.getElementById('input-unit');
const outputUnit = document.getElementById('output-unit');
const outputTemp = document.getElementById('output-temp');

const nombres = { c: 'C', f: 'F', k: 'K' };

function toCelsius(valor, unidad) {
  if (unidad === 'f') return (valor - 32) * 5 / 9;
  if (unidad === 'k') return valor - 273.15;
  return valor;
}

function fromCelsius(celsius, unidad) {
  if (unidad === 'f') return celsius * 9 / 5 + 32;
  if (unidad === 'k') return celsius + 273.15;
  return celsius;
}

let ultimoResultado = NaN;

function convertir() {
  const valor = parseFloat(inputTemp.value);
  if (Number.isNaN(valor)) {
    ultimoResultado = NaN;
    outputTemp.textContent = '—';
    return;
  }
  const resultado = fromCelsius(toCelsius(valor, inputUnit.value), outputUnit.value);
  ultimoResultado = resultado;
  const texto = resultado.toLocaleString('es-MX', { maximumFractionDigits: 1 });
  outputTemp.textContent = `${texto} ${nombres[outputUnit.value]}`;
}

[inputTemp, inputUnit, outputUnit].forEach(el => el.addEventListener('input', () => { convertir(); publicarWidget(); }));
convertir();

// ---- Widget de Windows 11: guarda la última conversión y avisa al service worker ----
function publicarWidget() {
  const valor = parseFloat(inputTemp.value);
  if (Number.isNaN(valor) || !('caches' in window)) return;
  const celsius = toCelsius(valor, inputUnit.value);
  const fmt = (n) => n.toLocaleString('es-MX', { maximumFractionDigits: 1 });
  const datos = {
    conversion: `${fmt(valor)} ${nombres[inputUnit.value]} = ${outputTemp.textContent}`,
    celsius: `${fmt(celsius)} °C`,
    fahrenheit: `${fmt(fromCelsius(celsius, 'f'))} °F`,
    kelvin: `${fmt(fromCelsius(celsius, 'k'))} K`,
    hora: new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
  };
  caches.open('convertidor-widget')
    .then(c => c.put('widgets/ultimo.json', new Response(JSON.stringify(datos), { headers: { 'Content-Type': 'application/json' } })))
    .then(() => navigator.serviceWorker && navigator.serviceWorker.ready)
    .then(reg => reg && reg.active && reg.active.postMessage({ tipo: 'widget-actualizar' }))
    .catch(() => { /* sin caché: el widget conserva sus datos */ });
}

// ?nuevo=1 (botón "Nuevo" del widget): enfoca el campo de temperatura
if (new URLSearchParams(location.search).has('nuevo')) {
  inputTemp.focus();
  inputTemp.select();
}

// ---- Superposición de controles de ventana (Window Controls Overlay) ----
const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

const wcoStatus = document.getElementById('wco-status');

function actualizarEstadoWCO(rect) {
  const wco = navigator.windowControlsOverlay;
  const visible = wco.visible;
  const ancho = Math.round((rect || wco.getTitlebarAreaRect()).width);
  wcoStatus.textContent = visible ? `Superposición activa · ${ancho}px` : '';
  console.log(`The overlay is ${visible ? 'visible' : 'hidden'}, the title bar width is ${ancho}px`);
}

if ('windowControlsOverlay' in navigator) {
  actualizarEstadoWCO();
  navigator.windowControlsOverlay.addEventListener('geometrychange', debounce(e => {
    actualizarEstadoWCO(e.titlebarAreaRect);
  }, 200));
}

// ---- Controles de la barra de título ----
const $ = (id) => document.getElementById(id);

// 1. Intercambiar unidades
function intercambiar() {
  const resultado = ultimoResultado;
  const desde = inputUnit.value;
  inputUnit.value = outputUnit.value;
  outputUnit.value = desde;
  if (!Number.isNaN(resultado)) inputTemp.value = Math.round(resultado * 10) / 10;
  convertir();
  publicarWidget();
}
$('btn-swap').addEventListener('click', intercambiar);

// 2. Copiar resultado
$('btn-copy').addEventListener('click', async () => {
  const texto = `${inputTemp.value} ${nombres[inputUnit.value]} = ${outputTemp.textContent}`;
  try {
    await navigator.clipboard.writeText(texto);
    avisar('Copiado: ' + texto);
  } catch {
    avisar('No se pudo copiar');
  }
});

// 2b. Compartir resultado (lo abre el menú de export.js; menú nativo de compartir; si no existe, copia al portapapeles)
async function compartirNativo() {
  if (Number.isNaN(ultimoResultado)) { avisar('Nada que compartir'); return; }
  const texto = `${inputTemp.value} ${nombres[inputUnit.value]} = ${outputTemp.textContent}`;
  const datos = { title: 'Convertidor de temperatura', text: texto };
  if (/^https?:$/.test(location.protocol)) datos.url = location.href;
  try {
    if (navigator.share && (!navigator.canShare || navigator.canShare(datos))) {
      await navigator.share(datos);
      avisar('Compartido');
    } else {
      await navigator.clipboard.writeText(datos.url ? `${texto}\n${datos.url}` : texto);
      avisar('Copiado para compartir: ' + texto);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // el usuario canceló
    avisar('No se pudo compartir');
  }
}

// 3. Restablecer
function restablecer() {
  inputTemp.value = 22;
  inputUnit.value = 'c';
  outputUnit.value = 'f';
  convertir();
  publicarWidget();
  inputTemp.focus();
}
$('btn-reset').addEventListener('click', restablecer);

// 4. Tema claro / oscuro (se recuerda)
function aplicarTema(tema) {
  document.documentElement.dataset.theme = tema;
  try { localStorage.setItem('tc.tema', tema); } catch { /* sin almacenamiento */ }
}
try {
  const guardado = localStorage.getItem('tc.tema');
  if (guardado) document.documentElement.dataset.theme = guardado;
} catch { /* sin almacenamiento */ }
$('btn-theme').addEventListener('click', () => {
  const oscuro = document.documentElement.dataset.theme === 'dark';
  aplicarTema(oscuro ? 'light' : 'dark');
});

// 5. Pantalla completa
const btnFull = $('btn-full');
btnFull.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { avisar('No se pudo cambiar a pantalla completa'); }
});
document.addEventListener('fullscreenchange', () => {
  btnFull.setAttribute('aria-pressed', String(!!document.fullscreenElement));
});

// Mensaje breve en la barra de título
let avisoTimer;
function avisar(texto) {
  wcoStatus.textContent = texto;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => {
    wcoStatus.textContent = '';
    if ('windowControlsOverlay' in navigator) actualizarEstadoWCO();
  }, 2500);
}

// Atajos Alt + letra
document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  const ids = { s: 'btn-swap', c: 'btn-copy', r: 'btn-reset', t: 'btn-theme', p: 'btn-share' };
  const id = ids[e.key.toLowerCase()];
  if (id) { e.preventDefault(); $(id).click(); }
});

// ---- Service worker ----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => console.error('SW error', err));
}
