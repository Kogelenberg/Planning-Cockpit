import { config } from './config.js';
import { getState, findEventById } from './eventStore.js';
import { getNoShowPendingIds, setNoShowPending, setRescheduleHistory, getAnnotation } from './annotations.js';
import { queryCalendarItems, modifyCalendarItem } from './mcpClient.js';
import { formatWhenRange } from './whenFormat.js';
import { findFreeSlot } from './freeSlotFinder.js';

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

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

let lastRunDateKey = null;

/** Hooguit één keer per dag, en pas vanaf `config.noShowMoveHour` — zie server/README. */
export function isNoShowMoveDue(now) {
  return now.getHours() >= config.noShowMoveHour && dateKey(now) !== lastRunDateKey;
}

/** Haalt de bestaande afspraken in één agenda op voor één specifieke dag (voor de vrije-plek-check). */
async function fetchBusyIntervalsForDay(calendarId, day) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const response = await queryCalendarItems({ query: '', when: `${fmt(dayStart)} to ${fmt(dayEnd)}` });
  const items = Array.isArray(response) ? response : response.items || [];
  return items
    .filter((item) => item.calendarId === calendarId)
    .map((item) => ({ start: new Date(item.startDate), end: new Date(item.endDate) }));
}

/** Doorzoekt achtereenvolgende dagen (vanaf `fromDay`) tot een vrije plek gevonden is of het maximum bereikt is. */
async function findSlotForEvent(targetCalendarId, fromDay, durationMs) {
  for (let i = 0; i < config.freeSlotMaxDaysAhead; i += 1) {
    const day = addDays(fromDay, i);
    const windowStart = new Date(day);
    windowStart.setHours(config.freeSlotWindowStartHour, 0, 0, 0);
    const windowEnd = new Date(day);
    windowEnd.setHours(config.freeSlotWindowEndHour, 0, 0, 0);
    const busy = await fetchBusyIntervalsForDay(targetCalendarId, day);
    const slotStart = findFreeSlot(busy, windowStart, windowEnd, durationMs);
    if (slotStart) return slotStart;
  }
  return null;
}

/**
 * Verzet alle met "call niet doorgegaan" gevlagde afspraken naar de
 * eerstvolgende tijd (vanaf de dag ná hun huidige geplande dag) die vrij is
 * volgens `config.noShowTargetCalendarName`. Let op: dit is puur een
 * tijd-verzetting via modifyCalendarItem — de afspraak blijft in zijn eigen
 * huidige agenda staan, want Fantastical's MCP kan een item niet naar een
 * andere agenda verplaatsen (geen calendarId-veld op modifyCalendarItem). De
 * doelagenda bepaalt dus alleen "waar moet het vrij zijn", niet "waar komt
 * het te staan". Wordt hooguit één keer per dag uitgevoerd (zie
 * isNoShowMoveDue) en gooit nooit: een individuele mislukking (geen vrije
 * plek gevonden, Fantastical-fout) laat de vlag gewoon staan voor een
 * volgende poging, en blokkeert de andere gevlagde afspraken niet.
 */
export async function runNoShowMove(now) {
  lastRunDateKey = dateKey(now);

  const pendingIds = getNoShowPendingIds();
  if (pendingIds.length === 0) return;

  const targetCalendar = getState().calendars.find(
    (cal) => cal.name.toLowerCase() === config.noShowTargetCalendarName.toLowerCase()
  );
  if (!targetCalendar || !targetCalendar.writable) {
    console.error(
      `[${now.toISOString()}] "Call niet doorgegaan": doelagenda "${config.noShowTargetCalendarName}" niet gevonden of niet schrijfbaar — ${pendingIds.length} afspraak/afspraken blijven gevlagd.`
    );
    return;
  }

  for (const eventId of pendingIds) {
    try {
      const current = findEventById(eventId);
      if (!current) continue;

      const durationMs = new Date(current.end).getTime() - new Date(current.start).getTime();
      const fromDay = addDays(startOfDay(new Date(current.start)), 1);
      const slotStart = await findSlotForEvent(targetCalendar.id, fromDay, durationMs);
      if (!slotStart) {
        console.error(
          `[${now.toISOString()}] "Call niet doorgegaan": geen vrije plek gevonden voor "${current.title}" binnen ${config.freeSlotMaxDaysAhead} dagen — blijft gevlagd voor een volgende poging.`
        );
        continue;
      }

      const slotEnd = new Date(slotStart.getTime() + durationMs);
      await modifyCalendarItem({ id: eventId, when: formatWhenRange(slotStart, slotEnd) });

      const existing = getAnnotation(eventId);
      const originalStart = existing?.history?.originalStart || current.start;
      const originalEnd = existing?.history?.originalEnd || current.end;
      setRescheduleHistory(eventId, {
        originalStart,
        originalEnd,
        reason: 'Call niet doorgegaan — automatisch verplaatst',
      });
      setNoShowPending(eventId, false);
    } catch (err) {
      console.error(`[${now.toISOString()}] "Call niet doorgegaan": verplaatsen van ${eventId} mislukt:`, err.message);
    }
  }
}
