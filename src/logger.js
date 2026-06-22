'use strict';

const fs = require('fs');
const path = require('path');
const { rutaLogs } = require('./config');

const NIVELES = { error: 0, warn: 1, info: 2, debug: 3 };

function archivoHoy() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(rutaLogs(), `${yyyy}-${mm}-${dd}.log`);
}

function escribir(nivel, mensaje) {
  const ts = new Date().toISOString();
  const linea = `[${ts}] [${nivel.toUpperCase()}] ${mensaje}\n`;
  try {
    fs.appendFileSync(archivoHoy(), linea, 'utf8');
  } catch (_) { /* no-op */ }
  if (nivel === 'error') process.stderr.write(linea);
  else process.stdout.write(linea);
}

function crear({ nivel = 'info' } = {}) {
  const limite = NIVELES[nivel] ?? NIVELES.info;
  const log = (n, msg) => {
    if (NIVELES[n] <= limite) escribir(n, typeof msg === 'string' ? msg : JSON.stringify(msg));
  };
  return {
    error: (m) => log('error', m),
    warn:  (m) => log('warn', m),
    info:  (m) => log('info', m),
    debug: (m) => log('debug', m),
  };
}

module.exports = { crear };
