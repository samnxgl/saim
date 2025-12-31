import express from 'express';
import path from 'path';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { closeDatabase } from './db/index.js';

async function main() {
  console.log('=== Saim Starting ===');
  logger.info('Starting Saim - Virtual Executive Assistant');
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info(`Port: ${config.port}`);

  // Initialize Express for health checks FIRST
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

  // Serve voice interface static files
  const voicePublicPath = path.join(process.cwd(), 'dist/voice/public');
  expressApp.use('/voice-app', express.static(voicePublicPath));

  // Voice interface route
  expressApp.get('/talk', (req, res) => {
    res.sendFile(path.join(voicePublicPath, 'index.html'));
  });

  // Start Express server immediately for health checks
  const server = expressApp.listen(config.port, '0.0.0.0', () => {
    console.log(`Health check server listening on 0.0.0.0:${config.port}`);
    logger.info(`Health check server listening on port ${config.port}`);
  });

  // Initialize voice WebSocket server
  try {
    const { initializeVoiceServer } = await import('./voice/server.js');
    initializeVoiceServer(server);
    logger.info('Voice WebSocket server initialized');
  } catch (error) {
    logger.warn('Voice server not initialized', { error });
  }

  // Initialize remaining services after health check is available
  try {
    // Import Slack modules
    const { initializeSlackApp, registerSlackHandlers } = await import('./integrations/slack/index.js');

    // Initialize Slack app
    logger.info('Initializing Slack app...');
    const slackApp = initializeSlackApp();
    registerSlackHandlers(slackApp);

    // Start Slack app
    await slackApp.start();
    logger.info('Slack app started in socket mode');

    // Import and run initial sync (don't block startup)
    const { startScheduler, runInitialSync } = await import('./services/scheduler.js');

    // Run initial sync in background
    runInitialSync().catch((error) => {
      logger.error('Initial sync failed', { error });
    });

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
    console.log('=== Saim Ready ===');
  } catch (error) {
    logger.error('Failed to initialize services', { error });
    console.error('Service initialization error:', error);
    // Keep running for health checks, but log the error
  }
}

main().catch((error) => {
  console.error('Fatal error during startup:', error);
  logger.error('Failed to start Saim', { error });
  process.exit(1);
});
