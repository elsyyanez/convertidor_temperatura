# Convertidor de temperatura

PWA para convertir entre Celsius, Fahrenheit y Kelvin. Incluye un widget para el panel de widgets de Windows 11 (Win+W) que muestra la última conversión, con botones "Abrir Convertidor" y "Nuevo" (`?nuevo=1`).

## Widget de Windows 11

Comandos (PowerShell, en este orden):

```powershell
winget install Microsoft.WindowsAppRuntime.1.2
winget install Microsoft.WindowsAppRuntime.1.8   # solo si hace falta una versión más nueva
Get-AppxPackage MicrosoftWindows.Client.WebExperience | Select Name, Version
winget upgrade --id 9MSSGKG348SP --source msstore
(Get-Item "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe").VersionInfo.ProductVersion
Get-Process Widgets* -ErrorAction SilentlyContinue | Stop-Process -Force   # reinicia el panel
```

Pasos manuales:

1. Configuración → "developer" → activar "Usar funciones para desarrolladores".
2. Abrir la URL https desplegada en **Microsoft Edge** (no Chrome) e instalar la app.
3. Win+W → Agregar widgets → "Última conversión". Abre la app y haz una conversión para que el widget muestre datos.
4. Tras cada cambio a `manifest.json` o `sw.js`: desinstalar en `edge://apps`, abrir la URL, Ctrl+Shift+R e instalar de nuevo.

Requiere URL https pública (ni `localhost` sirve para instalar el widget).

## Sincronización, distintivo y notificaciones

La app funciona sin conexión (service worker) y añade:

- **Indicador de conexión** (verde "En línea" / rojo "Sin conexión · puedes seguir calculando") y estado de la sincronización periódica.
- **Cola de cambios pendientes** (`pendientes.js`, IndexedDB): las conversiones hechas sin conexión se guardan y se envían con **Background Sync** (`sincronizar-pendientes`) al volver la red.
- **Sincronización periódica** (`actualizar-app`, cada hora como mínimo) que refresca los archivos de la app. Solo en Edge/Chromium con la app instalada.
- **Distintivo** en el icono con el número de pendientes (App Badging API).
- **Notificaciones locales** al terminar una sincronización con pendientes y **notificaciones push** reales desde funciones de Vercel (`api/clave.js` y `api/enviar.js`, con `web-push` 3.6.7 fijado: la versión 4 es solo ESM y falla con `ERR_REQUIRE_ESM`).

Las notificaciones y el distintivo solo funcionan con la app instalada desde Edge/Chromium y servida por HTTPS.

### Configurar el push en Vercel

No subas nunca la clave privada al repositorio ni la pegues en un chat.

1. En PowerShell (necesita Node.js): `npx web-push generate-vapid-keys`
2. En Vercel → Settings → Environment Variables, en **Production**:
   - `VAPID_PUBLIC_KEY`: la clave pública generada.
   - `VAPID_PRIVATE_KEY`: la clave privada generada (tipo Secret).
   - `VAPID_SUBJECT`: `mailto:tu-correo@ejemplo.com` (con `mailto:` delante, sin comillas ni espacios; si no, falla con "Vapid subject is not a valid URL").
3. Guarda y haz **Redeploy**: las funciones solo leen las variables nuevas en un despliegue nuevo.

Si cambias las claves, las suscripciones antiguas dejan de servir: cancela el permiso de notificaciones de la app o reinstálala.

### Probarlo (Edge, app instalada)

1. Abre `https://TU-DOMINIO.vercel.app/api/clave`: debe devolver `{"clave":"B..."}`.
2. Pulsa "Activar notificaciones" y acepta.
3. DevTools → Network → Offline. Haz 2 cálculos: debe decir "2 cambios pendientes" y el icono de la barra de tareas mostrar el 2.
4. Vuelve a "No throttling" **antes** de forzar la sincronización. Minimiza solo la ventana de la app.
5. DevTools → Application → Service workers → campo Sync → `sincronizar-pendientes` → botón. Debe salir la notificación y borrarse el número.
6. Pulsa "Enviar push de prueba": con la app a la vista y con el foco, el aviso baja desde arriba dentro de la app; con la ventana minimizada o sin foco, llega como notificación de Windows.

### Dónde se guardan los pendientes

Las conversiones hechas sin conexión se guardan en **IndexedDB** del navegador: base `convertidor-pendientes`, almacén `pendientes` (cada registro tiene `entrada`, `resultado` y `fecha`). Se pueden ver en DevTools → Application → IndexedDB. Se borran solo cuando la sincronización termina bien. El estado de la última sincronización y el diagnóstico de notificaciones están en la Cache API (`convertidor-estado`).

### Problemas conocidos

- El modo Offline de DevTools afecta a la página pero puede no afectar a las peticiones del service worker. Para forzar un fallo real, desconecta la red del equipo.
- Si el diagnóstico (Cache API `convertidor-estado`, `estado/diagnostico.json`, y la consola del service worker) dice "enviada" y no aparece nada, el problema está en Windows: "No molestar", ajustes de notificaciones de Edge o el centro de notificaciones (Win+N).
- Un 502 en `/api/enviar`: mira el detalle que muestra la página y los Runtime Logs de Vercel. `Vapid subject is not a valid URL` = falta `mailto:`; `Vapid private key must be a URL safe Base 64` = el valor no es la clave; un 401/403 del servicio de push = las claves pública y privada son de pares distintos.
- `ERR_REQUIRE_ESM` en los registros: `web-push` está en la versión 4; fíjalo en 3.6.7.
- Tras cualquier cambio en `sw.js` o el manifiesto, reinstala la app en Edge.
