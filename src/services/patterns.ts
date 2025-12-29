import { db, schema } from '../db/index.js';
import { desc, gte } from 'drizzle-orm';
import { subDays } from 'date-fns';
import { analyzeText, chat } from '../assistant/claude.js';
import { getSystemPrompt } from '../assistant/prompts.js';
import { logger } from '../utils/logger.js';
import { sendDirectMessage } from '../integrations/slack/client.js';
import { config } from '../config/index.js';

export interface DetectedPattern {
  type: 'topic' | 'sentiment' | 'urgency' | 'values_alignment';
  description: string;
  relevantMessages: string[];
  recommendedAction?: string;
  relatedValue?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export async function analyzeRecentCommunications(): Promise<DetectedPattern[]> {
  logger.info('Starting communication pattern analysis');

  const sevenDaysAgo = subDays(new Date(), 7);

  // Get recent messages
  const recentMessages = await db
    .select()
    .from(schema.slackMessages)
    .where(gte(schema.slackMessages.createdAt, sevenDaysAgo))
    .orderBy(desc(schema.slackMessages.createdAt))
    .limit(500);

  if (recentMessages.length < 10) {
    logger.info('Not enough messages for pattern analysis');
    return [];
  }

  // Group messages by channel for topic analysis
  const messagesByChannel = new Map<string, typeof recentMessages>();
  for (const msg of recentMessages) {
    const channelId = msg.channelId;
    if (!messagesByChannel.has(channelId)) {
      messagesByChannel.set(channelId, []);
    }
    messagesByChannel.get(channelId)!.push(msg);
  }

  const patterns: DetectedPattern[] = [];

  // Analyze for topics and themes
  const allText = recentMessages.map((m) => `[${m.userName}]: ${m.text}`).join('\n');

  try {
    const topicAnalysis = await analyzeTopicsAndPatterns(allText);
    patterns.push(...topicAnalysis);
  } catch (error) {
    logger.error('Topic analysis failed', { error });
  }

  // Analyze for sentiment trends
  try {
    const sentimentPatterns = await analyzeSentimentTrends(recentMessages);
    patterns.push(...sentimentPatterns);
  } catch (error) {
    logger.error('Sentiment analysis failed', { error });
  }

  // Analyze for values alignment
  try {
    const valuesPatterns = await analyzeValuesAlignment(allText);
    patterns.push(...valuesPatterns);
  } catch (error) {
    logger.error('Values alignment analysis failed', { error });
  }

  // Store detected patterns
  for (const pattern of patterns) {
    await db.insert(schema.communicationPatterns).values({
      type: pattern.type,
      description: pattern.description,
      relevantMessageIds: pattern.relevantMessages,
      recommendedAction: pattern.recommendedAction,
      relatedValue: pattern.relatedValue,
    });
  }

  logger.info('Pattern analysis complete', { patternsFound: patterns.length });

  return patterns;
}

async function analyzeTopicsAndPatterns(text: string): Promise<DetectedPattern[]> {
  const systemPrompt = `You are analyzing workplace communications to identify patterns and trends.
Identify:
1. Recurring topics or themes (what is the team talking about most?)
2. Potential blockers or concerns being mentioned
3. Positive developments or wins being shared
4. Questions or confusion that keeps coming up

Respond with a JSON array of patterns, each with:
- type: "topic"
- description: brief description of the pattern
- priority: "low" | "medium" | "high" | "urgent"
- recommendedAction: what the CEO should consider doing

Only return significant patterns, not every topic. Maximum 5 patterns.`;

  const response = await chat(
    systemPrompt,
    [{ role: 'user', content: text.slice(0, 15000) }], // Limit text size
    { temperature: 0.3 }
  );

  try {
    const parsed = JSON.parse(response.content);
    return Array.isArray(parsed)
      ? parsed.map((p: any) => ({
          type: 'topic' as const,
          description: p.description || 'Unnamed pattern',
          relevantMessages: [],
          recommendedAction: p.recommendedAction,
          priority: p.priority || 'medium',
        }))
      : [];
  } catch {
    logger.warn('Failed to parse topic analysis response');
    return [];
  }
}

async function analyzeSentimentTrends(
  messages: typeof schema.slackMessages.$inferSelect[]
): Promise<DetectedPattern[]> {
  // Group messages by user to detect individual sentiment trends
  const messagesByUser = new Map<string, string[]>();
  for (const msg of messages) {
    const userName = msg.userName || msg.userId;
    if (!messagesByUser.has(userName)) {
      messagesByUser.set(userName, []);
    }
    messagesByUser.get(userName)!.push(msg.text);
  }

  const patterns: DetectedPattern[] = [];

  // Analyze overall team sentiment
  const allText = messages.map((m) => m.text).join('\n');

  const systemPrompt = `Analyze the overall sentiment and morale indicators in these team communications.
Look for:
- Signs of stress, frustration, or burnout
- Positive energy, excitement, or motivation
- Changes in communication tone
- Team cohesion indicators

Respond with a JSON object:
{
  "overallSentiment": "positive" | "neutral" | "negative" | "mixed",
  "concerns": ["array of specific concerns if any"],
  "positives": ["array of positive indicators"],
  "recommendedAction": "what the CEO should consider",
  "priority": "low" | "medium" | "high" | "urgent"
}`;

  try {
    const response = await chat(
      systemPrompt,
      [{ role: 'user', content: allText.slice(0, 10000) }],
      { temperature: 0.3 }
    );

    const parsed = JSON.parse(response.content);

    if (parsed.concerns && parsed.concerns.length > 0) {
      patterns.push({
        type: 'sentiment',
        description: `Team sentiment: ${parsed.overallSentiment}. Concerns: ${parsed.concerns.join(', ')}`,
        relevantMessages: [],
        recommendedAction: parsed.recommendedAction,
        priority: parsed.priority || 'medium',
      });
    }

    if (parsed.positives && parsed.positives.length > 0 && parsed.overallSentiment === 'positive') {
      patterns.push({
        type: 'sentiment',
        description: `Positive team indicators: ${parsed.positives.join(', ')}`,
        relevantMessages: [],
        recommendedAction: 'Consider acknowledging these positive developments',
        priority: 'low',
      });
    }
  } catch (error) {
    logger.warn('Failed to parse sentiment analysis', { error });
  }

  return patterns;
}

async function analyzeValuesAlignment(text: string): Promise<DetectedPattern[]> {
  // Get company values
  const values = await db.select().from(schema.companyValues);

  if (values.length === 0) {
    return [];
  }

  const valuesContext = values
    .map((v) => `${v.name}: ${v.description}. Keywords: ${(v.keywords as string[]).join(', ')}`)
    .join('\n');

  const systemPrompt = `Given these company values:
${valuesContext}

Analyze the communications and identify:
1. Moments where values are being exemplified (celebrate these)
2. Moments where values might be slipping (address these)
3. Opportunities to reinforce specific values

Respond with a JSON array of observations:
[{
  "type": "exemplified" | "opportunity" | "concern",
  "value": "the value name",
  "description": "what you observed",
  "recommendedAction": "what to do",
  "priority": "low" | "medium" | "high"
}]

Maximum 5 observations.`;

  try {
    const response = await chat(
      systemPrompt,
      [{ role: 'user', content: text.slice(0, 12000) }],
      { temperature: 0.4 }
    );

    const parsed = JSON.parse(response.content);
    return Array.isArray(parsed)
      ? parsed.map((p: any) => ({
          type: 'values_alignment' as const,
          description: `${p.type}: ${p.description}`,
          relevantMessages: [],
          recommendedAction: p.recommendedAction,
          relatedValue: p.value,
          priority: p.priority || 'medium',
        }))
      : [];
  } catch (error) {
    logger.warn('Failed to parse values alignment analysis', { error });
    return [];
  }
}

export async function generateCEOBriefing(): Promise<string> {
  // Get recent unaddressed patterns
  const patterns = await db
    .select()
    .from(schema.communicationPatterns)
    .where(gte(schema.communicationPatterns.detectedAt, subDays(new Date(), 7)))
    .orderBy(desc(schema.communicationPatterns.detectedAt))
    .limit(10);

  if (patterns.length === 0) {
    return "No significant patterns detected in recent communications.";
  }

  const patternSummary = patterns
    .map((p) => `- [${p.type}] ${p.description}${p.recommendedAction ? ` → ${p.recommendedAction}` : ''}`)
    .join('\n');

  const systemPrompt = getSystemPrompt('ceo');

  const response = await chat(
    systemPrompt,
    [
      {
        role: 'user',
        content: `Based on recent communication analysis, prepare a brief executive summary for me. Here are the detected patterns:\n\n${patternSummary}\n\nProvide a concise briefing with prioritized action items.`,
      },
    ],
    { temperature: 0.5 }
  );

  return response.content;
}

export async function sendDailyBriefing(): Promise<void> {
  logger.info('Generating and sending daily briefing');

  try {
    // Run pattern analysis first
    await analyzeRecentCommunications();

    // Generate briefing
    const briefing = await generateCEOBriefing();

    // Send to CEO via DM
    await sendDirectMessage(config.ceoSlackUserId, `📊 *Daily Briefing*\n\n${briefing}`);

    logger.info('Daily briefing sent');
  } catch (error) {
    logger.error('Failed to send daily briefing', { error });
  }
}
