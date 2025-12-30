import { db, schema } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import {
  getWebClient,
  getUserInfo,
  getChannelInfo,
  listAllChannels,
  listDirectMessageChannels,
  getConversationHistory,
} from './client.js';
import { config } from '../../config/index.js';
import { subHours } from 'date-fns';

export async function syncSlackMessages(): Promise<void> {
  logger.info('Starting Slack message sync');

  try {
    // Sync public and private channels
    const channels = await listAllChannels();
    for (const channel of channels) {
      if (channel.id && channel.is_member) {
        await syncChannelMessages(channel.id, channel.name || 'unknown');
      }
    }

    // Sync CEO's direct messages
    const dmChannels = await listDirectMessageChannels();
    for (const dm of dmChannels) {
      if (dm.id) {
        await syncDMMessages(dm.id);
      }
    }

    logger.info('Slack message sync completed');
  } catch (error) {
    logger.error('Slack message sync failed', { error });
  }
}

async function syncChannelMessages(
  channelId: string,
  channelName: string
): Promise<void> {
  try {
    // Get messages from the last sync period
    const oldest = String(subHours(new Date(), 24).getTime() / 1000);

    const messages = await getConversationHistory(channelId, {
      limit: 200,
      oldest,
    });

    for (const message of messages) {
      if (!message.ts || !message.user || !message.text) {
        continue;
      }

      const userName = await resolveUserName(message.user);

      // Convert Slack timestamp to Date (format: "1234567890.123456")
      const slackCreatedAt = new Date(parseFloat(message.ts) * 1000);

      await db
        .insert(schema.slackMessages)
        .values({
          slackMessageId: message.ts,
          channelId,
          channelName,
          userId: message.user,
          userName,
          text: message.text,
          timestamp: message.ts,
          threadTs: message.thread_ts || null,
          isDirectMessage: false,
          slackCreatedAt,
        })
        .onConflictDoNothing();
    }

    logger.debug('Channel messages synced', { channelId, channelName, count: messages.length });
  } catch (error) {
    logger.error('Failed to sync channel messages', { channelId, error });
  }
}

async function syncDMMessages(channelId: string): Promise<void> {
  try {
    const oldest = String(subHours(new Date(), 24).getTime() / 1000);

    const messages = await getConversationHistory(channelId, {
      limit: 200,
      oldest,
    });

    for (const message of messages) {
      if (!message.ts || !message.user || !message.text) {
        continue;
      }

      const userName = await resolveUserName(message.user);

      // Convert Slack timestamp to Date (format: "1234567890.123456")
      const slackCreatedAt = new Date(parseFloat(message.ts) * 1000);

      await db
        .insert(schema.slackMessages)
        .values({
          slackMessageId: message.ts,
          channelId,
          channelName: 'DM',
          userId: message.user,
          userName,
          text: message.text,
          timestamp: message.ts,
          threadTs: message.thread_ts || null,
          isDirectMessage: true,
          slackCreatedAt,
        })
        .onConflictDoNothing();
    }

    logger.debug('DM messages synced', { channelId, count: messages.length });
  } catch (error) {
    logger.error('Failed to sync DM messages', { channelId, error });
  }
}

const userNameCache = new Map<string, string>();

async function resolveUserName(userId: string): Promise<string> {
  if (userNameCache.has(userId)) {
    return userNameCache.get(userId)!;
  }

  const user = await getUserInfo(userId);
  const name = user?.real_name || user?.name || userId;
  userNameCache.set(userId, name);
  return name;
}

export async function getRecentMessages(options?: {
  userId?: string;
  channelId?: string;
  limit?: number;
  includeThreads?: boolean;
}): Promise<typeof schema.slackMessages.$inferSelect[]> {
  const limit = options?.limit || 100;

  let query = db.select().from(schema.slackMessages);

  // Apply filters if needed (basic implementation)
  const results = await query
    .orderBy(schema.slackMessages.timestamp)
    .limit(limit);

  return results;
}

export async function searchMessages(
  searchTerm: string,
  options?: {
    limit?: number;
    channelId?: string;
  }
): Promise<typeof schema.slackMessages.$inferSelect[]> {
  // Simple search - in production, consider using full-text search
  const allMessages = await db.select().from(schema.slackMessages).limit(1000);

  const filtered = allMessages.filter((msg) =>
    msg.text.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return filtered.slice(0, options?.limit || 50);
}
