'use strict';

const { WpossClient } = require('../src/bancos/banco-promerica');

const cli = new WpossClient({
  ip: process.env.POS_IP || '127.0.0.1',
  port: Number(process.env.POS_PORT || 8080),
  merchantId: process.env.POS_MERCHANT || '1066864914',
  timeoutMs: 10000,
  logger: (m) => console.log(m),
});

(async () => {
  let fallos = 0;

  const probar = async (nombre, fn) => {
    try {
      console.log(`\n--- ${nombre} ---`);
      const r = await fn();
      console.log('OK:', JSON.stringify(r));
    } catch (err) {
      fallos++;
      console.error('FAIL:', err.message);
    }
  };

  await probar('PRUEBA COMUNICACION', () => cli.pruebaComunicacion());
  await probar('ESTADO CONEXION',     () => cli.estadoConexion());
  await probar('COMPRA NORMAL ₡10.00', () => cli.compraNormal({ baseAmount: 10 }));
  await probar('REIMPRESION ticket 000024', () => cli.reimpresion({ ticketNumber: '000024' }));
  await probar('ULTIMA TRANSACCION', () => cli.ultimaTransaccion());
  await probar('CIERRE', () => cli.cierre());

  console.log(`\nFinal: ${fallos === 0 ? 'TODO OK' : `${fallos} fallos`}`);
  process.exit(fallos === 0 ? 0 : 1);
})();
