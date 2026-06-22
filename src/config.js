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
    httpUrl: 'http://localhost:0808/baccredomatic',
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
    return fusionar(DEFAULTS, raw);
  } catch (err) {
    throw new Error(`Config inválida en ${ruta}: ${err.message}`);
  }
}

function guardar(parcial) {
  asegurarDir(rutaConfigDir());
  const actual = cargar();
  const nuevo = fusionar(actual, parcial);
  fs.writeFileSync(rutaConfig(), JSON.stringify(nuevo, null, 2), 'utf8');
  return nuevo;
}

module.exports = { cargar, guardar, rutaConfig, rutaConfigDir, rutaLogs, DEFAULTS };
