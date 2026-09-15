/**
 * Zet een ruw item van de Fantastical MCP-server om naar het vaste dashboard-schema.
 * Velden die Fantastical niet levert (notes, attendees, phoneNumber, url) worden
 * gewoon weggelaten in plaats van als undefined/null doorgegeven.
 */
export function normalizeCalendarItem(raw, calendarNameById) {
  const event = {
    id: raw.id,
    title: cleanTitle(raw.title),
    start: raw.startDate,
    end: raw.endDate,
    calendarId: raw.calendarId,
    calendarName: calendarNameById.get(raw.calendarId) || 'Onbekende agenda',
    isAllDay: computeIsAllDay(raw.startDate, raw.endDate),
  };

  const location = raw.location && String(raw.location).trim();
  if (location) {
    event.location = location;
  }

  return event;
}

function cleanTitle(title) {
  // Sommige titels bevatten losse regeleinden (bv. geplakte adresgegevens);
  // die platslaan zodat de UI altijd een enkele regel tekst krijgt.
  const collapsed = title && String(title).replace(/\s+/g, ' ').trim();
  return collapsed || 'Afspraak zonder titel';
}

function computeIsAllDay(startISO, endISO) {
  if (!startISO || !endISO) return false;
  const startsAtMidnight = /T00:00:00/.test(startISO);
  const endsAtMidnight = /T00:00:00/.test(endISO);
  if (!startsAtMidnight || !endsAtMidnight) return false;
  const durationMs = new Date(endISO).getTime() - new Date(startISO).getTime();
  return durationMs >= 20 * 60 * 60 * 1000;
}
