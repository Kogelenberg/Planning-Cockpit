import { queryCalendars, queryCalendarItems, resetMcpConnection } from './mcpClient.js';
import { normalizeCalendarItem } from './normalize.js';
import { classifyEvent } from './classify.js';
import { fetchIcsFallback } from './icsFallback.js';
import { config } from './config.js';

function categorize(calendarName) {
  const name = (calendarName || '').trim().toLowerCase();
  if (config.calendarCategories.work.some((n) => n.toLowerCase() === name)) return 'work';
  if (config.calendarCategories.personal.some((n) => n.toLowerCase() === name)) return 'personal';
  return 'personal';
}

function isAllowedCalendarName(name) {
  const normalized = (name || '').trim().toLowerCase();
  return config.allowedCalendarNames.some((allowed) => allowed.toLowerCase() === normalized);
}

/**
 * Harde toegangspoort: alles wat hier niet doorheen komt, bestaat voor de rest
 * van de app niet — geen "verborgen maar wel opgehaald", écht nooit in het
 * geheugen of op schijf. Wordt toegepast op zowel de MCP- als de ICS-route,
 * zodat de beperking niet per ophaalpad apart onderhouden hoeft te worden.
 */
function applyCalendarAllowlist({ events, calendars, source, timezone }) {
  const allowedCalendars = calendars.filter((cal) => isAllowedCalendarName(cal.name));
  const allowedIds = new Set(allowedCalendars.map((cal) => cal.id));
  const allowedEvents = events.filter((event) => allowedIds.has(event.calendarId));
  return { events: allowedEvents, calendars: allowedCalendars, source, timezone };
}

function windowWhenString() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - config.fetchWindowDaysBack);
  const end = new Date(now);
  end.setDate(end.getDate() + config.fetchWindowDaysForward);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return `${fmt(start)} to ${fmt(end)}`;
}

async function fetchViaMcp() {
  const [calendars, itemsResponse] = await Promise.all([
    queryCalendars(),
    queryCalendarItems({ query: '', when: windowWhenString() }),
  ]);

  const calendarNameById = new Map(calendars.map((cal) => [cal.id, cal.title]));
  const rawItems = Array.isArray(itemsResponse) ? itemsResponse : itemsResponse.items || [];

  const events = rawItems.map((raw) => {
    const normalized = normalizeCalendarItem(raw, calendarNameById);
    normalized.type = classifyEvent(normalized.title, normalized.location, config);
    return normalized;
  });

  return {
    events,
    calendars: calendars.map((cal) => ({ id: cal.id, name: cal.title, category: categorize(cal.title) })),
    source: 'mcp',
    timezone: (!Array.isArray(itemsResponse) && itemsResponse.timezone) || 'Europe/Amsterdam',
  };
}

/** Haalt de actuele agenda-status op: MCP eerst, met ICS als enige fallback-route. */
export async function fetchCalendarState() {
  let result;
  try {
    result = await fetchViaMcp();
  } catch (mcpError) {
    await resetMcpConnection();
    if (!config.icsFeedUrl) {
      throw mcpError;
    }
    try {
      result = await fetchIcsFallback();
    } catch (icsError) {
      throw new Error(
        `MCP-verbinding mislukt (${mcpError.message}) en ICS-fallback mislukte ook (${icsError.message})`
      );
    }
  }
  return applyCalendarAllowlist(result);
}
