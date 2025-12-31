import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { syncStrategicPlan, syncHRDocuments } from '../integrations/google/docs.js';
import { syncAllFinancialSheets } from '../integrations/google/sheets.js';
import { syncSlackMessages } from '../integrations/slack/sync.js';
import { analyzeRecentCommunications, sendDailyBriefing } from './patterns.js';
import { checkPendingTasks } from './tasks.js';
import { sendDailyPodcastToCEO } from './podcast.js';
import { isAutoContentConfigured } from '../integrations/autocontent/index.js';

let isRunning = false;
const scheduledJobs: cron.ScheduledTask[] = [];

export function startScheduler(): void {
  if (isRunning) {
    logger.warn('Scheduler already running');
    return;
  }

  logger.info('Starting scheduler');

  // Sync strategic plan every hour
  scheduledJobs.push(
    cron.schedule(`*/${config.strategicPlanSyncInterval} * * * *`, async () => {
      logger.info('Running scheduled strategic plan sync');
      try {
        await syncStrategicPlan();
      } catch (error) {
        logger.error('Scheduled strategic plan sync failed', { error });
      }
    })
  );

  // Sync Slack messages every 15 minutes
  scheduledJobs.push(
    cron.schedule(`*/${config.slackHistorySyncInterval} * * * *`, async () => {
      logger.info('Running scheduled Slack message sync');
      try {
        await syncSlackMessages();
      } catch (error) {
        logger.error('Scheduled Slack sync failed', { error });
      }
    })
  );

  // Sync financial data every 2 hours
  scheduledJobs.push(
    cron.schedule(`*/${config.financialSyncInterval} * * * *`, async () => {
      logger.info('Running scheduled financial data sync');
      try {
        await syncAllFinancialSheets();
      } catch (error) {
        logger.error('Scheduled financial sync failed', { error });
      }
    })
  );

  // Sync HR documents daily at 6 AM
  scheduledJobs.push(
    cron.schedule('0 6 * * *', async () => {
      logger.info('Running scheduled HR documents sync');
      try {
        await syncHRDocuments();
      } catch (error) {
        logger.error('Scheduled HR documents sync failed', { error });
      }
    })
  );

  // Run pattern analysis every 4 hours
  scheduledJobs.push(
    cron.schedule('0 */4 * * *', async () => {
      logger.info('Running scheduled pattern analysis');
      try {
        await analyzeRecentCommunications();
      } catch (error) {
        logger.error('Scheduled pattern analysis failed', { error });
      }
    })
  );

  // Send daily briefing at 8 AM
  scheduledJobs.push(
    cron.schedule('0 8 * * *', async () => {
      logger.info('Running scheduled daily briefing');
      try {
        await sendDailyBriefing();
      } catch (error) {
        logger.error('Scheduled daily briefing failed', { error });
      }
    })
  );

  // Check pending delegated tasks daily at 4 PM
  scheduledJobs.push(
    cron.schedule('0 16 * * *', async () => {
      logger.info('Checking pending delegated tasks');
      try {
        await checkPendingTasks();
      } catch (error) {
        logger.error('Pending tasks check failed', { error });
      }
    })
  );

  // Generate daily podcast at configured time (default 6 PM)
  if (isAutoContentConfigured()) {
    const [hour, minute] = config.dailyPodcastTime.split(':');
    const cronTime = `${minute || '0'} ${hour || '18'} * * *`;

    scheduledJobs.push(
      cron.schedule(cronTime, async () => {
        logger.info('Running scheduled daily podcast generation');
        try {
          await sendDailyPodcastToCEO();
        } catch (error) {
          logger.error('Scheduled daily podcast failed', { error });
        }
      })
    );

    logger.info('Daily podcast scheduled', { time: config.dailyPodcastTime });
  } else {
    logger.info('Daily podcast not scheduled - AUTOCONTENT_API_KEY not configured');
  }

  isRunning = true;
  logger.info('Scheduler started with all jobs');
}

export function stopScheduler(): void {
  logger.info('Stopping scheduler');

  for (const job of scheduledJobs) {
    job.stop();
  }

  scheduledJobs.length = 0;
  isRunning = false;

  logger.info('Scheduler stopped');
}

export async function runInitialSync(): Promise<void> {
  logger.info('Running initial data sync');

  try {
    // Sync in parallel where possible
    await Promise.allSettled([
      syncStrategicPlan(),
      syncSlackMessages(),
      syncAllFinancialSheets(),
    ]);

    logger.info('Initial sync completed');
  } catch (error) {
    logger.error('Initial sync had errors', { error });
  }
}
