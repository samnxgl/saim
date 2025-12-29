import { App, SayFn, GenericMessageEvent } from '@slack/bolt';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { processMessage, processDelegatedTaskResponse } from '../../assistant/index.js';
import { db, schema } from '../../db/index.js';
import { eq, and } from 'drizzle-orm';

export function registerSlackHandlers(app: App): void {
  // Handle direct mentions
  app.event('app_mention', async ({ event, say }) => {
    const userId = event.user;
    if (!userId) {
      logger.warn('Received app_mention without user');
      return;
    }

    logger.info('Received app mention', { user: userId, channel: event.channel });

    try {
      const response = await processMessage({
        text: event.text,
        userId,
        channelId: event.channel,
        threadTs: event.thread_ts || event.ts,
        isCEO: userId === config.ceoSlackUserId,
      });

      await say({
        text: response,
        thread_ts: event.thread_ts || event.ts,
      });
    } catch (error) {
      logger.error('Error handling app mention', { error });
      await say({
        text: "I encountered an error processing your request. Please try again.",
        thread_ts: event.thread_ts || event.ts,
      });
    }
  });

  // Handle direct messages
  app.message(async ({ message, say }) => {
    // Type guard for generic messages (not subtyped)
    const msg = message as GenericMessageEvent;

    // Ignore bot messages
    if ('bot_id' in message || 'subtype' in message) {
      return;
    }

    // Only process DMs (channels starting with D)
    if (!msg.channel.startsWith('D')) {
      return;
    }

    const userId = msg.user;
    const text = msg.text || '';
    const ts = msg.ts;

    if (!userId || !text) {
      return;
    }

    logger.info('Received DM', { user: userId, channel: msg.channel });

    try {
      const isCEO = userId === config.ceoSlackUserId;

      // Check if this is a response to a delegated task
      if (!isCEO) {
        const pendingTask = await checkForPendingTask(userId);
        if (pendingTask) {
          await handleDelegatedTaskResponse(pendingTask, text, userId, say, ts);
          return;
        }
      }

      const response = await processMessage({
        text,
        userId,
        channelId: msg.channel,
        threadTs: ts,
        isCEO,
      });

      await say({
        text: response,
        thread_ts: ts,
      });
    } catch (error) {
      logger.error('Error handling DM', { error });
      await say({
        text: "I encountered an error processing your message. Please try again.",
      });
    }
  });

  // Handle slash command for quick actions
  app.command('/saim', async ({ command, ack, respond }) => {
    await ack();

    logger.info('Received slash command', { user: command.user_id, text: command.text });

    try {
      const response = await processMessage({
        text: command.text,
        userId: command.user_id,
        channelId: command.channel_id,
        isCEO: command.user_id === config.ceoSlackUserId,
        isSlashCommand: true,
      });

      await respond({
        text: response,
        response_type: 'ephemeral',
      });
    } catch (error) {
      logger.error('Error handling slash command', { error });
      await respond({
        text: "I encountered an error processing your command. Please try again.",
        response_type: 'ephemeral',
      });
    }
  });

  // Handle button interactions
  app.action(/^saim_action_/, async ({ ack, body, action, respond }) => {
    await ack();

    const actionId = 'action_id' in action ? action.action_id : '';
    const userId = body.user.id;

    logger.info('Received button action', { actionId, userId });

    try {
      const response = await handleButtonAction(actionId, userId);
      await respond({
        text: response,
        replace_original: false,
      });
    } catch (error) {
      logger.error('Error handling button action', { error });
      await respond({
        text: "I encountered an error processing your action. Please try again.",
      });
    }
  });

  logger.info('Slack handlers registered');
}

async function checkForPendingTask(
  userId: string
): Promise<typeof schema.delegatedTasks.$inferSelect | null> {
  const directReport = await db
    .select()
    .from(schema.directReports)
    .where(eq(schema.directReports.slackUserId, userId))
    .limit(1);

  if (directReport.length === 0) {
    return null;
  }

  const [pendingTask] = await db
    .select()
    .from(schema.delegatedTasks)
    .where(
      and(
        eq(schema.delegatedTasks.directReportId, directReport[0].id),
        eq(schema.delegatedTasks.status, 'in_progress')
      )
    )
    .limit(1);

  return pendingTask || null;
}

async function handleDelegatedTaskResponse(
  task: typeof schema.delegatedTasks.$inferSelect,
  message: string,
  userId: string,
  say: SayFn,
  threadTs?: string
): Promise<void> {
  const response = await processDelegatedTaskResponse(task, message, userId);

  await say({
    text: response.message,
    thread_ts: threadTs,
  });

  if (response.completed) {
    logger.info('Delegated task completed', { taskId: task.id });
  }
}

async function handleButtonAction(
  actionId: string,
  _userId: string
): Promise<string> {
  // Handle various button actions
  const [, action] = actionId.split('_');

  switch (action) {
    case 'confirm':
      return 'Action confirmed.';
    case 'cancel':
      return 'Action cancelled.';
    case 'details':
      return 'Fetching details...';
    default:
      return 'Unknown action.';
  }
}
