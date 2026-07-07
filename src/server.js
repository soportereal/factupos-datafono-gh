'use strict';

const express = require('express');
const cors = require('cors');
const net = require('net');
const cfgMod = require('./config');

const VERSION = require('../package.json').version;

// HTML de la ventana de log en vivo (la abre el tray). Autocontenido: se conecta
// por SSE a /logs/stream y pinta cada línea estilo consola, con colores por nivel.
function PAGINA_MONITOR(version) {
  return `<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FactuposDatafono · Log en vivo</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;font-family:'Cascadia Code',Consolas,'Roboto Mono',monospace;background:#0b0f1a;color:#cbd5e1;font-size:13px}
  header{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:8px 12px;background:#111827;border-bottom:1px solid #1f2937;flex-wrap:wrap}
  header h1{font-size:13px;margin:0;color:#93c5fd;font-weight:600;display:flex;align-items:center;gap:7px}
  .dot{width:9px;height:9px;border-radius:50%;background:#ef4444;box-shadow:0 0 6px #ef4444}
  .dot.on{background:#22c55e;box-shadow:0 0 6px #22c55e}
  header .sp{flex:1}
  button,select,input{font:inherit;background:#1f2937;color:#cbd5e1;border:1px solid #374151;border-radius:6px;padding:4px 10px;cursor:pointer}
  button:hover{background:#374151}
  input[type=search]{cursor:text;min-width:140px}
  #log{padding:10px 12px;white-space:pre-wrap;word-break:break-word;line-height:1.5}
  .l{display:block;padding:1px 0;border-bottom:1px solid rgba(255,255,255,.03)}
  .l .ts{color:#475569}
  .l.error{color:#fca5a5}.l.error .tag{color:#ef4444}
  .l.warn{color:#fde047}.l.warn .tag{color:#eab308}
  .l.info{color:#cbd5e1}.l.info .tag{color:#38bdf8}
  .l.debug{color:#64748b}.l.debug .tag{color:#64748b}
  .l.bac{background:rgba(56,189,248,.06)}
  .tag{font-weight:600}
  .hide{display:none}
</style></head><body>
<header>
  <h1><span class="dot" id="dot"></span> FactuposDatafono · Log en vivo <span style="color:#475569">v${version}</span></h1>
  <div class="sp"></div>
  <input type="search" id="filtro" placeholder="filtrar…">
  <select id="nivel"><option value="">todos</option><option value="error">error</option><option value="warn">warn+</option><option value="info">info+</option></select>
  <button id="pausa">⏸ Pausar</button>
  <button id="limpiar">🗑 Limpiar</button>
  <label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="auto" checked style="cursor:pointer"> auto-scroll</label>
</header>
<div id="log"></div>
<script>
  var logEl=document.getElementById('log'), dot=document.getElementById('dot');
  var pausa=false, NIV={error:0,warn:1,info:2,debug:3};
  document.getElementById('pausa').onclick=function(){pausa=!pausa;this.textContent=pausa?'▶ Reanudar':'⏸ Pausar';};
  document.getElementById('limpiar').onclick=function(){logEl.innerHTML='';};
  var filtro=document.getElementById('filtro'), nivelSel=document.getElementById('nivel'), auto=document.getElementById('auto');
  function visible(el){
    var t=(filtro.value||'').toLowerCase();
    var okTxt=!t||el.textContent.toLowerCase().indexOf(t)>=0;
    var lim=nivelSel.value, okNiv=!lim||NIV[el.dataset.nivel]<=NIV[lim];
    el.classList.toggle('hide',!(okTxt&&okNiv));
  }
  filtro.oninput=nivelSel.onchange=function(){[].forEach.call(logEl.children,visible);};
  function esc(s){return (s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
  function add(ev){
    var d=document.createElement('span');
    d.className='l '+(ev.nivel||'info')+((ev.mensaje||'').indexOf('[bac]')>=0?' bac':'');
    d.dataset.nivel=ev.nivel||'info';
    var hora=(ev.ts||'').replace('T',' ').replace('Z','').substring(11,23);
    d.innerHTML='<span class="ts">'+hora+'</span> <span class="tag">'+(ev.nivel||'').toUpperCase()+'</span> '+esc(ev.mensaje);
    visible(d);
    logEl.appendChild(d);
    while(logEl.children.length>1000)logEl.removeChild(logEl.firstChild);
    if(auto.checked&&!pausa)window.scrollTo(0,document.body.scrollHeight);
  }
  function conectar(){
    var es=new EventSource('/logs/stream');
    es.onopen=function(){dot.classList.add('on');};
    es.onerror=function(){dot.classList.remove('on');};
    es.onmessage=function(e){ if(pausa)return; try{add(JSON.parse(e.data));}catch(_){}}
  }
  conectar();
</script>
</body></html>`;
}

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

  // Private Network Access (Chrome/Edge 104+): una página servida por HTTPS pública
  // (DTF-001 en invefacon.factupos.com) que hace fetch a 127.0.0.1 es una petición a
  // "red privada" y el navegador la BLOQUEA salvo que la respuesta al preflight traiga
  // este header. Sin él, la web muestra "Failed to fetch" aunque el puente esté corriendo.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Private-Network', 'true');
    next();
  });

  app.use(cors({
    origin: corsOrigins.includes('*') ? true : corsOrigins,
    credentials: false,
    allowedHeaders: ['Content-Type', 'x-api-key'],
  }));

  app.use((req, _res, next) => {
    logger.info(`${req.method} ${req.path}`);
    next();
  });

  app.use((req, res, next) => {
    const apiKey = cfgMod.cargar().servidor.apiKey;
    if (!apiKey) return next();
    // Endpoints de diagnóstico local (sin api key): salud + monitor de log en vivo.
    if (req.method === 'GET' && ['/salud', '/monitor', '/logs/stream'].includes(req.path)) return next();
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

  // --- Monitor de log en vivo (lo abre el tray: "Ver log en vivo…") ---
  // Página estilo consola que se actualiza por SSE con cada línea del log.
  app.get('/monitor', (_req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(PAGINA_MONITOR(VERSION));
  });

  // Stream de log en vivo (Server-Sent Events): historial + nuevas líneas.
  app.get('/logs/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    const enviar = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch (_) {} };
    for (const ev of logger.historial()) enviar(ev);          // historial
    const off = logger.onLinea(enviar);                        // nuevas líneas
    const keepalive = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 15000);
    req.on('close', () => { clearInterval(keepalive); off(); });
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
