import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from '../utils/logger.js';
import {
  createRealtimeSession,
  sendAudioToOpenAI,
  commitAudioBuffer,
  cancelResponse,
  closeSession,
  isRealtimeConfigured,
  RealtimeSession,
} from '../integrations/openai-realtime/index.js';

const activeSessions = new Map<WebSocket, RealtimeSession>();

/**
 * Initialize WebSocket server for voice connections
 */
export function initializeVoiceServer(server: HTTPServer): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/voice',
  });

  logger.info('Voice WebSocket server initialized on /voice');

  wss.on('connection', async (ws: WebSocket) => {
    logger.info('New voice client connected');

    // Check if realtime is configured
    if (!isRealtimeConfigured()) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Voice service not configured. Please set OPENAI_API_KEY.',
      }));
      ws.close();
      return;
    }

    // Create OpenAI Realtime session
    const session = await createRealtimeSession(ws);

    if (!session) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to initialize voice session',
      }));
      ws.close();
      return;
    }

    activeSessions.set(ws, session);

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const dataStr = Buffer.isBuffer(data) ? data.toString() : String(data);
        const message = JSON.parse(dataStr);
        handleClientMessage(message, session);
      } catch {
        // If not JSON, treat as raw audio data (base64)
        if (Buffer.isBuffer(data)) {
          const audioData = data.toString('base64');
          sendAudioToOpenAI(session, audioData);
        }
      }
    });

    ws.on('close', () => {
      logger.info('Voice client disconnected');
      closeSession(session);
      activeSessions.delete(ws);
    });

    ws.on('error', (error) => {
      logger.error('Voice WebSocket error', { error });
      closeSession(session);
      activeSessions.delete(ws);
    });
  });

  return wss;
}

/**
 * Handle messages from the client
 */
function handleClientMessage(message: any, session: RealtimeSession): void {
  switch (message.type) {
    case 'audio':
      // Client sending audio data
      if (message.data) {
        sendAudioToOpenAI(session, message.data);
      }
      break;

    case 'audio.commit':
      // Client signaling end of speech (for push-to-talk mode)
      commitAudioBuffer(session);
      break;

    case 'response.cancel':
      // Client wants to cancel current response
      cancelResponse(session);
      break;

    case 'ping':
      // Keep-alive ping
      session.clientWs.send(JSON.stringify({ type: 'pong' }));
      break;

    default:
      logger.debug('Unknown client message type', { type: message.type });
  }
}

/**
 * Get count of active voice sessions
 */
export function getActiveSessionCount(): number {
  return activeSessions.size;
}
