import { logger } from '../utils/logger.js';
import {
  findChannelByName,
  getConversationHistory,
  getWebClient,
} from '../integrations/slack/client.js';

const NPS_CHANNEL_NAME = 'notifications-nps';

export interface NPSScore {
  score: number;
  timestamp: string;
  userId?: string;
  text: string;
}

export interface NPSResult {
  nps: number;
  totalResponses: number;
  promoters: number;
  passives: number;
  detractors: number;
  promoterPercentage: number;
  detractorPercentage: number;
  scores: NPSScore[];
  period?: string;
}

/**
 * Extract NPS score from a Slack message text
 * Looks for numbers 0-10 in the message
 */
function extractScoreFromMessage(text: string): number | null {
  // Common patterns for NPS scores in notifications
  // Pattern 1: "Score: 9" or "NPS: 10" or "Rating: 8"
  const labeledMatch = text.match(/(?:score|nps|rating|gave|submitted)[:\s]+(\d+)/i);
  if (labeledMatch) {
    const score = parseInt(labeledMatch[1], 10);
    if (score >= 0 && score <= 10) {
      return score;
    }
  }

  // Pattern 2: Just a number by itself (0-10)
  const standaloneMatch = text.match(/\b(\d+)\b/);
  if (standaloneMatch) {
    const score = parseInt(standaloneMatch[1], 10);
    if (score >= 0 && score <= 10) {
      return score;
    }
  }

  // Pattern 3: Number in emoji or special format like ":10:" or "*9*"
  const specialMatch = text.match(/[:*](\d+)[:*]/);
  if (specialMatch) {
    const score = parseInt(specialMatch[1], 10);
    if (score >= 0 && score <= 10) {
      return score;
    }
  }

  return null;
}

/**
 * Fetch all NPS scores from the notifications-nps channel
 */
export async function fetchAllNPSScores(options?: {
  oldest?: Date;
  latest?: Date;
  limit?: number;
}): Promise<NPSScore[]> {
  const channelId = await findChannelByName(NPS_CHANNEL_NAME);

  if (!channelId) {
    logger.error('NPS channel not found', { channelName: NPS_CHANNEL_NAME });
    throw new Error(`Could not find channel #${NPS_CHANNEL_NAME}`);
  }

  const scores: NPSScore[] = [];
  let cursor: string | undefined;
  const client = getWebClient();
  const maxMessages = options?.limit || 1000;

  // Convert dates to Slack timestamps
  const oldest = options?.oldest
    ? (options.oldest.getTime() / 1000).toString()
    : undefined;
  const latest = options?.latest
    ? (options.latest.getTime() / 1000).toString()
    : undefined;

  try {
    // Paginate through all messages
    do {
      const result = await client.conversations.history({
        channel: channelId,
        limit: Math.min(200, maxMessages - scores.length),
        cursor,
        oldest,
        latest,
      });

      for (const message of result.messages || []) {
        if (!message.text) continue;

        const score = extractScoreFromMessage(message.text);
        if (score !== null) {
          scores.push({
            score,
            timestamp: message.ts || '',
            userId: message.user,
            text: message.text,
          });
        }
      }

      cursor = result.response_metadata?.next_cursor;
    } while (cursor && scores.length < maxMessages);

    logger.info('Fetched NPS scores', {
      channelId,
      totalMessages: scores.length,
    });

    return scores;
  } catch (error) {
    logger.error('Failed to fetch NPS scores', { error });
    throw error;
  }
}

/**
 * Calculate NPS from an array of scores
 * NPS = % Promoters (9-10) - % Detractors (0-6)
 * Passives (7-8) don't affect the score
 */
export function calculateNPS(scores: NPSScore[]): NPSResult {
  if (scores.length === 0) {
    return {
      nps: 0,
      totalResponses: 0,
      promoters: 0,
      passives: 0,
      detractors: 0,
      promoterPercentage: 0,
      detractorPercentage: 0,
      scores: [],
    };
  }

  let promoters = 0;
  let passives = 0;
  let detractors = 0;

  for (const { score } of scores) {
    if (score >= 9) {
      promoters++;
    } else if (score >= 7) {
      passives++;
    } else {
      detractors++;
    }
  }

  const total = scores.length;
  const promoterPercentage = (promoters / total) * 100;
  const detractorPercentage = (detractors / total) * 100;
  const nps = Math.round(promoterPercentage - detractorPercentage);

  return {
    nps,
    totalResponses: total,
    promoters,
    passives,
    detractors,
    promoterPercentage: Math.round(promoterPercentage * 10) / 10,
    detractorPercentage: Math.round(detractorPercentage * 10) / 10,
    scores,
  };
}

/**
 * Get the latest NPS calculation
 */
export async function getLatestNPS(options?: {
  days?: number;
}): Promise<NPSResult> {
  const days = options?.days;
  let oldest: Date | undefined;

  if (days) {
    oldest = new Date();
    oldest.setDate(oldest.getDate() - days);
    oldest.setHours(0, 0, 0, 0);
  }

  const scores = await fetchAllNPSScores({ oldest });
  const result = calculateNPS(scores);

  if (days) {
    result.period = `last ${days} days`;
  } else {
    result.period = 'all time';
  }

  return result;
}

/**
 * Get NPS for yesterday only
 */
export async function getYesterdayNPS(): Promise<NPSResult> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);

  const scores = await fetchAllNPSScores({
    oldest: yesterday,
    latest: endOfYesterday,
  });

  const result = calculateNPS(scores);
  result.period = 'yesterday';

  return result;
}

/**
 * Format NPS result for Slack display
 */
export function formatNPSForSlack(result: NPSResult): string {
  const { nps, totalResponses, promoters, passives, detractors, promoterPercentage, detractorPercentage, period } = result;

  // Determine NPS quality
  let npsQuality: string;
  let emoji: string;
  if (nps >= 70) {
    npsQuality = 'Excellent';
    emoji = '🌟';
  } else if (nps >= 50) {
    npsQuality = 'Great';
    emoji = '✨';
  } else if (nps >= 30) {
    npsQuality = 'Good';
    emoji = '👍';
  } else if (nps >= 0) {
    npsQuality = 'Needs Improvement';
    emoji = '📊';
  } else {
    npsQuality = 'Critical';
    emoji = '⚠️';
  }

  let response = `**${emoji} Net Promoter Score: ${nps}** (${npsQuality})\n\n`;
  response += `📈 **Period:** ${period || 'All time'}\n`;
  response += `📝 **Total Responses:** ${totalResponses}\n\n`;

  response += `**Breakdown:**\n`;
  response += `• Promoters (9-10): ${promoters} (${promoterPercentage}%)\n`;
  response += `• Passives (7-8): ${passives} (${Math.round((passives / totalResponses) * 1000) / 10 || 0}%)\n`;
  response += `• Detractors (0-6): ${detractors} (${detractorPercentage}%)\n\n`;

  response += `*NPS = % Promoters - % Detractors*`;

  return response;
}
