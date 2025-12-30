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

export async function getMessage(channelId: string, messageTs: string) {
  const client = getWebClient();
  try {
    // Get the specific message using conversations.history with inclusive flag
    const result = await client.conversations.history({
      channel: channelId,
      latest: messageTs,
      oldest: messageTs,
      inclusive: true,
      limit: 1,
    });
    return result.messages?.[0] || null;
  } catch (error) {
    logger.error('Failed to get message', { channelId, messageTs, error });
    return null;
  }
}

export async function getThreadMessages(channelId: string, threadTs: string) {
  const client = getWebClient();
  try {
    const result = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 100,
    });
    return result.messages || [];
  } catch (error) {
    logger.error('Failed to get thread messages', { channelId, threadTs, error });
    return [];
  }
}

export async function getFileInfo(fileId: string) {
  const client = getWebClient();
  try {
    const result = await client.files.info({ file: fileId });
    return result.file || null;
  } catch (error) {
    logger.error('Failed to get file info', { fileId, error });
    return null;
  }
}

export async function downloadFileContent(fileUrl: string): Promise<string | null> {
  try {
    const response = await fetch(fileUrl, {
      headers: {
        'Authorization': `Bearer ${config.slackBotToken}`,
      },
    });

    if (!response.ok) {
      logger.error('Failed to download file', { status: response.status });
      return null;
    }

    const contentType = response.headers.get('content-type') || '';

    // Only handle text-based files
    if (contentType.includes('text') ||
        contentType.includes('json') ||
        contentType.includes('javascript') ||
        contentType.includes('xml') ||
        contentType.includes('csv')) {
      return await response.text();
    }

    // For PDFs and other binary files, return metadata instead
    return `[Binary file: ${contentType}]`;
  } catch (error) {
    logger.error('Failed to download file content', { fileUrl, error });
    return null;
  }
}

export async function findChannelByName(channelName: string): Promise<string | null> {
  const client = getWebClient();
  try {
    // Remove # prefix if present
    const name = channelName.replace(/^#/, '');

    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 1000,
    });

    const channel = result.channels?.find(
      c => c.name?.toLowerCase() === name.toLowerCase()
    );

    return channel?.id || null;
  } catch (error) {
    logger.error('Failed to find channel by name', { channelName, error });
    return null;
  }
}
