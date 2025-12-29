import { db, schema } from '../db/index.js';
import { desc, gte, and, lte } from 'drizzle-orm';
import { startOfDay, endOfDay, subDays, format } from 'date-fns';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { sendDirectMessage } from '../integrations/slack/client.js';
import {
  createPodcast,
  waitForPodcastCompletion,
  isAutoContentConfigured,
} from '../integrations/autocontent/index.js';
import { chat } from '../assistant/claude.js';

export interface DailyPodcastResult {
  success: boolean;
  audioUrl?: string;
  transcript?: string;
  error?: string;
  messageCount: number;
}

/**
 * Get all Slack messages for a specific date
 */
export async function getMessagesForDate(date: Date): Promise<typeof schema.slackMessages.$inferSelect[]> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const messages = await db
    .select()
    .from(schema.slackMessages)
    .where(
      and(
        gte(schema.slackMessages.createdAt, dayStart),
        lte(schema.slackMessages.createdAt, dayEnd)
      )
    )
    .orderBy(schema.slackMessages.createdAt);

  return messages;
}

/**
 * Format Slack messages into a readable summary for podcast generation
 */
export async function formatMessagesForPodcast(
  messages: typeof schema.slackMessages.$inferSelect[]
): Promise<string> {
  if (messages.length === 0) {
    return 'No messages were recorded today.';
  }

  // Group messages by channel
  const messagesByChannel = new Map<string, typeof messages>();
  for (const msg of messages) {
    const channelName = msg.channelName || 'Unknown Channel';
    if (!messagesByChannel.has(channelName)) {
      messagesByChannel.set(channelName, []);
    }
    messagesByChannel.get(channelName)!.push(msg);
  }

  // Format into readable text
  let formattedText = `Daily Slack Summary - ${format(new Date(), 'MMMM d, yyyy')}\n\n`;
  formattedText += `Total messages: ${messages.length}\n`;
  formattedText += `Channels active: ${messagesByChannel.size}\n\n`;

  for (const [channelName, channelMessages] of messagesByChannel) {
    formattedText += `=== ${channelName} (${channelMessages.length} messages) ===\n\n`;

    for (const msg of channelMessages) {
      const userName = msg.userName || 'Unknown';
      const text = msg.text.replace(/\n/g, ' ').slice(0, 500); // Truncate long messages
      formattedText += `${userName}: ${text}\n\n`;
    }
  }

  return formattedText;
}

/**
 * Use Claude to create a summary/script for the podcast
 */
export async function createPodcastScript(messagesText: string): Promise<string> {
  const systemPrompt = `You are creating a script for a daily workplace podcast summarizing Slack communications for a CEO.
Your task is to:
1. Identify the most important discussions and decisions
2. Highlight any action items or deadlines mentioned
3. Note team dynamics and collaboration
4. Flag any concerns or issues that arose
5. Celebrate wins and positive developments

Create an engaging narrative that the CEO can listen to while commuting.
Keep it professional but conversational.
Focus on strategic relevance - what does the CEO need to know?
Aim for about 3-5 minutes of content when read aloud.`;

  const response = await chat(
    systemPrompt,
    [
      {
        role: 'user',
        content: `Please create a podcast script summarizing today's Slack communications:\n\n${messagesText}`,
      },
    ],
    { maxTokens: 4096, temperature: 0.7 }
  );

  return response.content;
}

/**
 * Generate a daily podcast from Slack messages
 */
export async function generateDailyPodcast(
  date: Date = new Date()
): Promise<DailyPodcastResult> {
  logger.info('Starting daily podcast generation', { date: date.toISOString() });

  // Check if AutoContent API is configured
  if (!isAutoContentConfigured()) {
    return {
      success: false,
      error: 'AutoContent API is not configured. Set AUTOCONTENT_API_KEY environment variable.',
      messageCount: 0,
    };
  }

  try {
    // Get messages for the day
    const messages = await getMessagesForDate(date);

    if (messages.length === 0) {
      logger.info('No messages found for podcast generation');
      return {
        success: false,
        error: 'No Slack messages found for today.',
        messageCount: 0,
      };
    }

    logger.info('Retrieved messages for podcast', { count: messages.length });

    // Format messages
    const formattedMessages = await formatMessagesForPodcast(messages);

    // Create podcast script using Claude
    logger.info('Creating podcast script with Claude');
    const podcastScript = await createPodcastScript(formattedMessages);

    // Generate podcast audio using AutoContent API
    logger.info('Sending to AutoContent API for audio generation');
    const createResponse = await createPodcast(
      podcastScript,
      'Create an engaging podcast episode with two hosts discussing this workplace summary. Make it informative yet conversational, like a morning briefing show for executives.'
    );

    // Wait for podcast to complete (this may take several minutes)
    const requestId = createResponse.request_id || createResponse.contentId;
    if (!requestId) {
      throw new Error('No request ID returned from AutoContent API');
    }
    logger.info('Waiting for podcast generation to complete', { requestId });
    const statusResponse = await waitForPodcastCompletion(requestId);

    return {
      success: true,
      audioUrl: statusResponse.audio_url,
      transcript: statusResponse.transcript,
      messageCount: messages.length,
    };
  } catch (error) {
    logger.error('Daily podcast generation failed', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      messageCount: 0,
    };
  }
}

/**
 * Generate and send daily podcast to CEO
 */
export async function sendDailyPodcastToCEO(): Promise<void> {
  logger.info('Generating and sending daily podcast to CEO');

  const result = await generateDailyPodcast();

  let message: string;

  if (result.success && result.audioUrl) {
    message = `🎙️ *Your Daily Slack Podcast is Ready!*\n\n` +
      `I've summarized today's ${result.messageCount} Slack messages into a podcast for you.\n\n` +
      `🎧 *Listen here:* ${result.audioUrl}\n\n` +
      `This covers the key discussions, decisions, and updates from across your team today.`;
  } else {
    message = `📝 *Daily Podcast Update*\n\n` +
      `I wasn't able to generate today's podcast.\n` +
      `Reason: ${result.error}\n\n` +
      `I'll try again tomorrow, or you can ask me to "create a podcast" manually.`;
  }

  try {
    await sendDirectMessage(config.ceoSlackUserId, message);
    logger.info('Daily podcast notification sent to CEO');
  } catch (error) {
    logger.error('Failed to send podcast notification to CEO', { error });
  }
}

/**
 * Generate podcast for yesterday's messages
 */
export async function generateYesterdaysPodcast(): Promise<DailyPodcastResult> {
  const yesterday = subDays(new Date(), 1);
  return generateDailyPodcast(yesterday);
}
