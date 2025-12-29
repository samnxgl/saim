import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: config.anthropicApiKey,
    });
  }
  return client;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export async function chat(
  systemPrompt: string,
  messages: Message[],
  options?: {
    maxTokens?: number;
    temperature?: number;
  }
): Promise<ClaudeResponse> {
  const claude = getClaudeClient();

  try {
    const response = await claude.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature ?? 0.7,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const textContent = response.content.find((c) => c.type === 'text');
    const content = textContent?.type === 'text' ? textContent.text : '';

    return {
      content,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  } catch (error) {
    logger.error('Claude API error', { error });
    throw error;
  }
}

export async function analyzeText(
  text: string,
  analysisType: 'sentiment' | 'topics' | 'urgency' | 'values' | 'summary'
): Promise<string> {
  const prompts: Record<typeof analysisType, string> = {
    sentiment: 'Analyze the sentiment of the following text. Respond with a JSON object containing: sentiment (positive/negative/neutral), confidence (0-1), and key_phrases (array of phrases that influenced the sentiment).',
    topics: 'Extract the main topics from the following text. Respond with a JSON object containing: main_topic, subtopics (array), and keywords (array).',
    urgency: 'Assess the urgency level of the following text. Respond with a JSON object containing: urgency_level (low/medium/high/critical), indicators (array of phrases indicating urgency), and recommended_response_time.',
    values: 'Identify any company values or principles reflected in the following text. Respond with a JSON object containing: values_detected (array of value names), alignment_score (0-1), and examples (array of specific phrases).',
    summary: 'Provide a concise summary of the following text. Respond with a JSON object containing: summary (2-3 sentences), key_points (array), and action_items (array if any).',
  };

  const systemPrompt = `You are an analytical assistant helping a CEO understand communications. ${prompts[analysisType]} Respond only with valid JSON.`;

  const response = await chat(systemPrompt, [
    { role: 'user', content: text },
  ], { temperature: 0.3 });

  return response.content;
}

export async function generateInsight(
  context: {
    strategicPlan?: string;
    recentMessages?: string[];
    financialData?: string;
    topic: string;
  }
): Promise<string> {
  const systemPrompt = `You are Saim, an executive assistant AI helping the CEO of Next Gen Learning.
Your role is to provide strategic insights based on:
- The company's one-page strategic plan
- Recent team communications
- Financial data

Provide actionable, concise insights that help the CEO:
1. Set strategy
2. Build the leadership team
3. Allocate capital
4. Set values and standards

Be direct and specific. Reference concrete data when available.`;

  let contextMessage = `Topic: ${context.topic}\n\n`;

  if (context.strategicPlan) {
    contextMessage += `Strategic Plan:\n${context.strategicPlan}\n\n`;
  }

  if (context.recentMessages && context.recentMessages.length > 0) {
    contextMessage += `Recent Communications:\n${context.recentMessages.join('\n')}\n\n`;
  }

  if (context.financialData) {
    contextMessage += `Financial Context:\n${context.financialData}\n\n`;
  }

  contextMessage += 'Please provide your insight on this topic.';

  const response = await chat(systemPrompt, [
    { role: 'user', content: contextMessage },
  ]);

  return response.content;
}
