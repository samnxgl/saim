import express from 'express';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { initializeSlackApp, registerSlackHandlers } from './integrations/slack/index.js';
import { startScheduler, runInitialSync } from './services/scheduler.js';
import { closeDatabase } from './db/index.js';

async function main() {
  logger.info('Starting Saim - Virtual Executive Assistant');
  logger.info(`Environment: ${config.nodeEnv}`);

  // Initialize Express for health checks
  const expressApp = express();

  expressApp.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'saim',
    });
  });

  expressApp.get('/', (req, res) => {
    res.json({
      name: 'Saim - Virtual Executive Assistant',
      version: '1.0.0',
      description: 'AI-powered executive assistant for Next Gen Learning CEO',
    });
  });

  // Start Express server
  const server = expressApp.listen(config.port, () => {
    logger.info(`Health check server listening on port ${config.port}`);
  });

  // Initialize Slack app
  const slackApp = initializeSlackApp();
  registerSlackHandlers(slackApp);

  // Start Slack app
  await slackApp.start();
  logger.info('Slack app started in socket mode');

  // Run initial data sync
  logger.info('Running initial data synchronization...');
  await runInitialSync();

  // Start scheduler for periodic tasks
  startScheduler();

  // Graceful shutdown handling
  const shutdown = async () => {
    logger.info('Shutdown signal received');

    // Stop scheduler
    const { stopScheduler } = await import('./services/scheduler.js');
    stopScheduler();

    // Stop Slack app
    await slackApp.stop();
    logger.info('Slack app stopped');

    // Close database
    await closeDatabase();
    logger.info('Database connection closed');

    // Close Express server
    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      logger.warn('Forcing exit after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info('Saim is now running and ready to assist!');
}

main().catch((error) => {
  logger.error('Failed to start Saim', { error });
  process.exit(1);
});
