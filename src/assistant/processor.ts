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
import { sendDirectMessage } from '../integrations/slack/client.js';

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
    const commandResult = await handleCEOCommands(input.text, fullContext);
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
  context: Awaited<ReturnType<typeof buildFullContext>>
): Promise<string | null> {
  const lowerText = text.toLowerCase();

  // Handle delegation command
  if (lowerText.startsWith('delegate to ') || lowerText.startsWith('ask ')) {
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

  return null;
}

async function handleDelegation(
  text: string,
  context: Awaited<ReturnType<typeof buildFullContext>>
): Promise<string> {
  // Parse the delegation command
  // Expected formats:
  // "Delegate to [Name]: [instruction]"
  // "Ask [Name] to [instruction]"

  const delegateMatch = text.match(/(?:delegate to|ask)\s+(\w+(?:\s+\w+)?)[:\s]+(.+)/i);

  if (!delegateMatch) {
    return "I couldn't parse that delegation request. Please use the format: 'Delegate to [Name]: [instruction]' or 'Ask [Name] to [instruction]'";
  }

  const [, targetName, instruction] = delegateMatch;

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

  // Send initial message to the direct report
  const initialMessage = `Hi ${directReport.name.split(' ')[0]}, I'm reaching out on behalf of the CEO. ${instruction}\n\nPlease respond here when you have a moment.`;

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

  // Determine if we need to continue the conversation or wrap up
  const conversationText = updatedHistory
    .map((h) => `${h.role === 'saim' ? 'Saim' : directReport?.name || 'Team Member'}: ${h.message}`)
    .join('\n\n');

  const systemPrompt = getSystemPrompt('taskDelegation', {
    TASK_INSTRUCTION: task.instruction,
  });

  const analysisResponse = await chat(
    systemPrompt,
    [
      {
        role: 'user',
        content: `Here is the conversation so far:\n\n${conversationText}\n\nBased on the original task and this conversation, should we continue gathering information or is the task complete? If continuing, what should we ask next? If complete, prepare the summary for the CEO.`,
      },
    ],
    { temperature: 0.5 }
  );

  // Check if the task seems complete
  const isComplete = analysisResponse.content.toLowerCase().includes('task complete') ||
    analysisResponse.content.toLowerCase().includes('summary for the ceo');

  if (isComplete) {
    // Generate summary
    const summaryResponse = await chat(
      'You are preparing a concise summary for the CEO. Summarize the key findings and any action items.',
      [
        {
          role: 'user',
          content: `Task: ${task.instruction}\n\nConversation:\n${conversationText}\n\nProvide a brief summary for the CEO.`,
        },
      ],
      { temperature: 0.3 }
    );

    // Update task as completed
    await db
      .update(schema.delegatedTasks)
      .set({
        conversationHistory: updatedHistory,
        status: 'completed',
        summary: summaryResponse.content,
        completedAt: new Date(),
      })
      .where(eq(schema.delegatedTasks.id, task.id));

    // TODO: Notify CEO of completion

    return {
      message: `Thank you, ${directReport?.name.split(' ')[0] || 'team member'}! I have what I need and will update the CEO.`,
      completed: true,
    };
  } else {
    // Extract follow-up question from analysis
    const followUpMatch = analysisResponse.content.match(/(?:ask|follow.?up|next question)[:\s]*(.+)/i);
    const followUp = followUpMatch
      ? followUpMatch[1].trim()
      : 'Could you provide any additional details?';

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
