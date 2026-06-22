'use strict';

/**
 * Tray icon de Windows con menú contextual.
 * Usa el paquete `systray` (helper Go embebido). Solo Windows por ahora.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

// Icono base64 PNG (24x24 azul Promerica simple — placeholder, reemplazable)
const ICON_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAA2ZpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDUuMC1jMDYwIDYxLjEzNDc3NywgMjAxMC8wMi8xMi0xNzozMjowMCAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0UmVmPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VSZWYjIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOk9yaWdpbmFsRG9jdW1lbnRJRD0ieG1wLmRpZDo2NzI0QkUxNUVEMjA2ODExODhDNkYyODE1REEzQzU1NSIgeG1wTU06RG9jdW1lbnRJRD0ieG1wLmRpZDpBM0I0RkI2NjNBQTgxMUUyQjJDQTk3QkQzNDQxRUYzMiIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDpBM0I0RkI2NTNBQTgxMUUyQjJDQTk3QkQzNDQxRUYzMiIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ1M1IE1hY2ludG9zaCI+IDx4bXBNTTpEZXJpdmVkRnJvbSBzdFJlZjppbnN0YW5jZUlEPSJ4bXAuaWlkOkU2ODE0QzZBRUUyMDY4MTE4OEM2RjI4MTVEQTNDNTU1IiBzdFJlZjpkb2N1bWVudElEPSJ4bXAuZGlkOjY3MjRCRTE1RUQyMDY4MTE4OEM2RjI4MTVEQTNDNTU1Ii8+IDwvcmRmOkRlc2NyaXB0aW9uPiA8L3JkZjpSREY+IDwveDp4bXBtZXRhPiA8P3hwYWNrZXQgZW5kPSJyIj8+Xe014gAABO5JREFUeNrEV89vVUUYPfPj/up7r6VtCtg0vhaDaYwuBOKGuHDhBjUYE11gjNFo4sq4MzHxb3BnXLFi4UZCjAvjRjQlEUEUpCSkCFgKKRQKbenru+/OnfHMva+lRGNJ7kt4yffunTszd853vvN9M1c45/A4f3qrAeLZN//rsaJ9Rtvrh9CO07741yhr4S5887/vl1tCNAbwLG024EPaiJDykOpvvAshnmf7jaLPdsdwXv9Af3UGxieauHZjvnBT8C/nAtbacTav0Q7LOBZc9Hq+vNIUcQQZaPiwStouzq0MYPdTu5CHEXaP7kCoNf6avzU2c/nqJNL0IF0tvBVJDB2G3wklf4AU044gkzBEo9HYEoDcOgIGpLqwWhIrLvQ1tD5YhN6zkaZkhvdKvkrPj+QmD0Kl8MzoE1D+eWUR8h2GYpqavoind44EnTQbRdqB995TnXcyBEmCiB5nuak34kQ8OTyEqBuKygC6vyg15sCfFy99IK1twuTYEEUQINAB+gmiFoUT9Sg6Gih1mEt/z95W5RDw9zZtSgpxFEodsH7OOrW8KuoiUJIRkNCK3Au8wh6fe7/QPuoFgI9p+3x2gY4jdaV1MWgPgGasRJoJOFu+kt3P0d6rHIKVVN9YWuOrOg71yGFyTFNcDidnsmJ2KFVRl/aMS/RFwK175L0jsNohURBXKgM4tPfvmeCFNTSHFSZ3DqM5XnPHflrFW5/PCdQVGVCUhMT7LyV4bZ/E7YUMc/dSzC44XF905yoD+OTlm+egt9HJQQq/jy73Cak4TcwWnvuwB1pQi3VIHWFksI3tQ23smaD+TGu6MoDU7LgsXJ1FvSEhayxGNaadfaABCjAkC1FcZyNBJkJqxZs2cOG1sHIdCIZmoeIl6IFBoWpkoB9B3FnvpfoVQg+iAOBZCOD4zAlxmyBmq9cBmdyk51eEbgzSmPeD9HZtI398CvoQxDH7FDcfTfFRE6xCl51Qi9UrYTCQQYaX6P2eAoDaRm9Xi1LgM9PnPwsPomSAjTqEZoUswpPPCBfZ6nVAUXgy+oNhgPD3XCSMBiBlOdXX+1IDBKf92ITgIu4d0Pr3sNmkxEwTYRpLcXYJEUREs2HXR6tA1Cb6gp1MFRD/7ZE/0/AAAAAElFTkSuQmCC';

let SysTray;
try { SysTray = require('systray').default; } catch (_) { SysTray = null; }

function urlConfigWeb() {
  return 'https://invefacon.factupos.com/datafono/codigo/_comun/modulo/datafono_config_pruebas.php';
}

function abrirEnNavegador(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function abrirCarpeta(ruta) {
  if (!fs.existsSync(ruta)) return;
  if (process.platform === 'win32') {
    spawn('explorer', [ruta], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [ruta], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [ruta], { detached: true, stdio: 'ignore' }).unref();
  }
}

function pingHTTP(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, body: JSON.parse(data) }); }
        catch (_) { resolve({ ok: res.statusCode < 400, body: data }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

function probarTcp(host, port, ip, posPort) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ ip, port: posPort });
    const req = http.request({
      hostname: host, port, path: '/probar-tcp', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 5000,
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (_) { resolve({ ok: false, error: 'respuesta inválida' }); } });
    });
    req.on('error', e => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(data); req.end();
  });
}

function iniciarTray({ logger, cfgMod, rutaConfigDir, rutaLogs, onSalir, onReiniciar }) {
  if (!SysTray || process.platform !== 'win32') {
    logger.info('Tray no disponible (solo Windows). Continuando en modo consola.');
    return null;
  }

  const cfg = cfgMod.cargar();
  const baseUrl = `http://${cfg.servidor.host}:${cfg.servidor.port}`;

  const ITEMS = {
    ESTADO: 0,
    SEP1: 1,
    PROBAR_PUENTE: 2,
    PROBAR_POS: 3,
    SEP2: 4,
    ABRIR_CONFIG: 5,
    LOG_VIVO: 6,
    ABRIR_LOGS: 7,
    ABRIR_CFG_DIR: 8,
    SEP3: 9,
    REINICIAR: 10,
    SALIR: 11,
  };

  const tray = new SysTray({
    menu: {
      icon: ICON_BASE64,
      title: 'FactuposDatafono',
      tooltip: `Puente datáfono · ${baseUrl}`,
      items: [
        { title: '● Activo', tooltip: 'Estado del puente', checked: false, enabled: false },
        { title: '---',     tooltip: '', checked: false, enabled: false },
        { title: 'Probar puente local',  tooltip: 'Verifica que el puente HTTP responde', checked: false, enabled: true },
        { title: 'Probar conexión POS',  tooltip: 'TCP al datáfono configurado', checked: false, enabled: true },
        { title: '---',     tooltip: '', checked: false, enabled: false },
        { title: 'Abrir configuración…', tooltip: 'Abre DTF-001 en el navegador', checked: false, enabled: true },
        { title: 'Ver log en vivo…',     tooltip: 'Ventana con el log en tiempo real', checked: false, enabled: true },
        { title: 'Abrir carpeta de logs', tooltip: 'Abre la carpeta de logs', checked: false, enabled: true },
        { title: 'Abrir carpeta config', tooltip: 'AppData/FactuposDatafono', checked: false, enabled: true },
        { title: '---',     tooltip: '', checked: false, enabled: false },
        { title: 'Reiniciar puente',     tooltip: 'Reinicia el servidor HTTP local', checked: false, enabled: true },
        { title: 'Salir',                tooltip: 'Detener el puente', checked: false, enabled: true },
      ],
    },
    debug: false,
    copyDir: true,  // pkg: extrae el binario a un dir real antes de spawn
  });

  function actualizarEstado(texto) {
    try {
      tray.sendAction({
        type: 'update-item',
        item: {
          title: texto,
          tooltip: 'Estado del puente',
          checked: false,
          enabled: false,
          seq_id: ITEMS.ESTADO,
        },
        seq_id: ITEMS.ESTADO,
      });
    } catch (e) { logger.warn(`No se pudo actualizar tray: ${e.message}`); }
  }

  tray.onClick(async (action) => {
    const cfgActual = cfgMod.cargar();
    const url = `http://${cfgActual.servidor.host}:${cfgActual.servidor.port}`;

    switch (action.seq_id) {
      case ITEMS.PROBAR_PUENTE: {
        actualizarEstado('● Probando puente…');
        const r = await pingHTTP(`${url}/salud`);
        actualizarEstado(r.ok ? '● Puente OK' : `● Puente FALLA: ${r.error || 'sin respuesta'}`);
        break;
      }
      case ITEMS.PROBAR_POS: {
        actualizarEstado('● Probando POS…');
        const c = cfgMod.cargar();
        const r = await probarTcp(c.servidor.host, c.servidor.port, c.pos.ip, c.pos.port);
        actualizarEstado(r.ok
          ? `● POS OK ${c.pos.ip}:${c.pos.port} (${r.latencyMs}ms)`
          : `● POS FALLA: ${r.error || 'no alcanzable'}`);
        break;
      }
      case ITEMS.ABRIR_CONFIG: {
        abrirEnNavegador(urlConfigWeb());
        break;
      }
      case ITEMS.LOG_VIVO: {
        abrirEnNavegador(`${url}/monitor`);
        break;
      }
      case ITEMS.ABRIR_LOGS: {
        abrirCarpeta(rutaLogs());
        break;
      }
      case ITEMS.ABRIR_CFG_DIR: {
        abrirCarpeta(rutaConfigDir());
        break;
      }
      case ITEMS.REINICIAR: {
        actualizarEstado('● Reiniciando…');
        if (onReiniciar) await onReiniciar();
        actualizarEstado('● Activo');
        break;
      }
      case ITEMS.SALIR: {
        tray.kill(false);
        if (onSalir) onSalir();
        break;
      }
    }
  });

  tray.onExit((code, signal) => {
    logger.info(`Tray cerrado (code=${code} signal=${signal})`);
  });

  logger.info('Tray icon iniciado.');
  return tray;
}

module.exports = { iniciarTray };
