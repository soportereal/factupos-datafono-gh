'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { rutaLogs } = require('./config');

const NIVELES = { error: 0, warn: 1, info: 2, debug: 3 };

// Buffer en memoria de las últimas líneas + emisor para el monitor en vivo (SSE).
const MAX_BUFFER = 500;
const buffer = [];
const emisor = new EventEmitter();
emisor.setMaxListeners(50); // varias pestañas del monitor abiertas a la vez

function archivoHoy() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(rutaLogs(), `${yyyy}-${mm}-${dd}.log`);
}

function escribir(nivel, mensaje) {
  const ts = new Date().toISOString();
  const linea = `[${ts}] [${nivel.toUpperCase()}] ${mensaje}`;
  try {
    fs.appendFileSync(archivoHoy(), linea + '\n', 'utf8');
  } catch (_) { /* no-op */ }
  if (nivel === 'error') process.stderr.write(linea + '\n');
  else process.stdout.write(linea + '\n');

  // Alimentar el buffer y notificar a los suscriptores del monitor en vivo.
  const evento = { ts, nivel, mensaje, linea };
  buffer.push(evento);
  if (buffer.length > MAX_BUFFER) buffer.shift();
  emisor.emit('linea', evento);
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
    // Para el monitor en vivo (server.js → /monitor, /logs/stream):
    historial: () => buffer.slice(),
    onLinea: (cb) => { emisor.on('linea', cb); return () => emisor.off('linea', cb); },
  };
}

module.exports = { crear };
