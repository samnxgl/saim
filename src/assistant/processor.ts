import { chat, Message } from './claude.js';
import { getSystemPrompt, buildContextualPrompt } from './prompts.js';
import {
  getOrCreateConversationContext,
  updateConversationContext,
  buildFullContext,
  findDirectReportByName,
  getDirectReportContext,
} from './context.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { sendDirectMessage } from '../integrations/slack/client.js';
import {
  generateDailyPodcast,
  generateYesterdaysPodcast,
  generatePodcastFromMessage,
  generatePodcastFromChannel,
  parseSlackMessageLink,
} from '../services/podcast.js';
import { isAutoContentConfigured } from '../integrations/autocontent/index.js';
import {
  initiateCall,
  extractPhoneNumber,
  extractRecipientName,
} from '../services/calling.js';
import { isBlandConfigured } from '../integrations/bland/index.js';

export interface ProcessMessageInput {
  text: string;
  userId: string;
  channelId: string;
  threadTs?: string;
  isCEO: boolean;
  isSlashCommand?: boolean;
}

export async function processMessage(input: ProcessMessageInput): Promise<string> {
  logger.info('Processing message', { userId: input.userId, isCEO: input.isCEO });

  // Get or create conversation context
  const conversationContext = await getOrCreateConversationContext(
    input.userId,
    input.channelId
  );

  // Build full context for the AI
  const fullContext = await buildFullContext();

  // Determine the appropriate system prompt
  const basePrompt = input.isCEO
    ? getSystemPrompt('ceo')
    : getSystemPrompt('directReport');

  const systemPrompt = buildContextualPrompt(basePrompt, {
    strategicPlan: fullContext.strategicPlan || undefined,
    financialData: fullContext.financialSummary || undefined,
    patterns: fullContext.recentPatterns,
    directReports: fullContext.directReports.map((dr) => `${dr.name} (${dr.role})`),
    slackMessages: fullContext.recentSlackMessages || undefined,
  });

  // Prepare messages for Claude
  const messages: Message[] = [
    ...conversationContext.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user' as const, content: input.text },
  ];

  // Check for special commands if CEO
  if (input.isCEO) {
    const commandResult = await handleCEOCommands(input.text, fullContext, input);
    if (commandResult) {
      return commandResult;
    }
  }

  // Get response from Claude
  const response = await chat(systemPrompt, messages, {
    maxTokens: 2048,
    temperature: 0.7,
  });

  // Update conversation context
  await updateConversationContext(conversationContext.id, [
    { role: 'user', content: input.text, timestamp: new Date().toISOString() },
    { role: 'assistant', content: response.content, timestamp: new Date().toISOString() },
  ]);

  logger.info('Message processed', {
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  });

  return response.content;
}

async function handleCEOCommands(
  text: string,
  context: Awaited<ReturnType<typeof buildFullContext>>,
  input: ProcessMessageInput
): Promise<string | null> {
  const lowerText = text.toLowerCase();

  // Handle call command - check before delegation since "call" might match delegation patterns
  const callPatterns = ['call ', 'phone ', 'ring ', 'dial ', 'make a call', 'place a call'];
  const isCall = callPatterns.some(pattern => lowerText.includes(pattern));
  if (isCall) {
    return handleCallCommand(text, input);
  }

  // Handle delegation command - expanded patterns
  const delegationPatterns = [
    'delegate to',
    'ask ',
    'reach out to',
    'contact ',
    'message ',
    'send a message to',
    'talk to',
    'check with',
    'follow up with',
    'get from',
    'request from',
  ];

  const isDelegation = delegationPatterns.some(pattern => lowerText.includes(pattern));
  if (isDelegation) {
    return handleDelegation(text, context);
  }

  // Handle strategic plan query
  if (lowerText.includes('strategic plan') || lowerText.includes('strategy')) {
    if (context.strategicPlan) {
      const response = await chat(
        getSystemPrompt('ceo'),
        [
          {
            role: 'user',
            content: `Based on our strategic plan, ${text}\n\nStrategic Plan:\n${context.strategicPlan}`,
          },
        ]
      );
      return response.content;
    }
    return "I don't have the current strategic plan loaded. Please ensure the document is synced.";
  }

  // Handle pattern query
  if (lowerText.includes('patterns') || lowerText.includes('trends')) {
    if (context.recentPatterns.length > 0) {
      return `Here are the recent patterns I've detected:\n\n${context.recentPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
    }
    return "I haven't detected any significant patterns yet. This usually requires more message history.";
  }

  // Handle values query
  if (lowerText.includes('values') || lowerText.includes('reinforce')) {
    return handleValuesGuidance(text);
  }

  // Handle podcast command
  if (lowerText.includes('podcast') || lowerText.includes('audio summary') || lowerText.includes('daily recap')) {
    return handlePodcastCommand(text);
  }

  return null;
}

async function handleDelegation(
  text: string,
  context: Awaited<ReturnType<typeof buildFullContext>>
): Promise<string> {
  // Try multiple patterns to extract the target name
  const patterns = [
    /(?:delegate to|ask|reach out to|contact|message|talk to|check with|follow up with)\s+(?:my direct report,?\s*)?(\w+(?:[- ]\w+)?)/i,
    /(?:get|request)\s+(?:an?\s+)?(?:update|status|report)\s+from\s+(\w+(?:[- ]\w+)?)/i,
    /(\w+(?:[- ]\w+)?)\s+(?:to|and)\s+(?:give|provide|send|share)/i,
  ];

  let targetName: string | null = null;

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      targetName = match[1];
      break;
    }
  }

  // Also try to find a direct report name mentioned in the text
  if (!targetName) {
    for (const dr of context.directReports) {
      const firstName = dr.name.split(' ')[0].toLowerCase();
      const fullName = dr.name.toLowerCase();
      if (text.toLowerCase().includes(firstName) || text.toLowerCase().includes(fullName)) {
        targetName = dr.name;
        break;
      }
    }
  }

  if (!targetName) {
    const availableNames = context.directReports.map((dr) => dr.name).join(', ');
    return `I couldn't identify who you want me to contact. Available direct reports: ${availableNames}\n\nPlease try again with a specific name, e.g., "Ask [Name] to provide an update on..."`;
  }

  // The instruction is the full request for context
  const instruction = text;

  // Find the direct report
  const directReport = await findDirectReportByName(targetName);

  if (!directReport) {
    const availableNames = context.directReports.map((dr) => dr.name).join(', ');
    return `I couldn't find a direct report matching "${targetName}". Available direct reports: ${availableNames}`;
  }

  // Create the delegated task
  const [task] = await db
    .insert(schema.delegatedTasks)
    .values({
      directReportId: directReport.id,
      instruction,
      status: 'in_progress',
      conversationHistory: [],
    })
    .returning();

  // Generate a proper opening message using Claude
  const openingResponse = await chat(
    `You are Saim, the CEO's executive assistant. Generate a brief, friendly opening message to a team member. You need to:
1. Greet them by first name
2. Explain you're reaching out on behalf of the CEO
3. Ask the specific question or make the specific request the CEO wanted
4. Keep it concise and professional

Do NOT include any prefixes like "CONTINUE:" or formatting - just write the message directly.`,
    [
      {
        role: 'user',
        content: `Team member's name: ${directReport.name}
CEO's request: ${instruction}

Write the opening message:`,
      },
    ],
    { temperature: 0.7, maxTokens: 500 }
  );

  const initialMessage = openingResponse.content;

  try {
    await sendDirectMessage(directReport.slackUserId, initialMessage);

    // Update task with the initial message
    await db
      .update(schema.delegatedTasks)
      .set({
        conversationHistory: [
          {
            role: 'saim',
            message: initialMessage,
            timestamp: new Date().toISOString(),
          },
        ],
      })
      .where(eq(schema.delegatedTasks.id, task.id));

    return `I've reached out to ${directReport.name} with your request. I'll summarize their response once I receive it.`;
  } catch (error) {
    logger.error('Failed to send delegation message', { error, directReportId: directReport.id });
    return `I encountered an error reaching out to ${directReport.name}. Please try again or contact them directly.`;
  }
}

async function handleValuesGuidance(text: string): Promise<string> {
  // Get company values
  const values = await db.select().from(schema.companyValues);

  if (values.length === 0) {
    return "Company values haven't been configured yet. Please add them through the database.";
  }

  const valuesContext = values
    .map((v) => `- ${v.name}: ${v.description}`)
    .join('\n');

  const response = await chat(
    getSystemPrompt('valuesGuidance'),
    [
      {
        role: 'user',
        content: `Company Values:\n${valuesContext}\n\nRequest: ${text}`,
      },
    ],
    { temperature: 0.5 }
  );

  return response.content;
}

async function handlePodcastCommand(text: string): Promise<string> {
  // Check if AutoContent API is configured
  if (!isAutoContentConfigured()) {
    return "The podcast feature isn't configured yet. Please set the AUTOCONTENT_API_KEY environment variable to enable daily audio summaries.";
  }

  const lowerText = text.toLowerCase();

  try {
    // Check for Slack message link - create podcast from specific message
    const slackLinkMatch = text.match(/https:\/\/[^\s]+\.slack\.com\/archives\/[A-Z0-9]+\/p\d+/i);
    if (slackLinkMatch) {
      const parsed = parseSlackMessageLink(slackLinkMatch[0]);
      if (parsed) {
        logger.info('Generating podcast from specific message', parsed);

        // Extract custom instructions (everything after the link, or before it)
        let customInstructions: string | undefined;
        const instructionMatch = text.match(/(?:focus(?:ing)? on|about|covering|discussing|highlight(?:ing)?|emphasiz(?:e|ing))[:\s]+(.+?)(?:$|https:)/i);
        if (instructionMatch) {
          customInstructions = instructionMatch[1].trim();
        } else {
          // Try to find instructions after common phrases
          const afterLink = text.slice(text.indexOf(slackLinkMatch[0]) + slackLinkMatch[0].length).trim();
          const beforeLink = text.slice(0, text.indexOf(slackLinkMatch[0])).trim();
          if (afterLink && afterLink.length > 10) {
            customInstructions = afterLink;
          } else if (beforeLink && !beforeLink.toLowerCase().includes('podcast')) {
            customInstructions = beforeLink;
          }
        }

        const result = await generatePodcastFromMessage(
          parsed.channelId,
          parsed.messageTs,
          customInstructions
        );

        if (!result.success || !result.audioUrl) {
          return `I wasn't able to generate a podcast from that message. ${result.error || 'Please try again later.'}`;
        }

        const transcriptPreview = result.transcript
          ? `\n\n**Transcript preview:**\n${result.transcript.slice(0, 500)}${result.transcript.length > 500 ? '...' : ''}`
          : '';

        return `Here's your podcast from the ${result.sourceDescription}:\n\n🎧 **Listen here:** ${result.audioUrl}${transcriptPreview}`;
      }
    }

    // Check for channel reference - create podcast from channel messages
    const channelMatch = text.match(/#([a-z0-9_-]+)/i) || text.match(/(?:from|in|channel)\s+([a-z0-9_-]+)/i);
    if (channelMatch) {
      const channelName = channelMatch[1];
      logger.info('Generating podcast from channel', { channelName });

      // Extract custom instructions
      let customInstructions: string | undefined;
      const instructionMatch = text.match(/(?:focus(?:ing)? on|about|covering|discussing|highlight(?:ing)?|emphasiz(?:e|ing))[:\s]+(.+?)(?:$|#)/i);
      if (instructionMatch) {
        customInstructions = instructionMatch[1].trim();
      }

      // Check for message count
      let messageCount = 50;
      const countMatch = text.match(/(?:last|recent|past)\s+(\d+)\s+messages?/i);
      if (countMatch) {
        messageCount = parseInt(countMatch[1], 10);
      }

      const result = await generatePodcastFromChannel(channelName, {
        customInstructions,
        messageCount,
      });

      if (!result.success || !result.audioUrl) {
        return `I wasn't able to generate a podcast from ${result.sourceDescription}. ${result.error || 'Please try again later.'}`;
      }

      const transcriptPreview = result.transcript
        ? `\n\n**Transcript preview:**\n${result.transcript.slice(0, 500)}${result.transcript.length > 500 ? '...' : ''}`
        : '';

      return `Here's your podcast from ${result.sourceDescription}:\n\n🎧 **Listen here:** ${result.audioUrl}${transcriptPreview}`;
    }

    // Check if they want yesterday's podcast
    if (lowerText.includes('yesterday')) {
      logger.info('Generating podcast for yesterday');
      const result = await generateYesterdaysPodcast();

      if (!result.success || !result.audioUrl) {
        return `I wasn't able to generate yesterday's podcast. ${result.error || 'Please try again later.'}`;
      }

      const transcriptPreview = result.transcript
        ? `\n\n**Transcript preview:**\n${result.transcript.slice(0, 500)}${result.transcript.length > 500 ? '...' : ''}`
        : '';

      return `Here's your audio summary of yesterday's Slack activity (${result.messageCount} messages):\n\n🎧 **Listen here:** ${result.audioUrl}${transcriptPreview}`;
    }

    // Default to today's podcast
    logger.info('Generating podcast for today');
    const result = await generateDailyPodcast();

    if (!result.success || !result.audioUrl) {
      return `I wasn't able to generate today's podcast. ${result.error || 'Please try again later.'}`;
    }

    const transcriptPreview = result.transcript
      ? `\n\n**Transcript preview:**\n${result.transcript.slice(0, 500)}${result.transcript.length > 500 ? '...' : ''}`
      : '';

    return `Here's your audio summary of today's Slack activity (${result.messageCount} messages):\n\n🎧 **Listen here:** ${result.audioUrl}${transcriptPreview}`;
  } catch (error) {
    logger.error('Failed to generate podcast', { error });
    return "I encountered an error while generating the podcast. Please try again later or check the AutoContent API configuration.";
  }
}

async function handleCallCommand(text: string, input: ProcessMessageInput): Promise<string> {
  // Check if Bland AI is configured
  if (!isBlandConfigured()) {
    return "Outbound calling isn't configured yet. Please set the BLAND_API_KEY environment variable to enable phone calls.";
  }

  try {
    // Extract phone number from text
    const phoneNumber = extractPhoneNumber(text);
    if (!phoneNumber) {
      return "I couldn't find a phone number in your request. Please include the phone number you'd like me to call, for example: 'Call +1 555-123-4567 and ask about the project status.'";
    }

    // Extract recipient name if mentioned
    const recipientName = extractRecipientName(text);

    // Extract the task/instructions - everything after common patterns
    let task = text;
    const taskPatterns = [
      /call\s+(?:[^,]+,?\s+)?(?:and\s+)?(.+)/i,
      /phone\s+(?:[^,]+,?\s+)?(?:and\s+)?(.+)/i,
      /dial\s+(?:[^,]+,?\s+)?(?:and\s+)?(.+)/i,
      /to\s+(?:ask|discuss|talk about|inquire about|find out|check on|follow up on)\s+(.+)/i,
    ];

    for (const pattern of taskPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        task = match[1].trim();
        break;
      }
    }

    // If no specific task extracted, use the full text minus the phone number
    if (task === text) {
      task = text.replace(phoneNumber, '').replace(/call|phone|dial|ring/gi, '').trim();
    }

    if (!task || task.length < 5) {
      return `I found the phone number ${phoneNumber}, but I need more specific instructions. What would you like me to discuss or ask about during the call?`;
    }

    logger.info('Initiating call from command', {
      phoneNumber,
      recipientName,
      task: task.slice(0, 100),
    });

    // Initiate the call
    const result = await initiateCall({
      phoneNumber,
      recipientName: recipientName || undefined,
      task,
      requestedBy: input.userId,
      slackChannelId: input.channelId,
      slackThreadTs: input.threadTs,
    });

    if (!result.success) {
      return `I wasn't able to initiate the call. ${result.error || 'Please try again.'}`;
    }

    return `I'm now calling ${recipientName || phoneNumber}. I'll carry out your instructions and report back here when the call is complete.\n\n**Instructions:** ${task}`;
  } catch (error) {
    logger.error('Failed to handle call command', { error });
    return "I encountered an error while trying to initiate the call. Please try again or verify the phone number format.";
  }
}

export async function processDelegatedTaskResponse(
  task: typeof schema.delegatedTasks.$inferSelect,
  message: string,
  userId: string
): Promise<{ message: string; completed: boolean }> {
  logger.info('Processing delegated task response', { taskId: task.id });

  const currentHistory = task.conversationHistory as Array<{
    role: 'saim' | 'direct_report';
    message: string;
    timestamp: string;
  }>;

  // Add the new message to history
  const updatedHistory = [
    ...currentHistory,
    {
      role: 'direct_report' as const,
      message,
      timestamp: new Date().toISOString(),
    },
  ];

  // Get direct report info
  const [directReport] = await db
    .select()
    .from(schema.directReports)
    .where(eq(schema.directReports.id, task.directReportId))
    .limit(1);

  const directReportName = directReport?.name || 'Team Member';
  const directReportFirstName = directReportName.split(' ')[0];

  // Build conversation text for context
  const conversationText = updatedHistory
    .map((h) => `${h.role === 'saim' ? 'Saim' : directReportName}: ${h.message}`)
    .join('\n\n');

  // Extract the core task from the CEO's instruction (remove "reach out to X and" prefixes)
  let coreTask = task.instruction;
  const cleanupPatterns = [
    /^(?:reach out to|contact|ask|message|talk to|check with)\s+(?:my direct report,?\s*)?(?:\w+(?:\s+\w+)?)\s+(?:and\s+)?/i,
    /^(?:can you|please|could you)\s+/i,
  ];
  for (const pattern of cleanupPatterns) {
    coreTask = coreTask.replace(pattern, '');
  }
  // Capitalize first letter
  coreTask = coreTask.charAt(0).toUpperCase() + coreTask.slice(1);

  // Use the task delegation prompt with cleaned instruction
  const systemPrompt = getSystemPrompt('taskDelegation', {
    TASK_INSTRUCTION: coreTask,
  });

  const analysisResponse = await chat(
    systemPrompt,
    [
      {
        role: 'user',
        content: `**Conversation with ${directReportName}:**\n\n${conversationText}\n\nBased on this conversation, determine your next response. Use CONTINUE if you need more information, or COMPLETE if you have everything the CEO asked for.`,
      },
    ],
    { temperature: 0.5 }
  );

  const responseContent = analysisResponse.content;
  logger.info('Task delegation AI response', { response: responseContent.slice(0, 200) });

  // Parse the response - check for COMPLETE first
  const isComplete = responseContent.includes('COMPLETE:');

  if (isComplete) {
    // Extract the closing message and summary
    const completeMatch = responseContent.match(/COMPLETE:\s*(.+?)(?=SUMMARY:|$)/s);
    const summaryMatch = responseContent.match(/SUMMARY:\s*(.+)$/s);

    const closingMessage = completeMatch?.[1]?.trim() ||
      `Thank you, ${directReportFirstName}! I have what I need and will update the CEO.`;
    const summary = summaryMatch?.[1]?.trim() ||
      `Conversation with ${directReportName} regarding: ${task.instruction}`;

    // Update task as completed
    await db
      .update(schema.delegatedTasks)
      .set({
        conversationHistory: [
          ...updatedHistory,
          {
            role: 'saim' as const,
            message: closingMessage,
            timestamp: new Date().toISOString(),
          },
        ],
        status: 'completed',
        summary,
        completedAt: new Date(),
        ceoNotified: true,
      })
      .where(eq(schema.delegatedTasks.id, task.id));

    // Notify CEO of completion
    try {
      const ceoMessage = `**Task Completed: Conversation with ${directReportName}**\n\n` +
        `**Original Request:**\n${task.instruction}\n\n` +
        `**Summary:**\n${summary}`;

      await sendDirectMessage(config.ceoSlackUserId, ceoMessage);
      logger.info('CEO notified of task completion', { taskId: task.id });
    } catch (error) {
      logger.error('Failed to notify CEO of task completion', { taskId: task.id, error });
    }

    return {
      message: closingMessage,
      completed: true,
    };
  } else {
    // Extract the continue message
    const continueMatch = responseContent.match(/CONTINUE:\s*(.+?)$/s);
    let followUp = continueMatch?.[1]?.trim();

    // Fallback if we couldn't parse the format
    if (!followUp) {
      // Try to use the response content directly if it seems like a question
      if (responseContent.includes('?')) {
        followUp = responseContent;
      } else {
        followUp = `Thank you for that information. Could you please provide any additional details about what the CEO asked: "${task.instruction.slice(0, 100)}..."?`;
      }
    }

    // Update history with Saim's response
    const finalHistory = [
      ...updatedHistory,
      {
        role: 'saim' as const,
        message: followUp,
        timestamp: new Date().toISOString(),
      },
    ];

    await db
      .update(schema.delegatedTasks)
      .set({
        conversationHistory: finalHistory,
      })
      .where(eq(schema.delegatedTasks.id, task.id));

    return {
      message: followUp,
      completed: false,
    };
  }
}
