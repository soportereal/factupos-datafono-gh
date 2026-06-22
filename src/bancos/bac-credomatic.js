'use strict';

/**
 * Cliente BAC Credomatic — SDK CSP Authorizer (EMV 3.12.3) vía subprocess.
 *
 * RUTA B (decidida 2026-06-08): el puente Node habla con el SDK .NET de BAC en
 * la misma caja Windows. Soporta DOS transportes (config `bac.transport`):
 *
 *   'http' (DEFAULT) → POST al puente oficial `BacCredomatic.httpRunSDK.exe`
 *                      en `http://localhost:0808/baccredomatic/SdkInvoke`,
 *                      igual que el `serviceproxy.js` que entrega BAC. Devuelve JSON.
 *   'spawn'          → lanza `CSP.EMV.InteropEXE.exe` como subproceso y lee JSON
 *                      de stdout (reverse-engineering de POSVirtual 3.9.0).
 *
 * ENVIO (caja → SDK) — igual en ambos transportes:
 *   args  = "clave:valor;clave:valor;..."  (SIN espacios, separador ';')
 *   ej.   = "transactionType:SALE;terminalId:EMVFAC01;invoice:FA002;totalAmount:200.00;taxAmount:7.00;tipAmount:6.00"
 *   En 'http' el body es JSON.stringify(args); en 'spawn' va como un único arg CLI.
 *   El SDK orquesta el pinpad Ingenico Lane/3600 (USB) + autorización contra CSP BAC.
 *
 * RECEPCION (SDK → caja):
 *   JSON (stdout en 'spawn'; cuerpo HTTP en 'http') con campos del EMVStreamResponse
 *   (responseCode, ...). Solo responseCode === '00' = APROBADA.
 *
 * Esta clase NORMALIZA la respuesta BAC al formato común del puente
 * (rsp_code/rsp_msg/...) que esperan server.js, el cliente JS y DTF-002.
 *
 * ⚠️ PENDIENTE DE VERIFICAR CON EL KIT FÍSICO (Lane3600 + tarjeta de pruebas):
 *   - Mecanismo exacto de invocación: ¿el string va como UN solo arg CLI,
 *     como varios args, o por stdin? Aquí se pasa como un único argumento.
 *     (memoria harness/datafonos.md línea ~330: forma exacta aún por confirmar)
 *   - Ruta del exe (BAC_INTEROP_EXE / opts.exePath / default Windows).
 *   - terminalId definitivo de Genesis (llega en Precertificación).
 *
 * Referencias:
 *   - Documentación/Datafono/bac-credomatic/{protocolo,arquitectura}.md
 *   - Molde: ./banco-promerica.js
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 120000;

// --- Transporte (seleccionable por config `bac.transport`) ---
//  'http'  (default) → POST a BacCredomatic.httpRunSDK.exe en localhost:0808,
//                      tal como el serviceproxy.js oficial de BAC (devuelve JSON).
//  'spawn'           → lanza CSP.EMV.InteropEXE.exe como subproceso y lee JSON
//                      de stdout (reverse-engineering de POSVirtual 3.9.0).
// Ambos parsean la MISMA respuesta JSON → normalizarRespuesta() es común.
const DEFAULT_TRANSPORT = 'http';

// Puente HTTP oficial del SDK (BacCredomatic.httpRunSDK.exe). Base SIN /SdkInvoke.
// Confirmado en librerias-proveedor/web-integracion/serviceprovider.js.
const DEFAULT_HTTP_URL = process.env.BAC_HTTP_URL || 'http://localhost:0808/baccredomatic';

// Ruta del ejecutable del SDK BAC (Windows, solo transporte 'spawn'). Override por env o constructor.
const DEFAULT_EXE_PATH = process.env.BAC_INTEROP_EXE
  || 'C:\\CSP\\CSP SDK Integracion EMV 3.12.3 v1\\CSP.EMV.InteropEXE.exe';

// Tipos de transacción del SDK CSP (MAYÚSCULAS — confirmado manual DUAL 2026-06-09).
const TX = {
  SALE: 'SALE',
  VOID: 'VOID',
  REVERSE: 'REVERSE',
  BATCH_INQUIRY: 'BATCH_INQUIRY',
  BATCH_SETTLEMENT: 'BATCH_SETTLEMENT',
  REPRINT: 'REPRINT',
  VERIFY_CARD: 'VERIFY_CARD',
};

class BacError extends Error {
  constructor(message, code, raw) {
    super(message);
    this.name = 'BacError';
    this.code = code;
    this.raw = raw;
  }
}

/**
 * Formatea un monto a decimal con 2 decimales y separador punto ("200.00"),
 * como exige el SDK BAC (NO céntimos enteros como Promerica).
 */
function aMontoDecimal(monto) {
  if (monto == null) return undefined;
  const num = Number(monto);
  if (!Number.isFinite(num)) throw new Error(`Monto inválido: ${monto}`);
  return num.toFixed(2);
}

/**
 * Arma el string de parámetros "clave:valor;clave:valor;".
 * Omite claves con valor null/undefined/''. SIN espacios.
 */
function armarArgs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

function tryParseJson(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return undefined;
  try { return JSON.parse(trimmed); } catch (_) { return undefined; }
}

/**
 * Extrae tags EMV del array `printTags` del SDK BAC.
 * El 1er elemento sin ':' es la aplicación del chip (app_label); el resto son
 * pares "TAG:DATO" (ej. "ARQC:123", "TVR:0880008000"). Devuelve los que persiste
 * BancoMovimientos: app_label, aid, arqc, tvr, tsi.
 */
function parsearPrintTags(printTags) {
  const out = { app_label: '', aid: '', arqc: '', tvr: '', tsi: '' };
  if (!Array.isArray(printTags)) return out;
  for (const item of printTags) {
    const s = String(item || '');
    const i = s.indexOf(':');
    if (i < 0) { if (!out.app_label) out.app_label = s.trim(); continue; }
    const tag = s.slice(0, i).trim().toUpperCase();
    const val = s.slice(i + 1).trim();
    if (tag === 'AID') out.aid = val;
    else if (tag === 'ARQC') out.arqc = val;
    else if (tag === 'TVR') out.tvr = val;
    else if (tag === 'TSI') out.tsi = val;
  }
  return out;
}

/**
 * Normaliza la respuesta JSON del SDK BAC al formato común del puente.
 * - server.js decide el éxito con `data.rsp_code === '00'`.
 * - movimiento_registrar.php (DTF-002) persiste leyendo claves snake_case
 *   (rsp_code, ticket_number, auth_code, stan, holder_name, pos_entry_mode,
 *    aid/arqc/tvr/tsi, app_label, date, time, ...) → se emiten todas aquí.
 */
function normalizarRespuesta(bac) {
  if (!bac || typeof bac !== 'object') {
    return { rsp_code: '99', rsp_msg: 'Respuesta BAC no interpretable', raw: bac };
  }
  const tags = parsearPrintTags(bac.printTags);
  return {
    // --- formato común que persiste BancoMovimientos / lee el cliente JS ---
    rsp_code: bac.responseCode != null ? String(bac.responseCode) : '99',
    rsp_msg: bac.responseCodeDescription || '',
    ticket_number: bac.systemTraceNumber || bac.invoice || '',
    auth_code: bac.authorizationNumber || '',
    reference_number: bac.referenceNumber || '',
    stan: bac.systemTraceNumber || '',
    batch_number: bac.batchNumber || bac.nitSelected || '',
    card: bac.maskedCardNumber || '',
    holder_name: bac.cardHolderName || '',
    pos_entry_mode: bac.entryMode || '',
    app_label: tags.app_label,
    aid: tags.aid,
    arqc: tags.arqc,
    tvr: tags.tvr,
    tsi: tags.tsi,
    amount: bac.salesAmount || '',
    date: bac.hostDate || '',
    time: bac.hostTime || '',
    // --- campos BAC propios que se conservan (impresión / recovery) ---
    transactionId: bac.transactionId || '',
    invoice: bac.invoice || '',
    printVoucher: bac.printVoucher,
    voucher: bac.voucher,
    printTags: bac.printTags,
    signature: bac.signature,
    signatureImage: bac.signatureImage,
    // --- respuesta cruda completa para depuración / persistencia ---
    raw: bac,
  };
}

/**
 * TRANSPORTE HTTP (default) — POST al puente BacCredomatic.httpRunSDK.exe.
 * Calca el serviceproxy.js oficial de BAC: POST application/json a
 * `<httpUrl>/SdkInvoke` con body = JSON.stringify(argsString) y respuesta texto
 * (vacía = operación void exitosa; si no, JSON del EMVStreamResponse).
 */
function ejecutarHttp({ httpUrl, argsString, timeoutMs = DEFAULT_TIMEOUT_MS, logger }) {
  return new Promise((resolve, reject) => {
    const log = (msg) => { if (logger) logger(msg); };
    let url;
    try {
      url = new URL(`${String(httpUrl).replace(/\/+$/, '')}/SdkInvoke`);
    } catch (err) {
      return reject(new BacError(`URL del puente BAC inválida: ${httpUrl}`, 'BAD_URL'));
    }
    // El proxy oficial envía JSON.stringify(text) → el string entre comillas.
    const body = JSON.stringify(argsString);
    log(`[bac] HTTP POST ${url.href} body=${body}`);

    let settled = false;
    const fail = (err) => { if (!settled) { settled = true; reject(err); } };

    const req = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        log(`[bac] HTTP <- ${res.statusCode} ${data.trim()}`);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new BacError(`Puente BAC respondió HTTP ${res.statusCode}`, 'HTTP_ERROR', data || `HTTP ${res.statusCode}`));
        }
        const texto = (data || '').trim();
        // serviceproxy.js: respuesta vacía = operación void exitosa (ej. EJECT_CARD).
        if (texto === '') {
          return resolve(normalizarRespuesta({ responseCode: '00', responseCodeDescription: 'OK', _void: true }));
        }
        const json = tryParseJson(texto);
        if (json === undefined) {
          return reject(new BacError('El puente BAC no devolvió JSON válido', 'NO_JSON', texto));
        }
        resolve(normalizarRespuesta(json));
      });
    });

    req.on('timeout', () => {
      // El SDK genera reversa automática ante timeout (ver protocolo.md).
      req.destroy(new BacError(`Timeout esperando al puente BAC (${timeoutMs}ms)`, 'TIMEOUT'));
    });
    req.on('error', (err) => {
      if (err instanceof BacError) return fail(err);
      fail(new BacError(
        `No se pudo contactar el puente BAC (¿BacCredomatic.httpRunSDK.exe corriendo en ${url.host}?): ${err.message}`,
        'HTTP_CONN_ERROR',
      ));
    });
    req.write(body);
    req.end();
  });
}

/**
 * TRANSPORTE SPAWN — lanza CSP.EMV.InteropEXE.exe con el string de parámetros y
 * devuelve el JSON de stdout, normalizado al formato común.
 */
function ejecutarSpawn({ exePath, argsString, timeoutMs = DEFAULT_TIMEOUT_MS, logger }) {
  return new Promise((resolve, reject) => {
    const log = (msg) => { if (logger) logger(msg); };
    log(`[bac] -> ${path.basename(exePath)} "${argsString}"`);

    // ⚠️ El string va como UN solo argumento. Confirmar con el kit si el exe
    //    espera varios args o stdin (ver nota de cabecera).
    let proc;
    try {
      proc = spawn(exePath, [argsString], { windowsHide: true });
    } catch (err) {
      return reject(new BacError(`No se pudo lanzar el SDK BAC: ${err.message}`, 'SPAWN_ERROR'));
    }

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill(); } catch (_) {}
      // El SDK genera reversa automática ante timeout (ver protocolo.md).
      reject(new BacError(`Timeout esperando respuesta del SDK BAC (${timeoutMs}ms)`, 'TIMEOUT'));
    }, timeoutMs);

    proc.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    proc.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new BacError(`Error ejecutando el SDK BAC: ${err.message}`, 'EXEC_ERROR'));
    });

    proc.once('close', (codeExit) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log(`[bac] <- exit=${codeExit} stdout=${stdout.trim()} ${stderr ? `stderr=${stderr.trim()}` : ''}`);
      const json = tryParseJson(stdout);
      if (json === undefined) {
        return reject(new BacError(
          'El SDK BAC no devolvió JSON válido',
          'NO_JSON',
          stdout || stderr || `exit ${codeExit}`,
        ));
      }
      resolve(normalizarRespuesta(json));
    });
  });
}

class WpossClient {
  /**
   * @param {object} opts
   * @param {string} [opts.merchantId] - transporta el terminalId de BAC.
   * @param {string} [opts.transport]  - 'http' (default) | 'spawn'.
   * @param {string} [opts.httpUrl]    - base del puente httpRunSDK (default localhost:0808). Solo 'http'.
   * @param {string} [opts.exePath]    - ruta del CSP.EMV.InteropEXE.exe. Solo 'spawn'.
   * @param {number} [opts.timeoutMs]
   * @param {function} [opts.logger]
   * Nota: `ip`/`port` se ignoran (el pinpad es USB, no TCP).
   */
  constructor({ merchantId, transport, httpUrl, exePath, timeoutMs, logger } = {}) {
    if (!merchantId) throw new Error('WpossClient (BAC): merchantId (terminalId) requerido');
    this.terminalId = String(merchantId);
    this.transport = transport === 'spawn' ? 'spawn' : DEFAULT_TRANSPORT;
    this.httpUrl = httpUrl || DEFAULT_HTTP_URL;
    this.exePath = exePath || DEFAULT_EXE_PATH;
    this.timeoutMs = timeoutMs || DEFAULT_TIMEOUT_MS;
    this.logger = logger;
  }

  /**
   * Ejecuta una transacción: arma args (con terminalId), despacha al transporte
   * configurado (http/spawn) y normaliza.
   */
  ejecutar(params) {
    const argsString = armarArgs({ terminalId: this.terminalId, ...params });
    const comun = { argsString, timeoutMs: this.timeoutMs, logger: this.logger };
    const promesa = this.transport === 'spawn'
      ? ejecutarSpawn({ exePath: this.exePath, ...comun })
      : ejecutarHttp({ httpUrl: this.httpUrl, ...comun });
    return promesa.then((data) => {
      // BAC no devuelve el terminalId en la respuesta; lo inyectamos del request
      // para que BancoMovimientos guarde TerminalIdPos/MerchantId (DTF-002).
      if (data && typeof data === 'object') {
        if (!data.terminal_id) data.terminal_id = this.terminalId;
        if (!data.merchant_id) data.merchant_id = this.terminalId;
      }
      return data;
    });
  }

  // --- Contrato del puente (mismos nombres que banco-promerica.js) ---

  /**
   * BAC no tiene "prueba de comunicación" como transacción. Se usa VERIFY_CARD
   * como sondeo de que el SDK/pinpad responden (devuelve track2/keyLabel/expDate).
   * ⚠️ Confirmar con el kit si VERIFY_CARD es aceptable como ping.
   */
  pruebaComunicacion() {
    return this.ejecutar({ transactionType: TX.VERIFY_CARD });
  }

  /** BAC no expone "estado de conexión" separado; alias de pruebaComunicacion. */
  estadoConexion() {
    return this.pruebaComunicacion();
  }

  /**
   * Venta. En BAC `totalAmount` INCLUYE impuesto + propina (+ vuelto).
   * @param {object} p
   * @param {number} p.baseAmount - monto base (sin impuesto ni propina).
   * @param {number} [p.taxAmount] - impuesto.
   * @param {number} [p.tipAmount] - propina.
   * @param {string} [p.invoice]   - identificador ÚNICO por intento (NO el de Caja).
   */
  compraNormal({ baseAmount, taxAmount, tipAmount, invoice } = {}) {
    if (baseAmount == null) throw new Error('compraNormal: baseAmount requerido');
    const base = Number(baseAmount) || 0;
    const tax = Number(taxAmount) || 0;
    const tip = Number(tipAmount) || 0;
    return this.ejecutar({
      transactionType: TX.SALE,
      invoice,                                   // ⚠️ debe ser único por intento
      totalAmount: aMontoDecimal(base + tax + tip),
      taxAmount: aMontoDecimal(taxAmount),       // ✅ taxAmount (NO txAmount) — manual DUAL
      tipAmount: aMontoDecimal(tipAmount),
    });
  }

  /**
   * Anulación (VOID). BAC requiere identificar la transacción original:
   * authorizationNumber + referenceNumber + systemTraceNumber (+ invoice + totalAmount).
   * `ticketNumber` se mapea a systemTraceNumber por compat con la firma de Promerica.
   */
  anulacion({ ticketNumber, authorizationNumber, referenceNumber, systemTraceNumber, invoice, totalAmount } = {}) {
    const stn = systemTraceNumber || ticketNumber;
    if (!stn && !invoice) throw new Error('anulacion (VOID): systemTraceNumber/ticketNumber o invoice requerido');
    return this.ejecutar({
      transactionType: TX.VOID,
      invoice,
      totalAmount: aMontoDecimal(totalAmount),
      authorizationNumber,
      referenceNumber,
      systemTraceNumber: stn,
    });
  }

  /**
   * Devolución / Refund — ❌ NO soportada por el SDK BAC (confirmado por Joel
   * Brenes, 2026-06-09: se maneja por datáfono independiente). Se devuelve un
   * resultado normalizado no-aprobado en vez de lanzar, para no romper la UI.
   */
  devolucion() {
    return Promise.resolve({
      rsp_code: 'NS',
      rsp_msg: 'Devolución no soportada por el SDK BAC (usar datáfono independiente)',
      raw: { unsupported: true, transactionType: 'REFUND' },
    });
  }

  /**
   * Reimpresión (REPRINT). Identifica la transacción por transactionId.
   * (manual DUAL: REPRINT requiere transactionType + transactionId [+ clientEmail opcional]).
   */
  reimpresion({ ticketNumber, transactionId, clientEmail } = {}) {
    const tid = transactionId || ticketNumber;
    if (!tid) throw new Error('reimpresion (REPRINT): transactionId requerido');
    return this.ejecutar({
      transactionType: TX.REPRINT,
      transactionId: tid,
      clientEmail,
    });
  }

  /** Cierre de lote (BATCH_SETTLEMENT). */
  cierre({ nitSelected } = {}) {
    return this.ejecutar({ transactionType: TX.BATCH_SETTLEMENT, nitSelected });
  }

  /** Reporte de totales del lote sin cerrar (BATCH_INQUIRY). */
  reporteCierre() {
    return this.ejecutar({ transactionType: TX.BATCH_INQUIRY });
  }

  /** BAC no distingue "último cierre"; alias de BATCH_INQUIRY. */
  reporteUltimoCierre() {
    return this.reporteCierre();
  }

  /** BAC no expone "reporte de auditoría" separado; alias de BATCH_INQUIRY. */
  reporteAuditoria() {
    return this.reporteCierre();
  }

  /**
   * "Última transacción" — en BAC el recovery se hace con BATCH_INQUIRY, que
   * lista las transacciones pendientes de conciliar (confirmado por Joel, 2026-06-09).
   */
  ultimaTransaccion() {
    return this.ejecutar({ transactionType: TX.BATCH_INQUIRY });
  }
}

module.exports = { WpossClient, BacError, TX, aMontoDecimal, armarArgs, normalizarRespuesta, ejecutarHttp, ejecutarSpawn };
