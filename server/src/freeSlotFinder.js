/**
 * Zoekt de eerstvolgende vrije plek van minstens `durationMs` binnen
 * [windowStart, windowEnd] van één dag, gegeven de al bezette intervallen in
 * die agenda op die dag (elk `{ start: Date, end: Date }`, niet per se
 * gesorteerd of al binnen het venster). Geeft de starttijd van de eerste
 * passende plek terug, of `null` als er geen plek past.
 *
 * Pure functie, los van Fantastical/MCP, zodat de kernlogica zonder een
 * live agenda-verbinding getest kan worden.
 */
export function findFreeSlot(busyIntervals, windowStart, windowEnd, durationMs) {
  const clamped = busyIntervals
    .map((iv) => ({
      start: iv.start < windowStart ? windowStart : iv.start,
      end: iv.end > windowEnd ? windowEnd : iv.end,
    }))
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Overlappende/aangrenzende intervallen samenvoegen, anders klopt de
  // gat-berekening hieronder niet.
  const merged = [];
  for (const iv of clamped) {
    const last = merged[merged.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end.getTime() > last.end.getTime()) last.end = iv.end;
    } else {
      merged.push({ ...iv });
    }
  }

  let cursor = windowStart;
  for (const busy of merged) {
    if (busy.start.getTime() - cursor.getTime() >= durationMs) {
      return cursor;
    }
    if (busy.end.getTime() > cursor.getTime()) cursor = busy.end;
  }
  if (windowEnd.getTime() - cursor.getTime() >= durationMs) {
    return cursor;
  }
  return null;
}
