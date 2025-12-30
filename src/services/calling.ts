import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { sendMessage } from '../integrations/slack/client.js';
import {
  sendCall,
  getCallDetails,
  waitForCallCompletion,
  analyzeCall,
  isBlandConfigured,
  formatPhoneNumber,
  CallDetails,
} from '../integrations/bland/index.js';

export interface InitiateCallRequest {
  phoneNumber: string;
  recipientName?: string;
  task: string;
  requestedBy: string;
  slackChannelId?: string;
  slackThreadTs?: string;
}

export interface CallResult {
  success: boolean;
  callId?: string;
  status?: string;
  transcript?: string;
  summary?: string;
  recordingUrl?: string;
  error?: string;
}

/**
 * Initiate an outbound call and track it in the database
 */
export async function initiateCall(request: InitiateCallRequest): Promise<CallResult> {
  logger.info('Initiating outbound call', {
    phoneNumber: request.phoneNumber,
    recipientName: request.recipientName,
    task: request.task.slice(0, 100),
  });

  if (!isBlandConfigured()) {
    return {
      success: false,
      error: 'Outbound calling is not configured. Please set the BLAND_API_KEY environment variable.',
    };
  }

  try {
    const formattedPhone = formatPhoneNumber(request.phoneNumber);

    // Build the call task with context
    const callTask = buildCallTask(request.task, request.recipientName);

    // Initiate the call via Bland AI
    const callResponse = await sendCall({
      phone_number: formattedPhone,
      task: callTask,
      first_sentence: request.recipientName
        ? `Hello, this is Saim calling on behalf of the CEO of Next Gen Learning. Am I speaking with ${request.recipientName}?`
        : 'Hello, this is Saim calling on behalf of the CEO of Next Gen Learning.',
      wait_for_greeting: true,
      record: true,
      max_duration: 15,
      metadata: {
        requested_by: request.requestedBy,
        recipient_name: request.recipientName,
      },
    });

    // Store the call in the database
    await db.insert(schema.outboundCalls).values({
      blandCallId: callResponse.call_id,
      phoneNumber: formattedPhone,
      recipientName: request.recipientName,
      task: request.task,
      status: 'queued',
      requestedBy: request.requestedBy,
      slackChannelId: request.slackChannelId,
      slackThreadTs: request.slackThreadTs,
    });

    // Notify that call is in progress
    if (request.slackChannelId) {
      await sendMessage(
        request.slackChannelId,
        `I'm now calling ${request.recipientName || formattedPhone}. I'll report back when the call is complete.`,
        { threadTs: request.slackThreadTs }
      );
    }

    // Monitor the call in the background
    monitorCallProgress(callResponse.call_id, request);

    return {
      success: true,
      callId: callResponse.call_id,
      status: 'queued',
    };
  } catch (error) {
    logger.error('Failed to initiate call', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Build a comprehensive task prompt for the AI caller
 */
function buildCallTask(userTask: string, recipientName?: string): string {
  return `You are Saim, an AI executive assistant calling on behalf of the CEO of Next Gen Learning.

Your objective: ${userTask}

Guidelines:
- Be professional, courteous, and efficient
- Clearly identify yourself as an AI assistant at the start of the call
- If the recipient is not available, offer to leave a message or ask for a callback time
- If you reach voicemail, leave a clear message with your purpose and ask them to contact the CEO
- Take note of any important information shared during the call
- If the task requires a decision or commitment, confirm understanding before ending
- Thank the recipient for their time at the end of the call
${recipientName ? `- You are calling to speak with ${recipientName}` : ''}

Important: Remember to be concise and respect the recipient's time. If they seem busy, offer to reschedule.`;
}

/**
 * Monitor call progress and update when complete
 */
async function monitorCallProgress(callId: string, request: InitiateCallRequest): Promise<void> {
  try {
    // Wait for the call to complete (with timeout)
    const callDetails = await waitForCallCompletion(callId);

    // Update the database with results
    await updateCallRecord(callId, callDetails);

    // Generate summary and analysis
    let summary = callDetails.summary;
    let analysis: Record<string, any> | undefined;

    if (callDetails.completed && callDetails.concatenated_transcript) {
      try {
        analysis = await analyzeCall(callId, request.task);
        summary = analysis?.answers?.main_outcome || callDetails.summary;
      } catch (err) {
        logger.warn('Failed to analyze call', { callId, error: err });
      }
    }

    // Update with analysis
    if (analysis) {
      await db.update(schema.outboundCalls)
        .set({
          summary,
          analysis,
        })
        .where(eq(schema.outboundCalls.blandCallId, callId));
    }

    // Report back to Slack
    await reportCallCompletion(callId, callDetails, request, summary);

  } catch (error) {
    logger.error('Error monitoring call progress', { callId, error });

    // Update database with error
    await db.update(schema.outboundCalls)
      .set({
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      })
      .where(eq(schema.outboundCalls.blandCallId, callId));

    // Notify about failure
    if (request.slackChannelId) {
      await sendMessage(
        request.slackChannelId,
        `I wasn't able to complete the call to ${request.recipientName || request.phoneNumber}. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { threadTs: request.slackThreadTs }
      );
    }
  }
}

/**
 * Update call record with details from Bland AI
 */
async function updateCallRecord(callId: string, details: CallDetails): Promise<void> {
  await db.update(schema.outboundCalls)
    .set({
      status: details.status,
      callLength: details.call_length,
      recordingUrl: details.recording_url,
      transcript: details.concatenated_transcript,
      startedAt: details.started_at ? new Date(details.started_at) : undefined,
      completedAt: new Date(),
    })
    .where(eq(schema.outboundCalls.blandCallId, callId));
}

/**
 * Report call completion to Slack
 */
async function reportCallCompletion(
  callId: string,
  details: CallDetails,
  request: InitiateCallRequest,
  summary?: string
): Promise<void> {
  if (!request.slackChannelId) return;

  const recipient = request.recipientName || request.phoneNumber;
  let message: string;

  switch (details.status) {
    case 'completed':
      const duration = details.call_length
        ? `${Math.floor(details.call_length / 60)}m ${details.call_length % 60}s`
        : 'unknown duration';

      message = `**Call to ${recipient} completed** (${duration})\n\n`;

      if (summary) {
        message += `**Summary:**\n${summary}\n\n`;
      }

      if (details.concatenated_transcript) {
        const transcriptPreview = details.concatenated_transcript.slice(0, 800);
        message += `**Transcript preview:**\n${transcriptPreview}${details.concatenated_transcript.length > 800 ? '...' : ''}\n\n`;
      }

      if (details.recording_url) {
        message += `**Recording:** ${details.recording_url}`;
      }
      break;

    case 'no-answer':
      message = `I called ${recipient} but there was no answer. Would you like me to try again later?`;
      break;

    case 'busy':
      message = `I called ${recipient} but the line was busy. Would you like me to try again?`;
      break;

    case 'voicemail':
      message = `I reached ${recipient}'s voicemail and left a message about: ${request.task.slice(0, 100)}`;
      if (details.concatenated_transcript) {
        message += `\n\n**Message left:**\n${details.concatenated_transcript}`;
      }
      break;

    case 'failed':
      message = `The call to ${recipient} failed. ${details.error_message || 'Please try again or verify the phone number.'}`;
      break;

    default:
      message = `Call to ${recipient} ended with status: ${details.status}`;
  }

  await sendMessage(request.slackChannelId, message, { threadTs: request.slackThreadTs });

  // Also notify CEO if this was a delegated task
  if (request.requestedBy === config.ceoSlackUserId) {
    await db.update(schema.outboundCalls)
      .set({ notifiedCeo: true })
      .where(eq(schema.outboundCalls.blandCallId, callId));
  }
}

/**
 * Get call status by ID
 */
export async function getCallStatus(callId: string): Promise<CallResult> {
  try {
    const call = await db.query.outboundCalls.findFirst({
      where: eq(schema.outboundCalls.blandCallId, callId),
    });

    if (!call) {
      return { success: false, error: 'Call not found' };
    }

    return {
      success: true,
      callId: call.blandCallId,
      status: call.status,
      transcript: call.transcript || undefined,
      summary: call.summary || undefined,
      recordingUrl: call.recordingUrl || undefined,
    };
  } catch (error) {
    logger.error('Failed to get call status', { callId, error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Parse phone number from text
 */
export function extractPhoneNumber(text: string): string | null {
  // Match various phone number formats
  const patterns = [
    /\+?1?[-.\s]?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/,
    /\+(\d{1,3})[-.\s]?(\d{2,4})[-.\s]?(\d{3,4})[-.\s]?(\d{3,4})/,
    /(\d{10,15})/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
}

/**
 * Extract recipient name from text
 */
export function extractRecipientName(text: string): string | null {
  // Common patterns for names in call requests
  const patterns = [
    /call\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /speak\s+(?:to|with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /contact\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    /reach\s+(?:out\s+to\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // Filter out common words that aren't names
      const name = match[1].trim();
      const nonNames = ['the', 'a', 'an', 'this', 'that', 'my', 'your', 'our'];
      if (!nonNames.includes(name.toLowerCase())) {
        return name;
      }
    }
  }

  return null;
}
