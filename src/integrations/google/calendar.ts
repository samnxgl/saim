import { getCalendarClient } from './auth.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { calendar_v3 } from 'googleapis';

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
  attendees: Attendee[];
  organizer?: {
    email: string;
    displayName?: string;
    self?: boolean;
  };
  htmlLink?: string;
  status?: string;
}

export interface Attendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  organizer?: boolean;
  self?: boolean;
}

/**
 * Check if calendar integration is configured
 */
export function isCalendarConfigured(): boolean {
  return !!(config.googleServiceAccountEmail && config.googlePrivateKey);
}

/**
 * Get the calendar ID to use
 */
function getCalendarId(): string {
  return config.googleCalendarId || 'primary';
}

/**
 * Convert Google Calendar event to our format
 */
function parseEvent(event: calendar_v3.Schema$Event): CalendarEvent | null {
  if (!event.id || !event.start) return null;

  const start = event.start.dateTime
    ? new Date(event.start.dateTime)
    : event.start.date
      ? new Date(event.start.date)
      : null;

  const end = event.end?.dateTime
    ? new Date(event.end.dateTime)
    : event.end?.date
      ? new Date(event.end.date)
      : start;

  if (!start || !end) return null;

  return {
    id: event.id,
    summary: event.summary || 'No title',
    description: event.description || undefined,
    start,
    end,
    location: event.location || undefined,
    attendees: (event.attendees || []).map((a) => ({
      email: a.email || '',
      displayName: a.displayName || undefined,
      responseStatus: a.responseStatus as Attendee['responseStatus'],
      organizer: a.organizer || false,
      self: a.self || false,
    })),
    organizer: event.organizer
      ? {
          email: event.organizer.email || '',
          displayName: event.organizer.displayName || undefined,
          self: event.organizer.self || false,
        }
      : undefined,
    htmlLink: event.htmlLink || undefined,
    status: event.status || undefined,
  };
}

/**
 * Get events for a date range
 */
export async function getEvents(
  startDate: Date,
  endDate: Date,
  options: { maxResults?: number; singleEvents?: boolean } = {}
): Promise<CalendarEvent[]> {
  if (!isCalendarConfigured()) {
    throw new Error('Google Calendar not configured');
  }

  const calendar = getCalendarClient();
  const calendarId = getCalendarId();

  try {
    const response = await calendar.events.list({
      calendarId,
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      maxResults: options.maxResults || 50,
      singleEvents: options.singleEvents ?? true,
      orderBy: 'startTime',
    });

    const events = (response.data.items || [])
      .map(parseEvent)
      .filter((e): e is CalendarEvent => e !== null);

    logger.info('Retrieved calendar events', {
      count: events.length,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    return events;
  } catch (error) {
    logger.error('Failed to get calendar events', { error });
    throw error;
  }
}

/**
 * Get today's events
 */
export async function getTodayEvents(): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  return getEvents(startOfDay, endOfDay);
}

/**
 * Get upcoming events for the next N hours
 */
export async function getUpcomingEvents(hours: number = 24): Promise<CalendarEvent[]> {
  const now = new Date();
  const future = new Date(now.getTime() + hours * 60 * 60 * 1000);

  return getEvents(now, future);
}

/**
 * Get events starting within a specific time window
 * Useful for finding meetings starting in X hours
 */
export async function getEventsStartingBetween(
  startWindow: Date,
  endWindow: Date
): Promise<CalendarEvent[]> {
  const events = await getEvents(startWindow, endWindow);

  // Filter to only events that START within the window
  return events.filter((event) => {
    return event.start >= startWindow && event.start <= endWindow;
  });
}

/**
 * Get a specific event by ID
 */
export async function getEvent(eventId: string): Promise<CalendarEvent | null> {
  if (!isCalendarConfigured()) {
    throw new Error('Google Calendar not configured');
  }

  const calendar = getCalendarClient();
  const calendarId = getCalendarId();

  try {
    const response = await calendar.events.get({
      calendarId,
      eventId,
    });

    return parseEvent(response.data);
  } catch (error) {
    logger.error('Failed to get calendar event', { eventId, error });
    return null;
  }
}

/**
 * Get events for a specific day
 */
export async function getEventsForDate(date: Date): Promise<CalendarEvent[]> {
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

  return getEvents(startOfDay, endOfDay);
}

/**
 * Get events for the next N days
 */
export async function getEventsForDays(days: number): Promise<CalendarEvent[]> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDate = new Date(startOfToday.getTime() + days * 24 * 60 * 60 * 1000);

  return getEvents(startOfToday, endDate);
}

/**
 * Format event for display
 */
export function formatEventForDisplay(event: CalendarEvent): string {
  const startTime = event.start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const endTime = event.end.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  let display = `**${event.summary}** (${startTime} - ${endTime})`;

  if (event.location) {
    display += `\nLocation: ${event.location}`;
  }

  if (event.attendees.length > 0) {
    const attendeeNames = event.attendees
      .filter((a) => !a.self)
      .map((a) => a.displayName || a.email)
      .slice(0, 5);

    if (attendeeNames.length > 0) {
      display += `\nAttendees: ${attendeeNames.join(', ')}`;
      if (event.attendees.length > 5) {
        display += ` (+${event.attendees.length - 5} more)`;
      }
    }
  }

  return display;
}

/**
 * Get external attendees (non-self, non-organizer domain)
 */
export function getExternalAttendees(event: CalendarEvent, ownDomain?: string): Attendee[] {
  const domain = ownDomain || 'nextgenlearning.com';

  return event.attendees.filter((attendee) => {
    if (attendee.self) return false;
    if (!attendee.email) return false;

    const attendeeDomain = attendee.email.split('@')[1]?.toLowerCase();
    return attendeeDomain && attendeeDomain !== domain.toLowerCase();
  });
}
