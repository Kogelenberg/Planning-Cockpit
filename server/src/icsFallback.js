import ical from 'node-ical';
import { config } from './config.js';
import { classifyEvent } from './classify.js';

/**
 * Fallback-route: haalt een ICS/webcal-feed op (iCloud, Google, Exchange, eigen host).
 * Wordt alleen gebruikt als de directe MCP-verbinding structureel faalt en
 * ICS_FEED_URL is geconfigureerd. Geeft hetzelfde genormaliseerde schema terug
 * als de MCP-route, zodat de rest van de app het verschil niet hoeft te weten.
 */
export async function fetchIcsFallback() {
  if (!config.icsFeedUrl) {
    throw new Error('Geen ICS_FEED_URL geconfigureerd');
  }

  const data = await ical.async.fromURL(config.icsFeedUrl);

  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - config.fetchWindowDaysBack);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + config.fetchWindowDaysForward);

  const events = Object.values(data)
    .filter((entry) => entry.type === 'VEVENT' && entry.start)
    .filter((entry) => entry.start >= windowStart && entry.start <= windowEnd)
    .map((entry) => {
      const title = (entry.summary && String(entry.summary).trim()) || 'Afspraak zonder titel';
      const location = entry.location && String(entry.location).trim();
      const event = {
        id: entry.uid || `${title}-${entry.start.toISOString()}`,
        title,
        start: entry.start.toISOString(),
        end: (entry.end || entry.start).toISOString(),
        calendarId: 'ics-feed',
        calendarName: 'Agenda (ICS)',
        isAllDay: Boolean(entry.datetype === 'date'),
      };
      if (location) event.location = location;
      event.type = classifyEvent(event.title, event.location, config);
      return event;
    });

  return {
    events,
    calendars: [{ id: 'ics-feed', name: 'Agenda (ICS)', category: 'personal' }],
    source: 'ics',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
