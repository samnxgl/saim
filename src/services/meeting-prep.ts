import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { sendDirectMessage } from '../integrations/slack/client.js';
import {
  isCalendarConfigured,
  getEventsStartingBetween,
  CalendarEvent,
  getExternalAttendees,
} from '../integrations/google/calendar.js';
import {
  researchMeetingAttendees,
  formatMeetingResearchForSlack,
} from './research.js';

// Track which meetings we've already sent research for (in-memory for simplicity)
const processedMeetings = new Set<string>();

/**
 * Check for upcoming meetings that need research and send briefings
 * This should be called periodically (e.g., every 15 minutes)
 */
export async function checkUpcomingMeetingsForResearch(): Promise<void> {
  if (!isCalendarConfigured()) {
    logger.debug('Calendar not configured, skipping meeting prep');
    return;
  }

  logger.info('Checking for upcoming meetings needing research');

  try {
    // Look for meetings starting in 1.75 to 2.25 hours from now
    // This gives a 30-minute window to catch meetings when running every 15 mins
    const now = new Date();
    const windowStart = new Date(now.getTime() + 1.75 * 60 * 60 * 1000); // 1h 45m from now
    const windowEnd = new Date(now.getTime() + 2.25 * 60 * 60 * 1000); // 2h 15m from now

    const upcomingEvents = await getEventsStartingBetween(windowStart, windowEnd);

    logger.info('Found upcoming events in window', {
      count: upcomingEvents.length,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });

    for (const event of upcomingEvents) {
      await processMeetingForResearch(event);
    }
  } catch (error) {
    logger.error('Error checking upcoming meetings', { error });
  }
}

/**
 * Process a single meeting for research
 */
async function processMeetingForResearch(event: CalendarEvent): Promise<void> {
  // Skip if we've already processed this meeting
  const meetingKey = `${event.id}-${event.start.toISOString()}`;
  if (processedMeetings.has(meetingKey)) {
    logger.debug('Meeting already processed', { eventId: event.id });
    return;
  }

  // Skip cancelled meetings
  if (event.status === 'cancelled') {
    return;
  }

  // Check for external attendees
  const externalAttendees = getExternalAttendees(event);

  if (externalAttendees.length === 0) {
    logger.debug('No external attendees to research', {
      eventId: event.id,
      summary: event.summary,
    });
    // Mark as processed even if no research needed
    processedMeetings.add(meetingKey);
    return;
  }

  logger.info('Processing meeting for research', {
    eventId: event.id,
    summary: event.summary,
    externalAttendees: externalAttendees.length,
  });

  try {
    // Research attendees
    const research = await researchMeetingAttendees(event);

    // Format and send to CEO
    const message = formatMeetingResearchForSlack(research);

    await sendDirectMessage(config.ceoSlackUserId, message);

    logger.info('Meeting research sent to CEO', {
      eventId: event.id,
      summary: event.summary,
    });

    // Mark as processed
    processedMeetings.add(meetingKey);

    // Clean up old entries (keep last 100)
    if (processedMeetings.size > 100) {
      const entries = Array.from(processedMeetings);
      entries.slice(0, entries.length - 100).forEach((e) => processedMeetings.delete(e));
    }
  } catch (error) {
    logger.error('Failed to process meeting research', {
      eventId: event.id,
      error,
    });
  }
}

/**
 * Manually trigger research for a specific meeting
 */
export async function researchMeetingById(eventId: string): Promise<string> {
  if (!isCalendarConfigured()) {
    return 'Calendar integration is not configured.';
  }

  try {
    const { getEvent } = await import('../integrations/google/calendar.js');
    const event = await getEvent(eventId);

    if (!event) {
      return 'Meeting not found.';
    }

    const externalAttendees = getExternalAttendees(event);

    if (externalAttendees.length === 0) {
      return `No external attendees found for "${event.summary}". Only internal team members are attending.`;
    }

    const research = await researchMeetingAttendees(event);
    return formatMeetingResearchForSlack(research);
  } catch (error) {
    logger.error('Failed to research meeting', { eventId, error });
    return `Failed to research meeting: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Research attendees for the next meeting with external participants
 */
export async function researchNextExternalMeeting(): Promise<string> {
  if (!isCalendarConfigured()) {
    return 'Calendar integration is not configured.';
  }

  try {
    const { getUpcomingEvents } = await import('../integrations/google/calendar.js');
    const events = await getUpcomingEvents(48); // Look ahead 48 hours

    // Find first meeting with external attendees
    for (const event of events) {
      const externalAttendees = getExternalAttendees(event);
      if (externalAttendees.length > 0) {
        const research = await researchMeetingAttendees(event);
        return formatMeetingResearchForSlack(research);
      }
    }

    return 'No upcoming meetings with external attendees found in the next 48 hours.';
  } catch (error) {
    logger.error('Failed to research next external meeting', { error });
    return `Failed to research meetings: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
