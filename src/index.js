#!/usr/bin/env node
'use strict';

const { crearApp } = require('./server');
const cfgMod = require('./config');
const loggerMod = require('./logger');
const { iniciarTray } = require('./tray');

let servidorActual = null;
let trayActual = null;

function arrancarServidor(logger) {
  const cfg = cfgMod.cargar();
  const app = crearApp({ logger });
  return app.listen(cfg.servidor.port, cfg.servidor.host, () => {
    logger.info(`Escuchando en http://${cfg.servidor.host}:${cfg.servidor.port}`);
  });
}

async function reiniciarServidor(logger) {
  if (servidorActual) {
    await new Promise((resolve) => servidorActual.close(resolve));
    servidorActual = null;
    logger.info('Servidor cerrado para reinicio');
  }
  servidorActual = arrancarServidor(logger);
}

function salirApp(logger) {
  logger.info('Saliendo...');
  if (trayActual) try { trayActual.kill(false); } catch (_) {}
  if (servidorActual) servidorActual.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

function main() {
  const cfg = cfgMod.cargar();
  const logger = loggerMod.crear({ nivel: cfg.logs.nivel });

  const version = require('../package.json').version;
  logger.info('====================================');
  logger.info(`FactuposDatafono v${version} iniciando...`);
  logger.info(`Build: ${new Date().toISOString()} (al iniciar)`);
  logger.info(`Config: ${cfgMod.rutaConfig()}`);
  logger.info(`POS:    ${cfg.pos.ip}:${cfg.pos.port} (merchantId=${cfg.pos.merchantId || 'NO CONFIGURADO'})`);
  logger.info(`Bancos: banco-promerica (WPOSS protocolo AES + SHA256 + length prefix)`);
  logger.info('====================================');

  servidorActual = arrancarServidor(logger);
  logger.info(`Ping: curl http://${cfg.servidor.host}:${cfg.servidor.port}/salud`);

  // Tray icon (solo Windows; en otros SO sigue en consola)
  if (!process.argv.includes('--no-tray')) {
    try {
      trayActual = iniciarTray({
        logger,
        cfgMod,
        rutaConfigDir: cfgMod.rutaConfigDir,
        rutaLogs: cfgMod.rutaLogs,
        onSalir: () => salirApp(logger),
        onReiniciar: () => reiniciarServidor(logger),
      });
    } catch (err) {
      logger.warn(`No se pudo iniciar tray icon: ${err.message}. Continuando en modo consola.`);
    }
  }

  process.on('SIGINT',  () => salirApp(logger));
  process.on('SIGTERM', () => salirApp(logger));
  process.on('uncaughtException',  (err) => logger.error(`uncaughtException: ${err.stack || err.message}`));
  process.on('unhandledRejection', (err) => logger.error(`unhandledRejection: ${err}`));
}

if (require.main === module) main();
