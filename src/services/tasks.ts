import { db, schema } from '../db/index.js';
import { eq, and, lt } from 'drizzle-orm';
import { subHours } from 'date-fns';
import { logger } from '../utils/logger.js';
import { sendDirectMessage } from '../integrations/slack/client.js';
import { config } from '../config/index.js';

export async function checkPendingTasks(): Promise<void> {
  logger.info('Checking pending delegated tasks');

  // Find tasks that have been in progress for more than 24 hours
  const staleThreshold = subHours(new Date(), 24);

  const staleTasks = await db
    .select({
      task: schema.delegatedTasks,
      directReport: schema.directReports,
    })
    .from(schema.delegatedTasks)
    .innerJoin(
      schema.directReports,
      eq(schema.delegatedTasks.directReportId, schema.directReports.id)
    )
    .where(
      and(
        eq(schema.delegatedTasks.status, 'in_progress'),
        lt(schema.delegatedTasks.createdAt, staleThreshold)
      )
    );

  if (staleTasks.length === 0) {
    logger.info('No stale tasks found');
    return;
  }

  // Notify CEO about stale tasks
  const taskSummaries = staleTasks
    .map(
      ({ task, directReport }) =>
        `• Task for ${directReport.name}: "${task.instruction.slice(0, 100)}..." (started ${formatTimeAgo(task.createdAt)})`
    )
    .join('\n');

  const message = `⏰ *Pending Tasks Alert*\n\nThe following delegated tasks have been awaiting response for over 24 hours:\n\n${taskSummaries}\n\nWould you like me to send a follow-up reminder to these team members?`;

  try {
    await sendDirectMessage(config.ceoSlackUserId, message);
    logger.info('Sent stale tasks notification to CEO');
  } catch (error) {
    logger.error('Failed to notify CEO about stale tasks', { error });
  }
}

export async function getActiveTasksForDirectReport(
  slackUserId: string
): Promise<typeof schema.delegatedTasks.$inferSelect[]> {
  const [directReport] = await db
    .select()
    .from(schema.directReports)
    .where(eq(schema.directReports.slackUserId, slackUserId))
    .limit(1);

  if (!directReport) {
    return [];
  }

  const tasks = await db
    .select()
    .from(schema.delegatedTasks)
    .where(
      and(
        eq(schema.delegatedTasks.directReportId, directReport.id),
        eq(schema.delegatedTasks.status, 'in_progress')
      )
    );

  return tasks;
}

export async function getCompletedTasksSummary(
  limit: number = 10
): Promise<
  Array<{
    instruction: string;
    directReportName: string;
    summary: string | null;
    completedAt: Date | null;
  }>
> {
  const tasks = await db
    .select({
      task: schema.delegatedTasks,
      directReport: schema.directReports,
    })
    .from(schema.delegatedTasks)
    .innerJoin(
      schema.directReports,
      eq(schema.delegatedTasks.directReportId, schema.directReports.id)
    )
    .where(eq(schema.delegatedTasks.status, 'completed'))
    .orderBy(schema.delegatedTasks.completedAt)
    .limit(limit);

  return tasks.map(({ task, directReport }) => ({
    instruction: task.instruction,
    directReportName: directReport.name,
    summary: task.summary,
    completedAt: task.completedAt,
  }));
}

export async function sendTaskReminder(taskId: string): Promise<boolean> {
  const [result] = await db
    .select({
      task: schema.delegatedTasks,
      directReport: schema.directReports,
    })
    .from(schema.delegatedTasks)
    .innerJoin(
      schema.directReports,
      eq(schema.delegatedTasks.directReportId, schema.directReports.id)
    )
    .where(eq(schema.delegatedTasks.id, taskId))
    .limit(1);

  if (!result) {
    return false;
  }

  const { task, directReport } = result;

  const reminderMessage = `Hi ${directReport.name.split(' ')[0]}, just following up on my earlier message regarding: "${task.instruction.slice(0, 150)}..."\n\nPlease let me know when you have a moment to respond. Thank you!`;

  try {
    await sendDirectMessage(directReport.slackUserId, reminderMessage);

    // Update conversation history
    const currentHistory = task.conversationHistory as Array<{
      role: 'saim' | 'direct_report';
      message: string;
      timestamp: string;
    }>;

    await db
      .update(schema.delegatedTasks)
      .set({
        conversationHistory: [
          ...currentHistory,
          {
            role: 'saim' as const,
            message: reminderMessage,
            timestamp: new Date().toISOString(),
          },
        ],
      })
      .where(eq(schema.delegatedTasks.id, taskId));

    logger.info('Task reminder sent', { taskId, directReport: directReport.name });
    return true;
  } catch (error) {
    logger.error('Failed to send task reminder', { error, taskId });
    return false;
  }
}

function formatTimeAgo(date: Date): string {
  const hours = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60));

  if (hours < 24) {
    return `${hours} hours ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}
