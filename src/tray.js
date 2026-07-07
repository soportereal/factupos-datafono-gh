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

// Iconos del tray (activo=verde / inactivo=rojo). Ver src/tray-iconos.js — .ico BMP,
// que es lo único que el systray de Windows pinta bien en tamaños chicos.
const { ICON_ACTIVO, ICON_INACTIVO } = require('./tray-iconos');

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
    DIAGNOSTICAR: 2,
    REINICIAR: 3,
    SEP2: 4,
    ABRIR_CONFIG: 5,
    LOG_VIVO: 6,
    ABRIR_LOGS: 7,
    ABRIR_CFG_DIR: 8,
    SEP3: 9,
    CERRAR: 10,
  };

  // Estado del servicio: null = desconocido, true = corriendo, false = detenido.
  let servicioActivo = null;
  let textoEstado = '● Iniciando…';

  const itemEstado = (texto) => ({ title: texto, tooltip: 'Estado del servicio', checked: false, enabled: false, seq_id: ITEMS.ESTADO });

  function construirMenu(iconB64, texto) {
    return {
      icon: iconB64,
      title: 'FactuposDatafono',
      tooltip: `Puente datáfono · ${baseUrl} · ${texto.replace(/^●\s*/, '')}`,
      items: [
        itemEstado(texto),
        { title: '---', tooltip: '', checked: false, enabled: false },
        { title: 'Diagnosticar',        tooltip: 'Prueba puente + datáfono y abre el log', checked: false, enabled: true },
        { title: 'Reiniciar servicio',  tooltip: 'Reinicia el servidor HTTP local', checked: false, enabled: true },
        { title: '---', tooltip: '', checked: false, enabled: false },
        { title: 'Abrir configuración…', tooltip: 'Abre DTF-001 en el navegador', checked: false, enabled: true },
        { title: 'Ver log en vivo…',     tooltip: 'Ventana con el log en tiempo real', checked: false, enabled: true },
        { title: 'Abrir carpeta de logs', tooltip: 'Abre la carpeta de logs', checked: false, enabled: true },
        { title: 'Abrir carpeta config', tooltip: 'AppData/FactuposDatafono', checked: false, enabled: true },
        { title: '---', tooltip: '', checked: false, enabled: false },
        { title: 'Cerrar',              tooltip: 'Detener el puente y salir', checked: false, enabled: true },
      ],
    };
  }

  const tray = new SysTray({
    menu: construirMenu(ICON_INACTIVO, textoEstado),
    debug: false,
    copyDir: true,  // pkg: extrae el binario a un dir real antes de spawn
  });

  // Cambia solo la etiqueta de estado (sin tocar el icono).
  function actualizarEtiqueta(texto) {
    textoEstado = texto;
    try {
      tray.sendAction({ type: 'update-item', item: itemEstado(texto), seq_id: ITEMS.ESTADO });
    } catch (e) { logger.warn(`No se pudo actualizar tray: ${e.message}`); }
  }

  // Aplica el estado corriendo/detenido: cambia el ICONO (verde/rojo) solo cuando
  // el estado cambia, y siempre refresca la etiqueta.
  function aplicarEstado(ok, detalle) {
    const texto = ok ? '● Servicio corriendo' : `● Servicio detenido${detalle ? ': ' + detalle : ''}`;
    if (ok !== servicioActivo) {
      servicioActivo = ok;
      textoEstado = texto;
      try {
        tray.sendAction({
          type: 'update-menu-and-item',
          menu: construirMenu(ok ? ICON_ACTIVO : ICON_INACTIVO, texto),
          item: itemEstado(texto),
          seq_id: ITEMS.ESTADO,
        });
      } catch (e) { logger.warn(`No se pudo cambiar icono tray: ${e.message}`); }
      logger.info(`Estado del servicio: ${ok ? 'CORRIENDO' : 'DETENIDO'}${detalle ? ' (' + detalle + ')' : ''}`);
    } else {
      actualizarEtiqueta(texto);
    }
  }

  // Sondeo periódico de /salud para reflejar en el icono si el servicio responde.
  async function sondear() {
    const c = cfgMod.cargar();
    const r = await pingHTTP(`http://${c.servidor.host}:${c.servidor.port}/salud`);
    aplicarEstado(r.ok, r.ok ? '' : (r.error || 'sin respuesta'));
  }
  const timerSondeo = setInterval(() => { sondear(); }, 5000);
  if (timerSondeo.unref) timerSondeo.unref();
  sondear();  // primer chequeo inmediato

  async function diagnosticar(url) {
    actualizarEtiqueta('● Diagnosticando…');
    const c = cfgMod.cargar();
    const puente = await pingHTTP(`${url}/salud`);
    let resumen;
    if (!puente.ok) {
      resumen = `● Puente NO responde: ${puente.error || 'sin respuesta'}`;
    } else if (!c.pos.ip) {
      // BAC / pinpad USB: no hay IP que probar por TCP.
      resumen = '● Puente OK · datáfono por SDK/USB (ver log)';
    } else {
      const pos = await probarTcp(c.servidor.host, c.servidor.port, c.pos.ip, c.pos.port);
      resumen = pos.ok
        ? `● Puente OK · POS OK ${c.pos.ip}:${c.pos.port} (${pos.latencyMs}ms)`
        : `● Puente OK · POS FALLA: ${pos.error || 'no alcanzable'}`;
    }
    actualizarEtiqueta(resumen);
    abrirEnNavegador(`${url}/monitor`);   // ventana de log en vivo con el detalle
  }

  tray.onClick(async (action) => {
    const cfgActual = cfgMod.cargar();
    const url = `http://${cfgActual.servidor.host}:${cfgActual.servidor.port}`;

    switch (action.seq_id) {
      case ITEMS.DIAGNOSTICAR: {
        await diagnosticar(url);
        break;
      }
      case ITEMS.REINICIAR: {
        actualizarEtiqueta('● Reiniciando servicio…');
        try {
          if (onReiniciar) await onReiniciar();
        } catch (e) { logger.error(`Error al reiniciar: ${e.message}`); }
        await sondear();   // refleja el nuevo estado en el icono
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
      case ITEMS.CERRAR: {
        clearInterval(timerSondeo);
        tray.kill(false);
        if (onSalir) onSalir();
        break;
      }
    }
  });

  tray.onExit((code, signal) => {
    clearInterval(timerSondeo);
    logger.info(`Tray cerrado (code=${code} signal=${signal})`);
  });

  logger.info('Tray icon iniciado.');
  return tray;
}

module.exports = { iniciarTray };
