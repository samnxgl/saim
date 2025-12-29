import { db, schema } from '../db/index.js';
import { eq, desc, and, gte } from 'drizzle-orm';
import { getLatestStrategicPlan } from '../integrations/google/docs.js';
import { getLatestFinancialData } from '../integrations/google/sheets.js';
import { subDays } from 'date-fns';
import { logger } from '../utils/logger.js';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export async function getOrCreateConversationContext(
  userId: string,
  channelId: string
): Promise<{
  id: string;
  messages: ConversationMessage[];
}> {
  const [existing] = await db
    .select()
    .from(schema.conversationContexts)
    .where(
      and(
        eq(schema.conversationContexts.userId, userId),
        eq(schema.conversationContexts.channelId, channelId)
      )
    )
    .limit(1);

  if (existing) {
    return {
      id: existing.id,
      messages: existing.messages as ConversationMessage[],
    };
  }

  const [created] = await db
    .insert(schema.conversationContexts)
    .values({
      userId,
      channelId,
      messages: [],
    })
    .returning();

  return {
    id: created.id,
    messages: [],
  };
}

export async function updateConversationContext(
  contextId: string,
  newMessages: ConversationMessage[]
): Promise<void> {
  const [existing] = await db
    .select()
    .from(schema.conversationContexts)
    .where(eq(schema.conversationContexts.id, contextId))
    .limit(1);

  if (!existing) {
    return;
  }

  const currentMessages = existing.messages as ConversationMessage[];

  // Keep last 20 messages for context
  const updatedMessages = [...currentMessages, ...newMessages].slice(-20);

  await db
    .update(schema.conversationContexts)
    .set({
      messages: updatedMessages,
      lastActivity: new Date(),
    })
    .where(eq(schema.conversationContexts.id, contextId));
}

export async function buildFullContext(): Promise<{
  strategicPlan: string | null;
  financialSummary: string | null;
  recentPatterns: string[];
  directReports: Array<{ name: string; role: string }>;
}> {
  // Get strategic plan
  const plan = await getLatestStrategicPlan();

  // Get financial data
  const financialData = await getLatestFinancialData();
  let financialSummary: string | null = null;
  if (financialData.length > 0) {
    financialSummary = financialData
      .map((f) => `${f.sheetName}: ${JSON.stringify(f.data).slice(0, 500)}`)
      .join('\n');
  }

  // Get recent patterns
  const recentPatterns = await db
    .select()
    .from(schema.communicationPatterns)
    .where(eq(schema.communicationPatterns.isAddressed, false))
    .orderBy(desc(schema.communicationPatterns.detectedAt))
    .limit(5);

  // Get direct reports
  const directReports = await db.select().from(schema.directReports);

  return {
    strategicPlan: plan?.content || null,
    financialSummary,
    recentPatterns: recentPatterns.map((p) => p.description),
    directReports: directReports.map((dr) => ({
      name: dr.name,
      role: dr.role,
    })),
  };
}

export async function getRecentMessagesForContext(
  userId?: string,
  limit: number = 50
): Promise<Array<{ userName: string; text: string; channelName: string }>> {
  const sevenDaysAgo = subDays(new Date(), 7);

  let messages = await db
    .select()
    .from(schema.slackMessages)
    .orderBy(desc(schema.slackMessages.createdAt))
    .limit(limit);

  return messages.map((m) => ({
    userName: m.userName || 'Unknown',
    text: m.text,
    channelName: m.channelName || 'Unknown',
  }));
}

export async function getDirectReportContext(
  directReportId: string
): Promise<{
  name: string;
  role: string;
  recentMessages: string[];
  hrDocuments: string[];
} | null> {
  const [directReport] = await db
    .select()
    .from(schema.directReports)
    .where(eq(schema.directReports.id, directReportId))
    .limit(1);

  if (!directReport) {
    return null;
  }

  // Get recent messages from this person
  const messages = await db
    .select()
    .from(schema.slackMessages)
    .where(eq(schema.slackMessages.userId, directReport.slackUserId))
    .orderBy(desc(schema.slackMessages.createdAt))
    .limit(20);

  // Get HR documents
  const hrDocs = await db
    .select()
    .from(schema.hrDocuments)
    .where(eq(schema.hrDocuments.directReportId, directReport.id));

  return {
    name: directReport.name,
    role: directReport.role,
    recentMessages: messages.map((m) => m.text),
    hrDocuments: hrDocs.map((d) => d.content || '').filter(Boolean),
  };
}

export async function findDirectReportByName(
  name: string
): Promise<typeof schema.directReports.$inferSelect | null> {
  const directReports = await db.select().from(schema.directReports);

  // Fuzzy match on name
  const lowerName = name.toLowerCase();
  const match = directReports.find(
    (dr) =>
      dr.name.toLowerCase().includes(lowerName) ||
      lowerName.includes(dr.name.toLowerCase().split(' ')[0])
  );

  return match || null;
}
