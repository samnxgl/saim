import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

const API_BASE_URL = 'https://api.autocontentapi.com/v1';

export interface CreatePodcastRequest {
  resources: Array<{
    content: string;
    type: 'text' | 'website';
  }>;
  text: string; // Prompt/instruction for the podcast
  outputType: 'audio';
}

export interface CreatePodcastResponse {
  contentId?: string;
  request_id?: string;
  error_message?: string;
}

export interface PodcastStatusResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed' | number;
  audioUrl?: string;
  audio_url?: string;
  transcript?: string;
  error_message?: string;
  errorMessage?: string;
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
    const response = await fetch(`${API_BASE_URL}/Content/Create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.autoContentApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    logger.info('AutoContent API response', {
      status: response.status,
      body: responseText.slice(0, 500),
    });

    if (!response.ok) {
      logger.error('AutoContent API error', {
        status: response.status,
        error: responseText,
      });
      throw new Error(`AutoContent API error: ${response.status} - ${responseText}`);
    }

    const result = JSON.parse(responseText) as CreatePodcastResponse;

    if (result.error_message) {
      throw new Error(`AutoContent API error: ${result.error_message}`);
    }

    const requestId = result.contentId || result.request_id;
    if (!requestId) {
      throw new Error('No contentId or request_id in AutoContent API response');
    }

    logger.info('Podcast creation initiated', { requestId });
    return { request_id: requestId, contentId: requestId };
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
    const response = await fetch(`${API_BASE_URL}/Content/Status/${requestId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.autoContentApiKey}`,
        'Accept': 'application/json',
      },
    });

    const responseText = await response.text();
    logger.debug('AutoContent status response', {
      status: response.status,
      body: responseText.slice(0, 500),
    });

    if (!response.ok) {
      throw new Error(`AutoContent API error: ${response.status} - ${responseText}`);
    }

    const result = JSON.parse(responseText) as PodcastStatusResponse;
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

    // Handle both numeric (100 = completed) and string status formats
    const isCompleted = status.status === 'completed' || status.status === 100;
    const isFailed = status.status === 'failed';
    const audioUrl = status.audioUrl || status.audio_url;

    if (isCompleted && audioUrl) {
      logger.info('Podcast generation completed', { requestId, audioUrl });
      return { ...status, audio_url: audioUrl };
    }

    if (isFailed) {
      const errorMsg = status.error_message || status.errorMessage || 'Unknown error';
      throw new Error(`Podcast generation failed: ${errorMsg}`);
    }

    logger.debug('Podcast still processing', { requestId, status: status.status });
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(`Podcast generation timed out after ${maxWaitMs / 1000} seconds`);
}

export function isAutoContentConfigured(): boolean {
  return !!config.autoContentApiKey;
}
