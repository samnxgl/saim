import WebSocket from 'ws';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';
import { SYSTEM_PROMPTS } from '../../assistant/prompts.js';
import { buildFullContext } from '../../assistant/context.js';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const OPENAI_MODEL = 'gpt-4o-realtime-preview-2024-12-17';

export interface RealtimeSession {
  ws: WebSocket;
  clientWs: WebSocket;
  sessionId?: string;
}

/**
 * Check if OpenAI Realtime is configured
 */
export function isRealtimeConfigured(): boolean {
  return !!config.openaiApiKey;
}

/**
 * Build the system instructions for voice conversations
 */
async function buildVoiceSystemPrompt(): Promise<string> {
  const context = await buildFullContext();

  let systemPrompt = SYSTEM_PROMPTS.ceo;

  // Add context if available
  if (context.strategicPlan) {
    systemPrompt += `\n\n## Current Strategic Plan Summary\n${context.strategicPlan.slice(0, 2000)}`;
  }

  if (context.recentPatterns.length > 0) {
    systemPrompt += `\n\n## Recent Patterns Detected\n${context.recentPatterns.slice(0, 5).join('\n')}`;
  }

  // Add voice-specific instructions
  systemPrompt += `\n\n## Voice Conversation Guidelines
- Keep responses concise and conversational
- Use natural speech patterns
- Avoid lengthy lists or complex formatting
- Ask clarifying questions when needed
- Summarize key points briefly`;

  return systemPrompt;
}

/**
 * Create a new realtime session with OpenAI
 */
export async function createRealtimeSession(clientWs: WebSocket): Promise<RealtimeSession | null> {
  if (!isRealtimeConfigured()) {
    logger.error('OpenAI API key not configured for realtime');
    return null;
  }

  try {
    const url = `${OPENAI_REALTIME_URL}?model=${OPENAI_MODEL}`;

    const ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${config.openaiApiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    const session: RealtimeSession = { ws, clientWs };

    ws.on('open', async () => {
      logger.info('Connected to OpenAI Realtime API');

      // Build and send session configuration
      const systemPrompt = await buildVoiceSystemPrompt();

      const sessionUpdate = {
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: systemPrompt,
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'whisper-1',
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500,
          },
        },
      };

      ws.send(JSON.stringify(sessionUpdate));
    });

    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        handleOpenAIEvent(event, session);
      } catch (error) {
        logger.error('Failed to parse OpenAI event', { error });
      }
    });

    ws.on('error', (error) => {
      logger.error('OpenAI Realtime WebSocket error', { error });
      clientWs.send(JSON.stringify({ type: 'error', message: 'Connection error with voice service' }));
    });

    ws.on('close', (code, reason) => {
      logger.info('OpenAI Realtime connection closed', { code, reason: reason.toString() });
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'session.closed' }));
      }
    });

    return session;
  } catch (error) {
    logger.error('Failed to create realtime session', { error });
    return null;
  }
}

/**
 * Handle events from OpenAI Realtime API
 */
function handleOpenAIEvent(event: any, session: RealtimeSession): void {
  const { clientWs } = session;

  switch (event.type) {
    case 'session.created':
      session.sessionId = event.session?.id;
      logger.info('Realtime session created', { sessionId: session.sessionId });
      clientWs.send(JSON.stringify({ type: 'session.ready' }));
      break;

    case 'session.updated':
      logger.debug('Session updated', { session: event.session });
      break;

    case 'input_audio_buffer.speech_started':
      clientWs.send(JSON.stringify({ type: 'listening' }));
      break;

    case 'input_audio_buffer.speech_stopped':
      clientWs.send(JSON.stringify({ type: 'processing' }));
      break;

    case 'conversation.item.input_audio_transcription.completed':
      // Send the transcription to the client
      clientWs.send(JSON.stringify({
        type: 'transcription',
        text: event.transcript,
      }));
      break;

    case 'response.audio.delta':
      // Forward audio chunks to client
      clientWs.send(JSON.stringify({
        type: 'audio',
        delta: event.delta,
      }));
      break;

    case 'response.audio.done':
      clientWs.send(JSON.stringify({ type: 'audio.done' }));
      break;

    case 'response.audio_transcript.delta':
      // Forward response transcript to client
      clientWs.send(JSON.stringify({
        type: 'response.transcript',
        delta: event.delta,
      }));
      break;

    case 'response.audio_transcript.done':
      clientWs.send(JSON.stringify({
        type: 'response.transcript.done',
        text: event.transcript,
      }));
      break;

    case 'response.done':
      clientWs.send(JSON.stringify({ type: 'response.done' }));
      break;

    case 'error':
      logger.error('OpenAI Realtime error', { error: event.error });
      clientWs.send(JSON.stringify({
        type: 'error',
        message: event.error?.message || 'Unknown error',
      }));
      break;

    default:
      logger.debug('Unhandled OpenAI event', { type: event.type });
  }
}

/**
 * Send audio data to OpenAI
 */
export function sendAudioToOpenAI(session: RealtimeSession, audioData: string): void {
  if (session.ws.readyState !== WebSocket.OPEN) {
    logger.warn('Cannot send audio - OpenAI connection not open');
    return;
  }

  const event = {
    type: 'input_audio_buffer.append',
    audio: audioData,
  };

  session.ws.send(JSON.stringify(event));
}

/**
 * Commit the audio buffer (signal end of speech)
 */
export function commitAudioBuffer(session: RealtimeSession): void {
  if (session.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  session.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
}

/**
 * Request a response from the model
 */
export function createResponse(session: RealtimeSession): void {
  if (session.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  session.ws.send(JSON.stringify({ type: 'response.create' }));
}

/**
 * Cancel an in-progress response
 */
export function cancelResponse(session: RealtimeSession): void {
  if (session.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  session.ws.send(JSON.stringify({ type: 'response.cancel' }));
}

/**
 * Close the realtime session
 */
export function closeSession(session: RealtimeSession): void {
  if (session.ws.readyState === WebSocket.OPEN) {
    session.ws.close();
  }
}
