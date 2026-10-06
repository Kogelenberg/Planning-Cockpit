import { config } from './config.js';
import { getState, wasDoneToggledRecently } from './eventStore.js';
import { getAnnotation, setRescheduleHistory } from './annotations.js';
import { queryCalendarItems, modifyCalendarItem } from './mcpClient.js';
import { normalizeCalendarItem } from './normalize.js';
import { formatWhenRange } from './whenFormat.js';
import { findFreeSlot } from './freeSlotFinder.js';
import { isAutoMovableEvent, isDoneTitle } from './classify.js';
import { getUitwerkenBlockByEventId, markUitwerkenMovedAway } from './companionState.js';

const RETRY_AFTER_MS = 30 * 60 * 1000;
const RECENTLY_MOVED_MS = 10 * 60 * 1000;

const lastFailureAt = new Map();
const recentlyMovedAt = new Map();
let running = false;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isWeekend(date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

function localDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sameLocalDay(a, b) {
  return localDate(a) === localDate(b);
}

/**
 * Vanaf wanneer een niet-afgevinkte afspraak verplaatst mag worden: vanaf
 * `config.autoMoveHour` op de dag zelf, maar nooit eerder dan
 * `config.autoMoveGraceMinutes` na het einde van de afspraak (zodat een
 * afspraak die pas 's avonds eindigt nog afgevinkt kan worden).
 */
function movableFrom(event) {
  const end = new Date(event.end);
  const atMoveHour = startOfDay(new Date(event.start));
  atMoveHour.setHours(config.autoMoveHour, 0, 0, 0);
  const afterGrace = new Date(end.getTime() + config.autoMoveGraceMinutes * 60000);
  return new Date(Math.max(atMoveHour.getTime(), afterGrace.getTime()));
}

/**
 * Welke afspraken nu verplaatst moeten worden: van vandaag, in een schrijfbare
 * agenda, niet afgevinkt, van een soort die automatisch mag (zie
 * isAutoMovableEvent in classify.js) en waarvan het moment hierboven bereikt is.
 */
export function findMovableEvents(events, calendars, now) {
  const writableIds = new Set(calendars.filter((c) => c.writable).map((c) => c.id));
  return events.filter((event) => {
    if (!writableIds.has(event.calendarId)) return false;
    if (event.isAllDay) return false;
    if (isDoneTitle(event.title, config)) return false;
    if (!isAutoMovableEvent(event, config)) return false;
    if (!sameLocalDay(new Date(event.start), now)) return false;
    return now >= movableFrom(event);
  });
}

/**
 * Bezette intervallen in één agenda op één dag. Gebruikt, net als de gewone
 * ophaalronde (calendarService.js), zowel een lege zoekterm als een spatie en
 * voegt die samen, want elk van beide mist afzonderlijk structureel afspraken.
 * Hele-dag-items tellen niet mee als bezet, anders zou een verjaardag de hele
 * dag "vol" maken.
 */
async function fetchBusyIntervalsForDay(calendarId, day) {
  const when = localDate(day);
  const byId = new Map();
  for (const query of ['', ' ']) {
    const response = await queryCalendarItems({ query, when });
    const items = Array.isArray(response) ? response : response.items || [];
    for (const item of items) byId.set(item.id, item);
  }
  return Array.from(byId.values())
    .filter((item) => item.calendarId === calendarId)
    .map((item) => normalizeCalendarItem(item, new Map()))
    .filter((item) => !item.isAllDay)
    .map((item) => ({ start: new Date(item.start), end: new Date(item.end) }));
}

/** Zoekt vanaf `fromDay` de eerste werkdag met een vrije plek (maximaal `freeSlotMaxDaysAhead` werkdagen). */
export async function findSlotForEvent(calendarId, fromDay, durationMs) {
  let checked = 0;
  for (let i = 0; checked < config.freeSlotMaxDaysAhead && i < config.freeSlotMaxDaysAhead * 3; i += 1) {
    const day = addDays(fromDay, i);
    if (isWeekend(day)) continue;
    checked += 1;
    const windowStart = new Date(day);
    windowStart.setHours(config.freeSlotWindowStartHour, 0, 0, 0);
    const windowEnd = new Date(day);
    windowEnd.setHours(config.freeSlotWindowEndHour, 0, 0, 0);
    const busy = await fetchBusyIntervalsForDay(calendarId, day);
    const slotStart = findFreeSlot(busy, windowStart, windowEnd, durationMs);
    if (slotStart) return slotStart;
  }
  return null;
}

/**
 * Verplaatst alle niet-afgevinkte, verplaatsbare afspraken van vandaag naar de
 * eerste vrije plek van de eerstvolgende werkdag, in dezelfde agenda als de
 * afspraak zelf (Fantastical's MCP kan een item niet naar een andere agenda
 * zetten). Geeft het aantal verplaatste afspraken terug. Gooit nooit, en
 * draait nooit twee keer tegelijk. Een afspraak waarvoor geen plek gevonden
 * wordt (of waarbij Fantastical een fout geeft) wordt pas na
 * RETRY_AFTER_MS opnieuw geprobeerd, zodat dit niet elke paar seconden
 * Fantastical blijft belasten.
 */
export async function runAutoMove(now = new Date()) {
  if (!config.autoMoveEnabled || running) return 0;
  running = true;
  let moved = 0;
  try {
    const { events, calendars } = getState();
    const candidates = findMovableEvents(events, calendars, now).filter((event) => {
      const failedAt = lastFailureAt.get(event.id);
      if (failedAt && now.getTime() - failedAt < RETRY_AFTER_MS) return false;
      const movedAt = recentlyMovedAt.get(event.id);
      if (movedAt && now.getTime() - movedAt < RECENTLY_MOVED_MS) return false;
      if (wasDoneToggledRecently(event.id)) return false;
      return true;
    });

    for (const event of candidates) {
      try {
        const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime();
        const fromDay = addDays(startOfDay(new Date(event.start)), 1);
        const slotStart = await findSlotForEvent(event.calendarId, fromDay, durationMs);
        if (!slotStart) {
          lastFailureAt.set(event.id, now.getTime());
          console.error(
            `[${now.toISOString()}] Automatisch verplaatsen: geen vrije plek gevonden voor "${event.title}" binnen ${config.freeSlotMaxDaysAhead} werkdagen.`
          );
          continue;
        }

        const slotEnd = new Date(slotStart.getTime() + durationMs);
        await modifyCalendarItem({ id: event.id, when: formatWhenRange(slotStart, slotEnd) });
        recentlyMovedAt.set(event.id, now.getTime());

        const existing = getAnnotation(event.id);
        setRescheduleHistory(event.id, {
          originalStart: existing?.history?.originalStart || event.start,
          originalEnd: existing?.history?.originalEnd || event.end,
          reason: 'Niet afgevinkt — automatisch verplaatst',
        });

        // Een verplaatst "Uitwerken"-blok mag door de hulp-blokken-automatisering
        // niet terug naar zijn oude dag gezet of opnieuw aangemaakt worden.
        const uitwerken = getUitwerkenBlockByEventId(event.id);
        if (uitwerken) markUitwerkenMovedAway(uitwerken.key);

        moved += 1;
      } catch (err) {
        lastFailureAt.set(event.id, now.getTime());
        console.error(`[${now.toISOString()}] Automatisch verplaatsen van "${event.title}" mislukt:`, err.message);
      }
    }
  } catch (err) {
    console.error(`[${now.toISOString()}] Automatisch verplaatsen mislukt:`, err.message);
  } finally {
    running = false;
  }
  return moved;
}
