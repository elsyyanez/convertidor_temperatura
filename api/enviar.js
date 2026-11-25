// Envía una notificación push a la suscripción que manda la página (sin base de datos).
const webpush = require('web-push');

// Solo se aceptan servicios de push de navegadores. Las expresiones están ancladas (^…$) y se
// comparan con el nombre de host, así que "fcm.googleapis.com.evil.com" se rechaza.
const HOSTS_PERMITIDOS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^(?:[a-z0-9-]+\.)+push\.services\.mozilla\.com$/,
  /^(?:[a-z0-9-]+\.)+notify\.windows\.com$/,
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/
];

function endpointPermitido(endpoint) {
  if (typeof endpoint !== 'string') return false;
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  return HOSTS_PERMITIDOS.some(re => re.test(url.hostname));
}

const esTexto = v => typeof v === 'string' && v.length > 0;

// Solo la primera frase del error, para no repetir valores de las variables de entorno.
function primeraFrase(mensaje) {
  return String(mensaje || 'error desconocido').split(/\.\s|\n/)[0].replace(/\.$/, '').slice(0, 120);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Método no permitido' });
    return;
  }

  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = process.env;
  if (!publicKey || !privateKey || !subject) {
    res.status(503).json({ error: 'Push no configurado en el servidor' });
    return;
  }

  let cuerpo = req.body;
  if (typeof cuerpo === 'string') {
    try { cuerpo = JSON.parse(cuerpo); } catch { cuerpo = null; }
  }
  const suscripcion = cuerpo && cuerpo.suscripcion;
  if (!suscripcion || !esTexto(suscripcion.endpoint) ||
      !suscripcion.keys || !esTexto(suscripcion.keys.p256dh) || !esTexto(suscripcion.keys.auth)) {
    res.status(400).json({ error: 'Suscripción no válida' });
    return;
  }
  if (!endpointPermitido(suscripcion.endpoint)) {
    res.status(400).json({ error: 'El servicio de push de la suscripción no está permitido' });
    return;
  }

  const titulo = (typeof cuerpo.titulo === 'string' && cuerpo.titulo ? cuerpo.titulo : 'Convertidor de temperatura').slice(0, 60);
  const texto = (typeof cuerpo.cuerpo === 'string' ? cuerpo.cuerpo : '').slice(0, 120);

  try {
    await webpush.sendNotification(
      { endpoint: suscripcion.endpoint, keys: { p256dh: suscripcion.keys.p256dh, auth: suscripcion.keys.auth } },
      JSON.stringify({ titulo, cuerpo: texto }),
      { TTL: 60, vapidDetails: { subject, publicKey, privateKey } }
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err && (err.statusCode === 404 || err.statusCode === 410)) {
      res.status(410).json({ error: 'Suscripción caducada' });
      return;
    }
    const estado = err && err.statusCode;
    const detalle = estado ? `el servicio de push respondió ${estado}` : primeraFrase(err && err.message);
    let servicio = '';
    try { servicio = new URL(suscripcion.endpoint).hostname; } catch { /* ya validado */ }
    console.error('[push] fallo al enviar', {
      estado,
      detalle,
      servicio,
      respuesta: err && err.body ? String(err.body).slice(0, 300) : undefined
    });
    res.status(502).json({ error: 'No se pudo enviar el push', detalle });
  }
};

module.exports.endpointPermitido = endpointPermitido;
