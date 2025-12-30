import { App, SayFn, GenericMessageEvent } from '@slack/bolt';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { processMessage, processDelegatedTaskResponse } from '../../assistant/index.js';
import { db, schema } from '../../db/index.js';
import { eq, and, desc } from 'drizzle-orm';

// Track threads where Saim is active (in-memory for simplicity)
const activeThreads = new Set<string>();

export function registerSlackHandlers(app: App): void {
  // Handle direct mentions
  app.event('app_mention', async ({ event, say }) => {
    const userId = event.user;
    if (!userId) {
      logger.warn('Received app_mention without user');
      return;
    }

    logger.info('Received app mention', { user: userId, channel: event.channel });

    // Track this thread as active
    const threadKey = `${event.channel}:${event.thread_ts || event.ts}`;
    activeThreads.add(threadKey);

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

  // Handle all messages (DMs and thread replies)
  app.message(async ({ message, say, context }) => {
    // Type guard for generic messages (not subtyped)
    const msg = message as GenericMessageEvent;

    // Ignore bot messages (including our own)
    if ('bot_id' in message || 'subtype' in message) {
      return;
    }

    const userId = msg.user;
    const text = msg.text || '';
    const ts = msg.ts;
    const threadTs = msg.thread_ts;

    if (!userId || !text) {
      return;
    }

    // Check if this is a DM
    const isDM = msg.channel.startsWith('D');

    // Check if this is a reply in an active thread
    const threadKey = threadTs ? `${msg.channel}:${threadTs}` : null;
    const isActiveThread = threadKey && activeThreads.has(threadKey);

    // Only respond to DMs or active thread replies
    if (!isDM && !isActiveThread) {
      return;
    }

    logger.info('Received message', {
      user: userId,
      channel: msg.channel,
      isDM,
      isActiveThread,
      threadTs
    });

    try {
      const isCEO = userId === config.ceoSlackUserId;

      // Check if this is a response to a delegated task (for non-CEO DMs)
      if (!isCEO && isDM) {
        const { pendingTask, isDirectReport } = await checkForPendingTask(userId);
        if (pendingTask) {
          logger.info('Found pending task for direct report', { taskId: pendingTask.id, userId });
          await handleDelegatedTaskResponse(pendingTask, text, userId, say, ts);
          return;
        }

        // If they're a direct report but no pending task, respond simply without loading old context
        if (isDirectReport) {
          logger.info('Direct report message but no pending task', { userId });
          await say({
            text: "Hi! I don't have any active tasks to discuss with you at the moment. If Sam needs something, I'll reach out.",
            thread_ts: threadTs || ts,
          });
          return;
        }
      }

      const response = await processMessage({
        text,
        userId,
        channelId: msg.channel,
        threadTs: threadTs || ts,
        isCEO,
      });

      await say({
        text: response,
        thread_ts: threadTs || ts,
      });
    } catch (error) {
      logger.error('Error handling message', { error });
      await say({
        text: "I encountered an error processing your message. Please try again.",
        thread_ts: threadTs || ts,
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
): Promise<{ pendingTask: typeof schema.delegatedTasks.$inferSelect | null; isDirectReport: boolean }> {
  const directReport = await db
    .select()
    .from(schema.directReports)
    .where(eq(schema.directReports.slackUserId, userId))
    .limit(1);

  if (directReport.length === 0) {
    return { pendingTask: null, isDirectReport: false };
  }

  // Get the most recent in-progress task (ordered by creation date)
  const [pendingTask] = await db
    .select()
    .from(schema.delegatedTasks)
    .where(
      and(
        eq(schema.delegatedTasks.directReportId, directReport[0].id),
        eq(schema.delegatedTasks.status, 'in_progress')
      )
    )
    .orderBy(desc(schema.delegatedTasks.createdAt))
    .limit(1);

  return { pendingTask: pendingTask || null, isDirectReport: true };
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
