import { db, schema } from '../db/index.js';
import { desc, gte, and, lte } from 'drizzle-orm';
import { startOfDay, endOfDay, subDays, format } from 'date-fns';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import {
  sendDirectMessage,
  getMessage,
  getThreadMessages,
  getFileInfo,
  downloadFileContent,
  getConversationHistory,
  findChannelByName,
  getChannelInfo,
} from '../integrations/slack/client.js';
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
 * Get all Slack messages for a specific date (using actual Slack message timestamp)
 */
export async function getMessagesForDate(date: Date): Promise<typeof schema.slackMessages.$inferSelect[]> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const messages = await db
    .select()
    .from(schema.slackMessages)
    .where(
      and(
        gte(schema.slackMessages.slackCreatedAt, dayStart),
        lte(schema.slackMessages.slackCreatedAt, dayEnd)
      )
    )
    .orderBy(schema.slackMessages.slackCreatedAt);

  return messages;
}

/**
 * Format Slack messages into a readable summary for podcast generation
 */
export async function formatMessagesForPodcast(
  messages: typeof schema.slackMessages.$inferSelect[],
  date: Date = new Date()
): Promise<string> {
  if (messages.length === 0) {
    return 'No messages were recorded for this day.';
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
  let formattedText = `Daily Slack Summary - ${format(date, 'MMMM d, yyyy')}\n\n`;
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

    // Format messages (pass date for accurate header)
    const formattedMessages = await formatMessagesForPodcast(messages, date);

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

/**
 * Extract file content from a Slack message
 */
async function extractFileContent(files: any[]): Promise<string> {
  if (!files || files.length === 0) return '';

  const fileContents: string[] = [];

  for (const file of files) {
    try {
      const fileInfo = await getFileInfo(file.id);
      if (!fileInfo) continue;

      let content = `\n[Attachment: ${fileInfo.name || 'unnamed file'}]\n`;

      // Try to get file content if it's text-based
      if (fileInfo.url_private_download) {
        const textContent = await downloadFileContent(fileInfo.url_private_download);
        if (textContent && !textContent.startsWith('[Binary file')) {
          content += textContent.slice(0, 10000); // Limit content size
        } else {
          content += `File type: ${fileInfo.filetype || 'unknown'}, Size: ${fileInfo.size || 'unknown'} bytes`;
        }
      } else if (fileInfo.preview) {
        content += fileInfo.preview;
      }

      fileContents.push(content);
    } catch (error) {
      logger.error('Error extracting file content', { fileId: file.id, error });
    }
  }

  return fileContents.join('\n');
}

/**
 * Format a single Slack message with its attachments
 */
async function formatMessageWithAttachments(message: any, channelName?: string): Promise<string> {
  let text = message.text || '';

  // Extract file content if present
  if (message.files && message.files.length > 0) {
    const fileContent = await extractFileContent(message.files);
    text += fileContent;
  }

  // Handle Slack attachments (legacy format)
  if (message.attachments && message.attachments.length > 0) {
    for (const attachment of message.attachments) {
      if (attachment.text) {
        text += `\n[Attachment]: ${attachment.text}`;
      }
      if (attachment.pretext) {
        text += `\n${attachment.pretext}`;
      }
    }
  }

  const userName = message.user_profile?.display_name || message.user || 'Unknown';
  const channel = channelName ? `#${channelName}` : '';

  return `${channel ? channel + ' - ' : ''}${userName}: ${text}`;
}

export interface CustomPodcastResult {
  success: boolean;
  audioUrl?: string;
  transcript?: string;
  error?: string;
  sourceDescription: string;
}

/**
 * Generate a podcast from a single Slack message (with thread and attachments)
 */
export async function generatePodcastFromMessage(
  channelId: string,
  messageTs: string,
  customInstructions?: string
): Promise<CustomPodcastResult> {
  logger.info('Generating podcast from single message', { channelId, messageTs });

  if (!isAutoContentConfigured()) {
    return {
      success: false,
      error: 'AutoContent API is not configured.',
      sourceDescription: 'single message',
    };
  }

  try {
    // Get the main message
    const mainMessage = await getMessage(channelId, messageTs);
    if (!mainMessage) {
      return {
        success: false,
        error: 'Could not find the specified message.',
        sourceDescription: 'single message',
      };
    }

    // Get channel info for context
    const channelInfo = await getChannelInfo(channelId);
    const channelName = (channelInfo as any)?.name || 'unknown-channel';

    // Format the main message
    let content = await formatMessageWithAttachments(mainMessage, channelName);

    // Get thread replies if this is a thread parent
    if (mainMessage.thread_ts === mainMessage.ts || mainMessage.reply_count) {
      const threadMessages = await getThreadMessages(channelId, mainMessage.ts as string);
      for (const threadMsg of threadMessages) {
        if (threadMsg.ts !== mainMessage.ts) {
          const formatted = await formatMessageWithAttachments(threadMsg);
          content += `\n\nReply: ${formatted}`;
        }
      }
    }

    logger.info('Message content extracted', { contentLength: content.length });

    // Create podcast script
    const scriptPrompt = customInstructions ||
      'Create an informative podcast episode discussing this message and its context. Focus on the key points and any decisions or actions mentioned.';

    const podcastScript = await chat(
      `You are creating a podcast script from a specific Slack message. ${scriptPrompt}`,
      [{ role: 'user', content: `Create a podcast script from this message:\n\n${content}` }],
      { maxTokens: 4096, temperature: 0.7 }
    );

    // Generate audio
    const createResponse = await createPodcast(
      podcastScript.content,
      customInstructions ||
        'Create an engaging podcast episode with two hosts discussing this content. Make it informative yet conversational.'
    );

    const requestId = createResponse.request_id || createResponse.contentId;
    if (!requestId) {
      throw new Error('No request ID returned from AutoContent API');
    }

    const statusResponse = await waitForPodcastCompletion(requestId);

    return {
      success: true,
      audioUrl: statusResponse.audio_url,
      transcript: statusResponse.transcript,
      sourceDescription: `message from #${channelName}`,
    };
  } catch (error) {
    logger.error('Failed to generate podcast from message', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      sourceDescription: 'single message',
    };
  }
}

/**
 * Generate a podcast from messages in a specific channel
 */
export async function generatePodcastFromChannel(
  channelIdentifier: string, // Can be channel ID or name
  options: {
    customInstructions?: string;
    messageCount?: number;
    startTime?: Date;
    endTime?: Date;
  } = {}
): Promise<CustomPodcastResult> {
  logger.info('Generating podcast from channel', { channelIdentifier, options });

  if (!isAutoContentConfigured()) {
    return {
      success: false,
      error: 'AutoContent API is not configured.',
      sourceDescription: `channel ${channelIdentifier}`,
    };
  }

  try {
    // Resolve channel ID if name was provided
    let channelId = channelIdentifier;
    let channelName = channelIdentifier;

    if (!channelIdentifier.startsWith('C') && !channelIdentifier.startsWith('D')) {
      const foundChannelId = await findChannelByName(channelIdentifier);
      if (!foundChannelId) {
        return {
          success: false,
          error: `Could not find channel "${channelIdentifier}".`,
          sourceDescription: `channel ${channelIdentifier}`,
        };
      }
      channelId = foundChannelId;
      channelName = channelIdentifier.replace(/^#/, '');
    } else {
      const channelInfo = await getChannelInfo(channelId);
      channelName = (channelInfo as any)?.name || channelId;
    }

    // Build time filters
    const oldest = options.startTime
      ? (options.startTime.getTime() / 1000).toString()
      : undefined;
    const latest = options.endTime
      ? (options.endTime.getTime() / 1000).toString()
      : undefined;

    // Get messages from channel
    const messages = await getConversationHistory(channelId, {
      limit: options.messageCount || 50,
      oldest,
      latest,
    });

    if (messages.length === 0) {
      return {
        success: false,
        error: 'No messages found in the specified channel/timeframe.',
        sourceDescription: `#${channelName}`,
      };
    }

    // Format all messages with attachments
    const formattedMessages: string[] = [];
    for (const msg of messages.reverse()) {
      const formatted = await formatMessageWithAttachments(msg as any);
      formattedMessages.push(formatted);
    }

    const content = `Channel: #${channelName}\nMessages: ${messages.length}\n\n${formattedMessages.join('\n\n')}`;

    logger.info('Channel content extracted', {
      channelName,
      messageCount: messages.length,
      contentLength: content.length,
    });

    // Create podcast script
    const scriptPrompt = options.customInstructions ||
      `Create an engaging podcast summarizing the discussions in #${channelName}. Highlight key topics, decisions, and action items.`;

    const podcastScript = await chat(
      `You are creating a podcast script from Slack channel messages. ${scriptPrompt}`,
      [{ role: 'user', content: `Create a podcast script from these messages:\n\n${content}` }],
      { maxTokens: 4096, temperature: 0.7 }
    );

    // Generate audio
    const createResponse = await createPodcast(
      podcastScript.content,
      options.customInstructions ||
        'Create an engaging podcast episode with two hosts discussing this content. Make it informative yet conversational, like a team standup summary.'
    );

    const requestId = createResponse.request_id || createResponse.contentId;
    if (!requestId) {
      throw new Error('No request ID returned from AutoContent API');
    }

    const statusResponse = await waitForPodcastCompletion(requestId);

    return {
      success: true,
      audioUrl: statusResponse.audio_url,
      transcript: statusResponse.transcript,
      sourceDescription: `#${channelName} (${messages.length} messages)`,
    };
  } catch (error) {
    logger.error('Failed to generate podcast from channel', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      sourceDescription: `channel ${channelIdentifier}`,
    };
  }
}

/**
 * Parse a Slack message link to extract channel ID and message timestamp
 * Formats: https://workspace.slack.com/archives/C123/p1234567890123456
 */
export function parseSlackMessageLink(link: string): { channelId: string; messageTs: string } | null {
  try {
    // Match Slack message URL pattern
    const match = link.match(/archives\/([A-Z0-9]+)\/p(\d+)/i);
    if (!match) return null;

    const channelId = match[1];
    // Convert Slack's p-format timestamp to standard format (add decimal point)
    const rawTs = match[2];
    const messageTs = rawTs.slice(0, 10) + '.' + rawTs.slice(10);

    return { channelId, messageTs };
  } catch {
    return null;
  }
}
