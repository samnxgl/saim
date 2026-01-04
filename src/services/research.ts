import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { chat } from '../assistant/claude.js';
import { Attendee, CalendarEvent, formatEventForDisplay } from '../integrations/google/calendar.js';

export interface AttendeeResearch {
  email: string;
  name: string;
  research: string;
  sources?: string[];
  error?: string;
}

export interface MeetingResearch {
  event: CalendarEvent;
  attendeeResearch: AttendeeResearch[];
  meetingContext?: string;
  generatedAt: Date;
}

/**
 * Research a person using web search
 */
async function searchPerson(name: string, email: string): Promise<{ content: string; sources: string[] }> {
  // Extract company from email domain
  const domain = email.split('@')[1];
  const company = domain ? domain.split('.')[0] : null;

  // Build search queries
  const searchQueries = [
    `"${name}" ${company ? company : ''} professional background`,
    `"${name}" LinkedIn ${company ? company : ''}`,
  ];

  // Use OpenAI if available for web search, otherwise use Claude to synthesize
  if (config.openaiApiKey) {
    try {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: config.openaiApiKey });

      // Use OpenAI to search and compile information
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a professional research assistant. Research the following person and provide a concise professional summary.

Focus on:
- Current role and company
- Professional background and expertise
- Notable achievements or projects
- Relevant industry experience
- Any public information about their work style or interests

Be factual and only include information you're confident about. If you can't find information, say so clearly.`,
          },
          {
            role: 'user',
            content: `Research this person for an upcoming meeting:
Name: ${name}
Email: ${email}
${company ? `Company (from email): ${company}` : ''}

Provide a professional briefing that would help prepare for a meeting with them.`,
          },
        ],
        max_tokens: 1000,
        temperature: 0.3,
      });

      return {
        content: response.choices[0]?.message?.content || 'No research results found.',
        sources: [], // OpenAI doesn't provide source URLs directly
      };
    } catch (error) {
      logger.warn('OpenAI research failed, falling back to Claude', { error });
    }
  }

  // Fallback to Claude
  const response = await chat(
    `You are a professional research assistant. Provide a concise professional summary about a meeting attendee.

Focus on what can be reasonably inferred from their name and email domain:
- Likely role based on company
- Company background if recognizable
- Industry context
- Suggested talking points

Be clear about what is factual vs. inferred.`,
    [
      {
        role: 'user',
        content: `Research this meeting attendee:
Name: ${name}
Email: ${email}

Provide helpful context for preparing for a meeting with them.`,
      },
    ],
    { maxTokens: 800, temperature: 0.3 }
  );

  return {
    content: response.content,
    sources: [],
  };
}

/**
 * Research a single attendee
 */
export async function researchAttendee(attendee: Attendee): Promise<AttendeeResearch> {
  const name = attendee.displayName || attendee.email.split('@')[0];

  logger.info('Researching attendee', { name, email: attendee.email });

  try {
    const research = await searchPerson(name, attendee.email);

    return {
      email: attendee.email,
      name,
      research: research.content,
      sources: research.sources,
    };
  } catch (error) {
    logger.error('Failed to research attendee', { email: attendee.email, error });
    return {
      email: attendee.email,
      name,
      research: '',
      error: error instanceof Error ? error.message : 'Research failed',
    };
  }
}

/**
 * Research all external attendees for a meeting
 */
export async function researchMeetingAttendees(
  event: CalendarEvent,
  ownDomain: string = 'nextgenlearning.com'
): Promise<MeetingResearch> {
  logger.info('Researching meeting attendees', {
    eventId: event.id,
    summary: event.summary,
    attendeeCount: event.attendees.length,
  });

  // Get external attendees (not from own domain)
  const externalAttendees = event.attendees.filter((attendee) => {
    if (attendee.self) return false;
    if (!attendee.email) return false;

    const attendeeDomain = attendee.email.split('@')[1]?.toLowerCase();
    return attendeeDomain && attendeeDomain !== ownDomain.toLowerCase();
  });

  // Research each external attendee
  const attendeeResearch: AttendeeResearch[] = [];

  for (const attendee of externalAttendees) {
    const research = await researchAttendee(attendee);
    attendeeResearch.push(research);

    // Small delay between requests to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Generate meeting context summary
  let meetingContext: string | undefined;
  if (attendeeResearch.length > 0 && event.description) {
    try {
      const contextResponse = await chat(
        'You are an executive assistant preparing meeting briefings. Synthesize the meeting details and attendee research into actionable preparation notes.',
        [
          {
            role: 'user',
            content: `Meeting: ${event.summary}
Description: ${event.description || 'No description'}
Time: ${event.start.toLocaleString()}

Attendee Research:
${attendeeResearch.map((r) => `**${r.name}** (${r.email}):\n${r.research}`).join('\n\n')}

Provide 3-5 bullet points of key preparation notes for this meeting.`,
          },
        ],
        { maxTokens: 500, temperature: 0.5 }
      );
      meetingContext = contextResponse.content;
    } catch (error) {
      logger.warn('Failed to generate meeting context', { error });
    }
  }

  return {
    event,
    attendeeResearch,
    meetingContext,
    generatedAt: new Date(),
  };
}

/**
 * Format meeting research for Slack message
 */
export function formatMeetingResearchForSlack(research: MeetingResearch): string {
  const event = research.event;

  const startTime = event.start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  let message = `**Meeting Brief: ${event.summary}**\n`;
  message += `*Starting at ${startTime}*\n\n`;

  if (event.location) {
    message += `📍 **Location:** ${event.location}\n\n`;
  }

  if (research.attendeeResearch.length > 0) {
    message += `👥 **Attendee Research:**\n\n`;

    for (const attendee of research.attendeeResearch) {
      if (attendee.error) {
        message += `• **${attendee.name}** (${attendee.email}): _Research unavailable_\n\n`;
      } else {
        message += `• **${attendee.name}** (${attendee.email}):\n${attendee.research}\n\n`;
      }
    }
  }

  if (research.meetingContext) {
    message += `📝 **Preparation Notes:**\n${research.meetingContext}\n`;
  }

  return message;
}

/**
 * Deep research using AutoContent API (if configured)
 */
export async function deepResearchWithAutoContent(
  topic: string,
  context?: string
): Promise<{ content: string; audioUrl?: string }> {
  if (!config.autoContentApiKey) {
    throw new Error('AutoContent API not configured for deep research');
  }

  const { createPodcast, waitForPodcastCompletion } = await import(
    '../integrations/autocontent/index.js'
  );

  const researchPrompt = `Research and create an informative briefing about: ${topic}

${context ? `Additional context: ${context}` : ''}

Focus on:
- Key background information
- Recent news or developments
- Relevant expertise and achievements
- Potential talking points or areas of common interest`;

  try {
    const createResponse = await createPodcast(
      researchPrompt,
      'Create an informative podcast-style briefing about this person or topic. Make it concise but comprehensive.'
    );

    const requestId = createResponse.request_id || createResponse.contentId;
    if (!requestId) {
      throw new Error('No request ID from AutoContent API');
    }

    const result = await waitForPodcastCompletion(requestId);

    return {
      content: result.transcript || 'Research completed but no transcript available.',
      audioUrl: result.audio_url,
    };
  } catch (error) {
    logger.error('AutoContent deep research failed', { error });
    throw error;
  }
}
