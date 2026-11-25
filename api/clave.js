// Devuelve la clave pública VAPID para que la página se suscriba a las notificaciones push.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const clave = process.env.VAPID_PUBLIC_KEY;
  if (!clave) {
    res.status(503).json({ error: 'Push no configurado en el servidor' });
    return;
  }
  res.status(200).json({ clave });
};
