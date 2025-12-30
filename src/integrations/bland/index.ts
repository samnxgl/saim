import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

const API_BASE_URL = 'https://api.bland.ai/v1';

export interface SendCallRequest {
  phone_number: string;
  task: string;
  voice?: string;
  first_sentence?: string;
  wait_for_greeting?: boolean;
  record?: boolean;
  max_duration?: number;
  transfer_phone_number?: string;
  language?: string;
  webhook?: string;
  metadata?: Record<string, any>;
}

export interface SendCallResponse {
  call_id: string;
  batch_id?: string;
  status: string;
  message?: string;
}

export interface CallDetails {
  call_id: string;
  status: 'queued' | 'in-progress' | 'completed' | 'failed' | 'no-answer' | 'busy' | 'voicemail';
  completed: boolean;
  created_at: string;
  started_at?: string;
  end_at?: string;
  call_length?: number;
  to: string;
  from: string;
  request_data?: Record<string, any>;
  answered_by?: string;
  recording_url?: string;
  concatenated_transcript?: string;
  transcripts?: Array<{
    id: number;
    created_at: string;
    text: string;
    user: 'user' | 'assistant';
  }>;
  summary?: string;
  analysis?: Record<string, any>;
  error_message?: string;
}

export async function sendCall(request: SendCallRequest): Promise<SendCallResponse> {
  if (!config.blandApiKey) {
    throw new Error('Bland AI API key not configured. Set BLAND_API_KEY environment variable.');
  }

  logger.info('Initiating outbound call via Bland AI', {
    phone_number: request.phone_number,
    task: request.task.slice(0, 100),
  });

  try {
    const response = await fetch(`${API_BASE_URL}/calls`, {
      method: 'POST',
      headers: {
        'Authorization': config.blandApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...request,
        record: request.record ?? true,
        max_duration: request.max_duration ?? 15, // 15 minutes default
        language: request.language ?? 'en',
      }),
    });

    const responseText = await response.text();
    logger.info('Bland AI response', {
      status: response.status,
      body: responseText.slice(0, 500),
    });

    if (!response.ok) {
      throw new Error(`Bland AI error: ${response.status} - ${responseText}`);
    }

    const result = JSON.parse(responseText) as SendCallResponse;

    if (!result.call_id) {
      throw new Error('No call_id in Bland AI response');
    }

    logger.info('Call initiated successfully', { callId: result.call_id });
    return result;
  } catch (error) {
    logger.error('Failed to initiate call', { error });
    throw error;
  }
}

export async function getCallDetails(callId: string): Promise<CallDetails> {
  if (!config.blandApiKey) {
    throw new Error('Bland AI API key not configured');
  }

  try {
    const response = await fetch(`${API_BASE_URL}/calls/${callId}`, {
      method: 'GET',
      headers: {
        'Authorization': config.blandApiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bland AI error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as CallDetails;
    return result;
  } catch (error) {
    logger.error('Failed to get call details', { callId, error });
    throw error;
  }
}

export async function waitForCallCompletion(
  callId: string,
  maxWaitMs: number = 1200000, // 20 minutes default
  pollIntervalMs: number = 15000 // 15 seconds
): Promise<CallDetails> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const details = await getCallDetails(callId);

    if (details.completed || details.status === 'completed') {
      logger.info('Call completed', { callId, status: details.status });
      return details;
    }

    if (details.status === 'failed' || details.error_message) {
      throw new Error(`Call failed: ${details.error_message || details.status}`);
    }

    // Check for terminal states
    if (['no-answer', 'busy', 'voicemail'].includes(details.status)) {
      logger.info('Call ended with terminal status', { callId, status: details.status });
      return details;
    }

    logger.debug('Call still in progress', { callId, status: details.status });
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Call monitoring timed out after ${Math.round(maxWaitMs / 1000)} seconds`);
}

export async function analyzeCall(callId: string, goal?: string): Promise<Record<string, any>> {
  if (!config.blandApiKey) {
    throw new Error('Bland AI API key not configured');
  }

  try {
    const response = await fetch(`${API_BASE_URL}/calls/${callId}/analyze`, {
      method: 'POST',
      headers: {
        'Authorization': config.blandApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        goal: goal || 'Summarize the call and extract key outcomes',
        questions: [
          ['Was the call objective achieved?', 'boolean'],
          ['What was the main outcome?', 'string'],
          ['What are the next steps if any?', 'string'],
          ['What was the overall sentiment?', 'string'],
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bland AI analyze error: ${response.status} - ${errorText}`);
    }

    return await response.json() as Record<string, any>;
  } catch (error) {
    logger.error('Failed to analyze call', { callId, error });
    throw error;
  }
}

export function isBlandConfigured(): boolean {
  return !!config.blandApiKey;
}

export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Ensure it starts with + for international format
  if (!cleaned.startsWith('+')) {
    // Assume US number if no country code
    if (cleaned.length === 10) {
      cleaned = '+1' + cleaned;
    } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
      cleaned = '+' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }

  return cleaned;
}
