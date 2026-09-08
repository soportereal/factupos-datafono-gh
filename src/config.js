'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_NAME = 'FactuposDatafono';

const DEFAULTS = {
  banco: 'PROMERICA',
  pos: {
    ip: '192.168.1.50',
    port: 8080,
    merchantId: '',
    timeoutMs: 120000,
  },
  bac: {
    // Transporte hacia el SDK BAC en esta caja Windows:
    //   'http'  (default) → POST a BacCredomatic.httpRunSDK.exe (puente oficial, localhost:0808).
    //   'spawn'           → lanza CSP.EMV.InteropEXE.exe como subproceso.
    transport: 'http',
    // Transporte 'http': base del puente httpRunSDK (SIN /SdkInvoke). El pinpad es USB,
    // así que NO se usa ip/port del datáfono; solo este puerto local.
    // ⚠️ 127.0.0.1, NO 'localhost' (Node lo resuelve a ::1 y el SDK es IPv4).
    httpUrl: 'http://127.0.0.1:0808/baccredomatic',
    // Transporte 'spawn': ruta del CSP.EMV.InteropEXE.exe. Vacío = el plugin usa
    // BAC_INTEROP_EXE o su default. Override por transacción vía req.body.exePath.
    exePath: '',
  },
  servidor: {
    host: '127.0.0.1',
    port: 8765,
    corsOrigins: ['*'],
    apiKey: '',
  },
  logs: {
    nivel: 'info',
  },
};

function rutaConfigDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), APP_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_NAME);
}

function rutaConfig() {
  return path.join(rutaConfigDir(), 'config.json');
}

function rutaLogs() {
  return path.join(rutaConfigDir(), 'logs');
}

function asegurarDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function fusionar(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(extra || {})) {
    const v = extra[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = fusionar(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function cargar() {
  asegurarDir(rutaConfigDir());
  asegurarDir(rutaLogs());
  const ruta = rutaConfig();
  if (!fs.existsSync(ruta)) {
    fs.writeFileSync(ruta, JSON.stringify(DEFAULTS, null, 2), 'utf8');
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  try {
    const raw = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    const cfg = fusionar(DEFAULTS, raw);
    if (migrarHttpUrlLocalhost(cfg)) {
      // El archivo del usuario GANA sobre los DEFAULTS, así que cambiar el default
      // no curaba a las cajas ya instaladas: las que nacieron con <= 0.4.3 tienen
      // "httpUrl": "http://localhost:0808/..." escrito acá y seguían dando
      // 'ECONNREFUSED ::1:808' después de actualizar (reporte #1229). Se corrige
      // el archivo una sola vez, para que lo guardado deje de ser una trampa.
      try { fs.writeFileSync(ruta, JSON.stringify(cfg, null, 2), 'utf8'); } catch (_) { /* solo lectura: igual sirve en memoria */ }
    }
    return cfg;
  } catch (err) {
    throw new Error(`Config inválida en ${ruta}: ${err.message}`);
  }
}

/**
 * Reescribe bac.httpUrl de 'localhost'/'::1' a 127.0.0.1. Devuelve true si tocó algo.
 * El SDK de BAC escucha solo en IPv4; Node resuelve localhost a ::1 primero.
 */
function migrarHttpUrlLocalhost(cfg) {
  const actual = cfg && cfg.bac && cfg.bac.httpUrl;
  if (!actual) return false;
  try {
    const u = new URL(String(actual));
    if (u.hostname !== 'localhost' && u.hostname !== '::1' && u.hostname !== '[::1]') return false;
    u.hostname = '127.0.0.1';
    cfg.bac.httpUrl = u.toString().replace(/\/+$/, '');
    return true;
  } catch (_) {
    return false;
  }
}

function guardar(parcial) {
  asegurarDir(rutaConfigDir());
  const actual = cargar();
  const nuevo = fusionar(actual, parcial);
  fs.writeFileSync(rutaConfig(), JSON.stringify(nuevo, null, 2), 'utf8');
  return nuevo;
}

module.exports = { cargar, guardar, rutaConfig, rutaConfigDir, rutaLogs, DEFAULTS, migrarHttpUrlLocalhost };
