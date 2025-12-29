import { App, LogLevel } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

let app: App | null = null;
let webClient: WebClient | null = null;

export function initializeSlackApp(): App {
  if (app) {
    return app;
  }

  app = new App({
    token: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    appToken: config.slackAppToken,
    socketMode: true,
    logLevel: config.nodeEnv === 'development' ? LogLevel.DEBUG : LogLevel.INFO,
  });

  webClient = new WebClient(config.slackBotToken);

  logger.info('Slack app initialized');

  return app;
}

export function getSlackApp(): App {
  if (!app) {
    throw new Error('Slack app not initialized. Call initializeSlackApp first.');
  }
  return app;
}

export function getWebClient(): WebClient {
  if (!webClient) {
    webClient = new WebClient(config.slackBotToken);
  }
  return webClient;
}

export async function getUserInfo(userId: string) {
  const client = getWebClient();
  try {
    const result = await client.users.info({ user: userId });
    return result.user;
  } catch (error) {
    logger.error('Failed to get user info', { userId, error });
    return null;
  }
}

export async function getChannelInfo(channelId: string) {
  const client = getWebClient();
  try {
    const result = await client.conversations.info({ channel: channelId });
    return result.channel;
  } catch (error) {
    logger.error('Failed to get channel info', { channelId, error });
    return null;
  }
}

export async function sendMessage(
  channelId: string,
  text: string,
  options?: {
    threadTs?: string;
    blocks?: any[];
  }
) {
  const client = getWebClient();
  try {
    const result = await client.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: options?.threadTs,
      blocks: options?.blocks,
    });
    return result;
  } catch (error) {
    logger.error('Failed to send message', { channelId, error });
    throw error;
  }
}

export async function sendDirectMessage(
  userId: string,
  text: string,
  options?: {
    blocks?: any[];
  }
) {
  const client = getWebClient();
  try {
    // Open DM channel first
    const dm = await client.conversations.open({ users: userId });
    if (!dm.channel?.id) {
      throw new Error('Failed to open DM channel');
    }

    const result = await client.chat.postMessage({
      channel: dm.channel.id,
      text,
      blocks: options?.blocks,
    });
    return result;
  } catch (error) {
    logger.error('Failed to send direct message', { userId, error });
    throw error;
  }
}

export async function getConversationHistory(
  channelId: string,
  options?: {
    limit?: number;
    oldest?: string;
    latest?: string;
  }
) {
  const client = getWebClient();
  try {
    const result = await client.conversations.history({
      channel: channelId,
      limit: options?.limit || 100,
      oldest: options?.oldest,
      latest: options?.latest,
    });
    return result.messages || [];
  } catch (error) {
    logger.error('Failed to get conversation history', { channelId, error });
    return [];
  }
}

export async function listAllChannels() {
  const client = getWebClient();
  try {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
    });
    return result.channels || [];
  } catch (error) {
    logger.error('Failed to list channels', { error });
    return [];
  }
}

export async function listDirectMessageChannels() {
  const client = getWebClient();
  try {
    const result = await client.conversations.list({
      types: 'im',
      limit: 200,
    });
    return result.channels || [];
  } catch (error) {
    logger.error('Failed to list DM channels', { error });
    return [];
  }
}
