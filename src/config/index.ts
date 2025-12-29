import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  // Slack
  slackBotToken: z.string().min(1),
  slackSigningSecret: z.string().min(1),
  slackAppToken: z.string().min(1),

  // Anthropic
  anthropicApiKey: z.string().min(1),

  // Google
  googleServiceAccountEmail: z.string().min(1),
  googlePrivateKey: z.string().min(1),

  // Document IDs
  strategicPlanDocId: z.string().min(1),

  // Database
  databaseUrl: z.string().min(1),

  // CEO
  ceoSlackUserId: z.string().min(1),

  // AutoContent API (optional - for podcast generation)
  autoContentApiKey: z.string().optional(),

  // Application
  port: z.number().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Sync intervals (minutes)
  strategicPlanSyncInterval: z.number().default(60),
  slackHistorySyncInterval: z.number().default(15),
  financialSyncInterval: z.number().default(120),

  // Podcast settings
  dailyPodcastTime: z.string().default('18:00'), // Time to generate daily podcast (24h format)
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  console.log('Loading configuration...');

  const raw = {
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    googlePrivateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    strategicPlanDocId: process.env.STRATEGIC_PLAN_DOC_ID,
    databaseUrl: process.env.DATABASE_URL,
    ceoSlackUserId: process.env.CEO_SLACK_USER_ID,
    autoContentApiKey: process.env.AUTOCONTENT_API_KEY,
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV,
    logLevel: process.env.LOG_LEVEL,
    strategicPlanSyncInterval: parseInt(process.env.STRATEGIC_PLAN_SYNC_INTERVAL || '60', 10),
    slackHistorySyncInterval: parseInt(process.env.SLACK_HISTORY_SYNC_INTERVAL || '15', 10),
    financialSyncInterval: parseInt(process.env.FINANCIAL_SYNC_INTERVAL || '120', 10),
    dailyPodcastTime: process.env.DAILY_PODCAST_TIME || '18:00',
  };

  // Log which variables are missing (without exposing values)
  const requiredVars = [
    'SLACK_BOT_TOKEN',
    'SLACK_SIGNING_SECRET',
    'SLACK_APP_TOKEN',
    'ANTHROPIC_API_KEY',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_PRIVATE_KEY',
    'STRATEGIC_PLAN_DOC_ID',
    'DATABASE_URL',
    'CEO_SLACK_USER_ID',
  ];

  const missing = requiredVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
  }

  try {
    const config = configSchema.parse(raw);
    console.log('Configuration loaded successfully');
    return config;
  } catch (error) {
    console.error('Configuration validation failed:', error);
    throw error;
  }
}

export const config = loadConfig();
