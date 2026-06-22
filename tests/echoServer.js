'use strict';

const net = require('net');

const PORT = Number(process.env.PORT || 8080);

const server = net.createServer((socket) => {
  console.log(`[echo] cliente conectado ${socket.remoteAddress}:${socket.remotePort}`);
  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const trimmed = buffer.trim();
    let req;
    try { req = JSON.parse(trimmed); } catch (_) { return; }

    console.log('[echo] request:', JSON.stringify(req));

    const tipo = req.type_transaction;
    const merchant = req.merchant_id || '0000000000';
    const respBase = {
      rsp_code: '00',
      rsp_msg: '*** APROBADO ***',
      merchant_id: merchant,
      terminal_id: '99999999',
      date: hoy(),
      time: ahora(),
    };

    let resp;
    switch (tipo) {
      case 'PRUEBA COMUNICACION':
        resp = { rsp_code: '00', rsp_msg: 'El POS se encuentra disponible' };
        break;
      case 'ESTADO DE CONEXION':
        resp = { rsp_code: '00', rsp_msg: 'ESTADO DE CONEXIÓN EXITOSA TIEMPO DE RESPUESTA: 0.83 Seg' };
        break;
      case 'COMPRA NORMAL':
        resp = {
          ...respBase,
          ticket_number: '000024',
          reference_number: '412116899423',
          stan: '000059',
          amount: req.base_amount || '0',
          auth_code: '058481',
          card: '****************1234',
          app_label: 'Debit Mastercard',
          aid: 'A0000000041010',
          arqc: 'B92E86B229608764',
          tvr: '0000008001',
          tsi: 'E000',
          pos_entry_mode: 'Contactless',
          holder_name: 'CLIENTE PRUEBA',
          app_version: 'BPM_1.0.0_250220',
          app_release: '20022025',
          merchant_name: 'COMERCIO ECHO',
        };
        break;
      case 'REIMPRESION':
        resp = { ...respBase, rsp_msg: 'REIMPRESION EXITOSA', ticket_number: req.ticket_number };
        break;
      case 'ANULACION':
        resp = { ...respBase, rsp_msg: 'ANULACION EXITOSA', ticket_number: req.ticket_number };
        break;
      case 'DEVOLUCIONES':
        resp = { ...respBase, rsp_msg: 'DEVOLUCION EXITOSA', ticket_number: req.ticket_number };
        break;
      case 'CIERRE':
        resp = {
          ...respBase,
          batch_number: '000104',
          cant_transactions: '6',
          amount_transactions: '7000',
          cant_refunds: '2',
          amount_refunds: '2000',
        };
        break;
      case 'ULTIMA TRANSACCION':
        resp = {
          ...respBase,
          rsp_msg: 'CONSULTA DE TRANSACCIÓN EXITOSA',
          ticket_number: '000049',
          reference_number: '412116899423',
          stan: '000081',
          amount: '1000',
          auth_code: '058481',
          card: '****************1234',
          pos_entry_mode: 'Contactless',
        };
        break;
      default:
        resp = { rsp_code: '02', rsp_msg: `Transacción no soportada por echo: ${tipo}` };
    }

    const out = JSON.stringify(resp) + '\n';
    console.log('[echo] response:', out.trim());
    socket.write(out);
    buffer = '';
  });

  socket.on('error', (err) => console.error('[echo] error:', err.message));
});

server.listen(PORT, () => {
  console.log(`[echo] POS simulado escuchando en :${PORT}`);
});

function hoy() {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function ahora() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function pad(n) { return String(n).padStart(2, '0'); }
