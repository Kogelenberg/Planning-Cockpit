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

function windowRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - config.fetchWindowDaysBack);
  const end = new Date(now);
  end.setDate(end.getDate() + config.fetchWindowDaysForward);
  return { start, end };
}

/**
 * Splitst het volledige ophaalvenster (nu -2 tot nu +35 dagen, standaard) op
 * in kleinere stukken van elk hoogstens `chunkDays` dagen. Bevestigd via
 * handmatig testen: Fantastical's queryCalendarItems mist afspraken zodra het
 * opgevraagde venster te breed is (~37 dagen), ongeacht de zoekterm — hetzelfde
 * item wordt wel gevonden bij een venster van een paar dagen. Door in kleinere
 * stukken op te vragen en samen te voegen blijft elk deelvenster klein genoeg
 * om betrouwbaar te zijn.
 */
function windowChunks(chunkDays = 7) {
  const { start, end } = windowRange();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const chunks = [];
  let chunkStart = new Date(start);
  while (chunkStart < end) {
    const chunkEnd = new Date(chunkStart);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    chunks.push(`${fmt(chunkStart)} to ${fmt(chunkEnd)}`);
    chunkStart = chunkEnd;
  }
  return chunks;
}

async function fetchViaMcp() {
  // Fantastical's queryCalendarItems met een lege zoekterm mist structureel
  // sommige afspraken, en een zoekterm van één spatie mist weer titels van één
  // woord zonder spatie — dus we vragen per deelvenster beide op. Bovendien
  // mist Fantastical afspraken zodra het venster te breed is, dus we vragen
  // per week op in plaats van in één keer over de hele ~37 dagen. Alle
  // resultaten worden samengevoegd op id, dat dekt alle drie de zwaktes af.
  const chunks = windowChunks();
  const itemQueries = [];
  for (const when of chunks) {
    itemQueries.push(queryCalendarItems({ query: '', when }));
    itemQueries.push(queryCalendarItems({ query: ' ', when }));
  }

  const [calendars, ...itemResponses] = await Promise.all([queryCalendars(), ...itemQueries]);

  const calendarNameById = new Map(calendars.map((cal) => [cal.id, cal.title]));
  const itemById = new Map();
  let sampleResponse = null;
  for (const response of itemResponses) {
    if (!sampleResponse) sampleResponse = response;
    const items = Array.isArray(response) ? response : response.items || [];
    for (const item of items) {
      itemById.set(item.id, item);
    }
  }
  const rawItems = Array.from(itemById.values());

  const events = rawItems.map((raw) => {
    const normalized = normalizeCalendarItem(raw, calendarNameById);
    normalized.type = classifyEvent(normalized.title, normalized.location, config);
    return normalized;
  });

  return {
    events,
    calendars: calendars.map((cal) => ({
      id: cal.id,
      name: cal.title,
      category: categorize(cal.title),
      // Fantastical's eigen isWritable-vlag (bv. false voor een gedeelde/
      // geabonneerde agenda zoals "Hogeschool Utrecht") — bepaalt welke
      // agenda's als doel voor een nieuwe afspraak aangeboden worden.
      writable: Boolean(cal.isWritable),
    })),
    source: 'mcp',
    timezone: (sampleResponse && !Array.isArray(sampleResponse) && sampleResponse.timezone) || 'Europe/Amsterdam',
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
