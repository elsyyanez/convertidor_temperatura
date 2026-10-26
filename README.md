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
