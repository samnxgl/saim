import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

const API_BASE_URL = 'https://api.autocontentapi.com';

export interface CreatePodcastRequest {
  resources: Array<{
    content: string;
    type: 'text' | 'website';
  }>;
  text: string; // Prompt/instruction for the podcast
  outputType: 'audio';
}

export interface CreatePodcastResponse {
  request_id: string;
  error_message?: string;
}

export interface PodcastStatusResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  audio_url?: string;
  transcript?: string;
  error_message?: string;
}

export async function createPodcast(
  content: string,
  prompt: string
): Promise<CreatePodcastResponse> {
  if (!config.autoContentApiKey) {
    throw new Error('AutoContent API key not configured. Set AUTOCONTENT_API_KEY environment variable.');
  }

  const requestBody: CreatePodcastRequest = {
    resources: [
      {
        content,
        type: 'text',
      },
    ],
    text: prompt,
    outputType: 'audio',
  };

  logger.info('Creating podcast via AutoContent API', {
    contentLength: content.length,
    prompt: prompt.slice(0, 100),
  });

  try {
    const response = await fetch(`${API_BASE_URL}/content/Create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.autoContentApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('AutoContent API error', {
        status: response.status,
        error: errorText,
      });
      throw new Error(`AutoContent API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as CreatePodcastResponse;

    if (result.error_message) {
      throw new Error(`AutoContent API error: ${result.error_message}`);
    }

    logger.info('Podcast creation initiated', { requestId: result.request_id });
    return result;
  } catch (error) {
    logger.error('Failed to create podcast', { error });
    throw error;
  }
}

export async function getPodcastStatus(requestId: string): Promise<PodcastStatusResponse> {
  if (!config.autoContentApiKey) {
    throw new Error('AutoContent API key not configured');
  }

  try {
    const response = await fetch(`${API_BASE_URL}/content/Status/${requestId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.autoContentApiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AutoContent API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as PodcastStatusResponse;
    return result;
  } catch (error) {
    logger.error('Failed to get podcast status', { error, requestId });
    throw error;
  }
}

export async function waitForPodcastCompletion(
  requestId: string,
  maxWaitMs: number = 600000, // 10 minutes default
  pollIntervalMs: number = 10000 // 10 seconds
): Promise<PodcastStatusResponse> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const status = await getPodcastStatus(requestId);

    if (status.status === 'completed') {
      logger.info('Podcast generation completed', { requestId, audioUrl: status.audio_url });
      return status;
    }

    if (status.status === 'failed') {
      throw new Error(`Podcast generation failed: ${status.error_message}`);
    }

    logger.debug('Podcast still processing', { requestId, status: status.status });
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Podcast generation timed out after ${maxWaitMs / 1000} seconds`);
}

export function isAutoContentConfigured(): boolean {
  return !!config.autoContentApiKey;
}
