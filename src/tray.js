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

// Icono base64 ICO (tarjeta de pago, multi-tamaño 16-256). Windows systray requiere .ico.
const ICON_BASE64 = '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';

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
