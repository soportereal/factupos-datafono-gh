# FactuposDatafono

Puente local entre FactuPOS web y datáfonos bancarios. Se instala en cada PC de caja y traduce HTTP↔TCP/JSON al datáfono de la LAN.

## Arquitectura

```
FactuPOS web (browser)  --HTTP-->  FactuposDatafono (localhost:8765)  --TCP/JSON-->  Datáfono LAN
```

## Bancos soportados

- ✅ **Banco Promerica** — protocolo WPOSS (NEW9220, NEW9310)
- ⏳ BAC Credomatic
- ⏳ Banco Nacional (BNCR)

Plugins en `src/bancos/<banco>.js`. El web manda `banco: "<id>"` en cada request.

## Build & Release (GitHub Actions)

Se compila en la nube (runner `windows-latest`), igual que FactuPOS Print — **no requiere Windows local**.

- **Workflow:** `.github/workflows/build.yml`. Corre en cada `push` a `main`, en tags `v*` y a mano (`workflow_dispatch`).
- **Pasos:** `npm ci` → `npm run build:win` (pkg → `dist/FactuposDatafono.exe`) → `choco install innosetup` → `ISCC installer/FactuposDatafono.iss` (→ `installer/Output/FactuposDatafono-Setup-X.Y.Z.exe`).
- **Artefactos del run:** `FactuposDatafono-Setup` (instalador) y `FactuposDatafono-exe` (.exe crudo).
- **Release:** si el push es un **tag `vX.Y.Z`**, publica un Release con el instalador adjunto.

### Publicar una versión
```bash
git tag v0.2.0 && git push origin main --tags
# → el Action genera FactuposDatafono-Setup-0.2.0.exe en el Release
```
Luego subir ese `Setup.exe` a `soportereal.com/software/factupos-app/windows/` (descargas centralizadas).
Acordate de igualar `MyAppVersion` en `installer/FactuposDatafono.iss` al número del tag.

## Instalador (qué hace el Setup.exe)

El **`FactuposDatafono-Setup-X.Y.Z.exe`** (Inno Setup):
1. Instala `FactuposDatafono.exe` en `Archivos de programa\FactuposDatafono`.
2. **Lo pone a arrancar automáticamente con Windows** (oculto, con ícono en la bandeja) — clave `Run` de HKLM + launcher `.vbs` silencioso.
3. Crea accesos directos (opcional) + **desinstalador**.

> No se instala como *servicio de Windows* puro: el bridge muestra tray y un servicio corre en sesión 0 sin UI. El autostart al iniciar Windows cumple lo mismo y conserva el tray.

## Instalación manual (alternativa sin instalador)

1. Copiar `dist/FactuposDatafono.exe` a la PC de caja (ej: `C:\FactuposDatafono\`)
2. Doble clic — al primer arranque crea la config en `%APPDATA%\FactuposDatafono\config.json`
3. Editar config con los datos del datáfono (banco, IP, puerto, merchant_id)
4. Permitir el puerto 8765 en firewall si es necesario
5. (Opcional) Autostart con `dist/FactuposDatafono-instalar-autostart.bat`

### config.json (ejemplo)

```json
{
  "banco": "banco-promerica",
  "pos": {
    "ip": "192.168.1.50",
    "port": 8080,
    "merchantId": "1066864914",
    "timeoutMs": 120000
  },
  "servidor": {
    "host": "127.0.0.1",
    "port": 8765,
    "corsOrigins": ["*"],
    "apiKey": ""
  },
  "logs": { "nivel": "info" }
}
```

## Desarrollo

```bash
npm install
npm run test:echo            # Levanta POS simulado en :8080
npm run test:cliente         # Corre tests contra el simulado
npm start                    # Arranca el puente HTTP
npm run build:win            # Genera dist/FactuposDatafono.exe
```

## Endpoints HTTP

| Método | Ruta | Descripción |
|---|---|---|
| GET  | `/salud` | Estado del puente, versión, bancos disponibles |
| GET  | `/config` | Config actual (apiKey enmascarada) |
| PUT  | `/config` | Actualizar config |
| POST | `/transaccion/prueba` | PRUEBA COMUNICACION (heartbeat) |
| POST | `/transaccion/estado-conexion` | ESTADO DE CONEXION |
| POST | `/transaccion/compra-normal` | Cobro tarjeta |
| POST | `/transaccion/anulacion` | Anular venta del día |
| POST | `/transaccion/devolucion` | Reembolso |
| POST | `/transaccion/reimpresion` | Reimprimir voucher |
| POST | `/transaccion/cierre` | Cierre de lote |
| POST | `/transaccion/reporte-cierre` | Resumen actual |
| POST | `/transaccion/reporte-ultimo` | Último cierre |
| POST | `/transaccion/reporte-auditoria` | Auditoría del día |
| POST | `/transaccion/ultima` | Recovery por timeout |

Body típico:
```json
{ "banco": "banco-promerica", "baseAmount": 1500.50 }
```

Respuesta:
```json
{ "ok": true, "data": { "rsp_code": "00", "rsp_msg": "*** APROBADO ***", "ticket_number": "000024", "auth_code": "058481", ... } }
```

## Estructura

```
src/
  bancos/
    banco-promerica.js      # Cliente WPOSS
  server.js                 # Express + dispatch por banco
  config.js                 # Config en %APPDATA%
  logger.js
  index.js
tests/
  echoServer.js             # POS simulado
  test-wpossClient.js
package.json
```

## Logs

Por día en `%APPDATA%\FactuposDatafono\logs\YYYY-MM-DD.log`.
