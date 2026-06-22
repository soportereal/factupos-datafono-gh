'use strict';

/**
 * Cliente WPOSS (Banco Promerica) — protocolo TCP propietario.
 *
 * Reverse-engineered del JAR oficial CajaPOS-1.0.0.jar (2026-04-30):
 *
 * ENVIO (caja → POS):
 *   bytes_a_enviar = sprintf("%04X", length(payload)) + payload
 *   payload        = base64(AES-256-ECB-PKCS5(json, KEY)) + SHA256(b64)[0:8].hex.upper
 *   KEY            = bytes ASCII de "4FBFE4E1B5322C094FBFE4E1B5322C09"  (32 bytes)
 *
 * RECEPCION (POS → caja):
 *   leer 4 bytes ASCII hex → parseInt → N
 *   leer N bytes → string (= base64 + posible hash truncado)
 *   AES decrypt → JSON
 */

const net = require('net');
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 120000;

const AES_KEY = Buffer.from('4FBFE4E1B5322C094FBFE4E1B5322C09', 'utf8');     // 32 bytes ASCII = AES-256
const AES_ALGORITHM = 'aes-256-ecb';

class WpossError extends Error {
  constructor(message, code, raw) {
    super(message);
    this.name = 'WpossError';
    this.code = code;
    this.raw = raw;
  }
}

function encryptAes(plain) {
  const cipher = crypto.createCipheriv(AES_ALGORITHM, AES_KEY, null);
  cipher.setAutoPadding(true); // PKCS5/PKCS7
  const buf = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return buf.toString('base64');
}

function decryptAes(b64) {
  const decipher = crypto.createDecipheriv(AES_ALGORITHM, AES_KEY, null);
  decipher.setAutoPadding(true);
  const buf = Buffer.concat([decipher.update(b64, 'base64'), decipher.final()]);
  return buf.toString('utf8');
}

/**
 * Hash SHA-256 truncado a primeros 8 bytes, hex uppercase (16 chars).
 * Replica exacta de E.E(String) del JAR.
 */
function sha256First8Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest().slice(0, 8).toString('hex').toUpperCase();
}

function armarFrameEnvio(json) {
  const b64 = encryptAes(json);
  const hash16 = sha256First8Hex(b64);
  const payload = b64 + hash16;
  const lenHex = payload.length.toString(16).toUpperCase().padStart(4, '0');
  return Buffer.from(lenHex + payload, 'utf8');
}

function tryParseJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch (_) { return undefined; }
}

/**
 * Lee del buffer la respuesta WPOSS: 4 chars hex (length) + payload.
 * Devuelve el JSON descifrado o undefined si falta data.
 */
function tryParseWpossResponse(buffer, log) {
  if (buffer.length < 4) return undefined;
  const lenHex = buffer.slice(0, 4).toString('utf8');
  const n = parseInt(lenHex, 16);
  if (isNaN(n) || n <= 0) {
    // No parece nuestro framing — ¿texto plano? intento JSON directo
    return tryParseJson(buffer.toString('utf8'));
  }
  if (buffer.length < 4 + n) return undefined;

  let payload = buffer.slice(4, 4 + n).toString('utf8');

  // El payload puede traer hash de 16 chars al final (igual que el envío) — intentar ambas variantes
  const intentos = [];
  if (payload.length > 16) intentos.push(payload.slice(0, payload.length - 16)); // sin hash
  intentos.push(payload); // como está

  for (const intento of intentos) {
    try {
      const sinWs = intento.replace(/\s/g, '');
      const json = decryptAes(sinWs);
      log && log(`[wposs] <- (descifrado) ${json}`);
      return tryParseJson(json) || { rsp_code: '99', rsp_msg: 'Respuesta no JSON', raw: json };
    } catch (_) { /* probar siguiente */ }
  }

  // No descifró — devolver el raw como error
  log && log(`[wposs] <- (no descifrable) ${payload}`);
  throw new WpossError('No se pudo descifrar la respuesta del POS', 'DECRYPT_ERROR', payload);
}

function enviar({ ip, port, timeoutMs = DEFAULT_TIMEOUT_MS, payload, logger }) {
  return new Promise((resolve, reject) => {
    const log = (msg) => { if (logger) logger(msg); };
    const json = JSON.stringify(payload);
    log(`[wposs] -> ${ip}:${port} ${json}`);

    const frame = armarFrameEnvio(json);
    log(`[wposs] frame ${frame.length} bytes (prefix=${frame.slice(0,4).toString('utf8')})`);

    const socket = new net.Socket();
    let buffer = Buffer.alloc(0);
    let resolved = false;

    const finish = (err, data) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch (_) {}
      if (err) reject(err); else resolve(data);
    };

    socket.setTimeout(timeoutMs);

    socket.once('timeout', () => {
      finish(new WpossError(`Timeout esperando respuesta del POS (${timeoutMs}ms)`, 'TIMEOUT'));
    });

    socket.once('error', (err) => {
      finish(new WpossError(`Error de socket: ${err.message}`, 'SOCKET_ERROR'));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const parsed = tryParseWpossResponse(buffer, log);
        if (parsed !== undefined) finish(null, parsed);
      } catch (err) {
        finish(err);
      }
    });

    socket.once('end', () => {
      if (!resolved) {
        try {
          const parsed = tryParseWpossResponse(buffer, log);
          if (parsed !== undefined) finish(null, parsed);
          else finish(new WpossError('Conexión cerrada sin respuesta válida', 'NO_RESPONSE', buffer.toString('utf8')));
        } catch (err) {
          finish(err);
        }
      }
    });

    socket.connect(port, ip, () => {
      log(`[wposs] conectado ${ip}:${port}`);
      socket.write(frame);
    });
  });
}

class WpossClient {
  constructor({ ip, port, merchantId, timeoutMs, logger }) {
    if (!ip) throw new Error('WpossClient: ip requerido');
    if (!port) throw new Error('WpossClient: port requerido');
    if (!merchantId) throw new Error('WpossClient: merchantId requerido');
    this.ip = ip;
    this.port = Number(port);
    this.merchantId = String(merchantId);
    this.timeoutMs = timeoutMs || DEFAULT_TIMEOUT_MS;
    this.logger = logger;
  }

  enviar(payloadExtra) {
    const payload = { merchant_id: this.merchantId, ...payloadExtra };
    return enviar({
      ip: this.ip,
      port: this.port,
      timeoutMs: this.timeoutMs,
      payload,
      logger: this.logger,
    });
  }

  pruebaComunicacion() {
    return this.enviar({ type_transaction: 'PRUEBA COMUNICACION' });
  }

  estadoConexion() {
    return this.enviar({ type_transaction: 'ESTADO DE CONEXION' });
  }

  compraNormal({ baseAmount, currency = '188', tipAmount, taxAmount }) {
    if (baseAmount == null) throw new Error('compraNormal: baseAmount requerido');
    const payload = {
      type_transaction: 'COMPRA NORMAL',
      currency: String(currency),
      base_amount: aMontoEntero(baseAmount),
    };
    if (tipAmount != null) payload.tip_amount = aMontoEntero(tipAmount);
    if (taxAmount != null) payload.tax_amount = aMontoEntero(taxAmount);
    return this.enviar(payload);
  }

  anulacion({ ticketNumber }) {
    if (!ticketNumber) throw new Error('anulacion: ticketNumber requerido');
    return this.enviar({ type_transaction: 'ANULACION', ticket_number: String(ticketNumber) });
  }

  devolucion({ ticketNumber, baseAmount }) {
    if (!ticketNumber) throw new Error('devolucion: ticketNumber requerido');
    const payload = { type_transaction: 'DEVOLUCIONES', ticket_number: String(ticketNumber) };
    if (baseAmount != null) payload.base_amount = aMontoEntero(baseAmount);
    return this.enviar(payload);
  }

  reimpresion({ ticketNumber }) {
    if (!ticketNumber) throw new Error('reimpresion: ticketNumber requerido');
    return this.enviar({ type_transaction: 'REIMPRESION', ticket_number: String(ticketNumber) });
  }

  cierre() {
    return this.enviar({ type_transaction: 'CIERRE' });
  }

  reporteUltimoCierre() {
    return this.enviar({ type_transaction: 'REPORTE ULTIMO CIERRE' });
  }

  reporteCierre() {
    return this.enviar({ type_transaction: 'REPORTE CIERRE' });
  }

  reporteAuditoria() {
    return this.enviar({ type_transaction: 'REPORTE AUDITORIA' });
  }

  ultimaTransaccion() {
    return this.enviar({ type_transaction: 'ULTIMA TRANSACCION' });
  }
}

function aMontoEntero(monto) {
  if (typeof monto === 'string' && /^\d+$/.test(monto)) return monto;
  const num = Number(monto);
  if (!Number.isFinite(num)) throw new Error(`Monto inválido: ${monto}`);
  return String(Math.round(num * 100));
}

module.exports = { WpossClient, WpossError, aMontoEntero };
