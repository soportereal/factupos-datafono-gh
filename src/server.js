'use strict';

const express = require('express');
const cors = require('cors');
const net = require('net');
const cfgMod = require('./config');

const VERSION = require('../package.json').version;

// Plugins por banco
const plugins = {
  'banco-promerica': require('./bancos/banco-promerica'),
  'bac-credomatic': require('./bancos/bac-credomatic'),     // scaffold 2026-06-09 (pendiente kit de pruebas)
  // 'banco-nacional': require('./bancos/banco-nacional'),  // futuro
};

function crearApp({ logger }) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const cfgInicial = cfgMod.cargar();
  const corsOrigins = cfgInicial.servidor.corsOrigins || ['*'];
  app.use(cors({
    origin: corsOrigins.includes('*') ? true : corsOrigins,
    credentials: false,
  }));

  app.use((req, _res, next) => {
    logger.info(`${req.method} ${req.path}`);
    next();
  });

  app.use((req, res, next) => {
    const apiKey = cfgMod.cargar().servidor.apiKey;
    if (!apiKey) return next();
    if (req.method === 'GET' && req.path === '/salud') return next();
    const enviada = req.get('x-api-key');
    if (enviada !== apiKey) return res.status(401).json({ error: 'API key inválida' });
    next();
  });

  app.get('/salud', (_req, res) => {
    const c = cfgMod.cargar();
    res.json({
      app: 'FactuposDatafono',
      version: VERSION,
      banco: c.banco,
      bancosDisponibles: Object.keys(plugins),
      pos: { ip: c.pos.ip, port: c.pos.port, merchantId: c.pos.merchantId ? 'configurado' : 'NO CONFIGURADO' },
      servidor: { host: c.servidor.host, port: c.servidor.port },
      hora: new Date().toISOString(),
    });
  });

  app.get('/config', (_req, res) => {
    const c = cfgMod.cargar();
    const safe = JSON.parse(JSON.stringify(c));
    if (safe.servidor) safe.servidor.apiKey = safe.servidor.apiKey ? '***' : '';
    res.json(safe);
  });

  app.put('/config', (req, res) => {
    try {
      const nuevo = cfgMod.guardar(req.body || {});
      const safe = JSON.parse(JSON.stringify(nuevo));
      if (safe.servidor) safe.servidor.apiKey = safe.servidor.apiKey ? '***' : '';
      res.json({ ok: true, config: safe });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  function clienteDesdeReq(req) {
    const c = cfgMod.cargar();
    const banco = (req.body && req.body.banco) || c.banco || 'banco-promerica';
    const plugin = plugins[banco];
    if (!plugin) {
      const err = new Error(`Banco no soportado: ${banco}`);
      err.code = 'BANCO_NO_SOPORTADO';
      throw err;
    }
    const merchantId = (req.body && req.body.merchantId) || c.pos.merchantId;
    const ip = (req.body && req.body.ip) || c.pos.ip;
    const port = (req.body && req.body.port) || c.pos.port;
    const timeoutMs = (req.body && req.body.timeoutMs) || c.pos.timeoutMs;
    // Config del SDK BAC (solo la usa el plugin bac-credomatic; Promerica la ignora).
    const exePath = (req.body && req.body.exePath) || (c.bac && c.bac.exePath) || undefined;
    const transport = (req.body && req.body.transport) || (c.bac && c.bac.transport) || undefined;
    const httpUrl = (req.body && req.body.httpUrl) || (c.bac && c.bac.httpUrl) || undefined;
    if (!merchantId) {
      const err = new Error('merchantId no configurado en el puente');
      err.code = 'NO_MERCHANT';
      throw err;
    }
    return new plugin.WpossClient({ ip, port, merchantId, timeoutMs, exePath, transport, httpUrl, logger: (m) => logger.debug(m) });
  }

  function manejar(handler) {
    return async (req, res) => {
      try {
        const cli = clienteDesdeReq(req);
        const data = await handler(cli, req);
        res.json({ ok: data.rsp_code === '00', data });
      } catch (err) {
        const code = err.code || 'UNKNOWN';
        const status = code === 'NO_MERCHANT' || code === 'BANCO_NO_SOPORTADO' ? 400 : 502;
        logger.error(`Error: ${err.message}`);
        res.status(status).json({ ok: false, error: err.message, code });
      }
    };
  }

  // Probar conectividad TCP al POS sin enviar transacción.
  // No abre conversación — solo verifica que el puerto acepta conexiones.
  app.post('/probar-tcp', (req, res) => {
    const c = cfgMod.cargar();
    const ip = (req.body && req.body.ip) || c.pos.ip;
    const port = (req.body && req.body.port) || c.pos.port;
    const timeoutMs = (req.body && req.body.timeoutMs) || 3000;

    if (!ip || !port) return res.status(400).json({ ok: false, error: 'ip y port requeridos' });

    const inicio = Date.now();
    const socket = new net.Socket();
    let cerrado = false;

    const cerrar = (ok, info) => {
      if (cerrado) return;
      cerrado = true;
      try { socket.destroy(); } catch (_) {}
      const latencyMs = Date.now() - inicio;
      const detalle = info ? (info.error || info.mensaje || JSON.stringify(info)) : '';
      logger.info(`[probar-tcp] ${ip}:${port} ok=${ok} ${latencyMs}ms ${detalle}`);
      res.json({ ok, ip, port, latencyMs, ...info });
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => cerrar(false, { error: `Timeout (${timeoutMs}ms) — el puerto no responde` }));
    socket.once('error',   (e) => cerrar(false, { error: `${e.code || 'ERROR'}: ${e.message}` }));
    socket.connect(port, ip, () => cerrar(true, { mensaje: 'Puerto abierto y aceptando conexiones' }));
  });

  app.post('/transaccion/prueba',           manejar((c) => c.pruebaComunicacion()));
  app.post('/transaccion/estado-conexion',  manejar((c) => c.estadoConexion()));
  app.post('/transaccion/compra-normal',    manejar((c, r) => c.compraNormal(r.body || {})));
  app.post('/transaccion/anulacion',        manejar((c, r) => c.anulacion(r.body || {})));
  app.post('/transaccion/devolucion',       manejar((c, r) => c.devolucion(r.body || {})));
  app.post('/transaccion/reimpresion',      manejar((c, r) => c.reimpresion(r.body || {})));
  app.post('/transaccion/cierre',           manejar((c) => c.cierre()));
  app.post('/transaccion/reporte-cierre',   manejar((c) => c.reporteCierre()));
  app.post('/transaccion/reporte-ultimo',   manejar((c) => c.reporteUltimoCierre()));
  app.post('/transaccion/reporte-auditoria', manejar((c) => c.reporteAuditoria()));
  app.post('/transaccion/ultima',           manejar((c) => c.ultimaTransaccion()));

  app.use((err, _req, res, _next) => {
    logger.error(`Excepción no manejada: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  });

  return app;
}

module.exports = { crearApp };
