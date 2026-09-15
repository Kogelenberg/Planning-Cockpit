import type { CalendarEvent } from './types';

export interface PlacedEvent {
  event: CalendarEvent;
  column: number;
  totalColumns: number;
}

/**
 * Plaatst overlappende afspraken naast elkaar in kolommen (nooit over elkaar heen).
 * Events die transitief overlappen vormen een "cluster" en delen dezelfde
 * kolombreedte, zodat het blokkenpatroon rustig oogt in plaats van steeds
 * van breedte te wisselen.
 */
export function layoutTimeline(events: CalendarEvent[]): PlacedEvent[] {
  const sorted = [...events].sort(
    (a, b) => +new Date(a.start) - +new Date(b.start) || +new Date(a.end) - +new Date(b.end)
  );

  const active: PlacedEvent[] = [];
  let clusterMembers: PlacedEvent[] = [];
  let clusterMaxColumns = 0;
  const result: PlacedEvent[] = [];

  const flushCluster = () => {
    for (const member of clusterMembers) {
      member.totalColumns = clusterMaxColumns;
      result.push(member);
    }
    clusterMembers = [];
    clusterMaxColumns = 0;
  };

  for (const event of sorted) {
    const start = +new Date(event.start);

    for (let i = active.length - 1; i >= 0; i--) {
      if (+new Date(active[i].event.end) <= start) active.splice(i, 1);
    }
    if (active.length === 0 && clusterMembers.length > 0) {
      flushCluster();
    }

    const usedColumns = new Set(active.map((p) => p.column));
    let column = 0;
    while (usedColumns.has(column)) column++;

    const placed: PlacedEvent = { event, column, totalColumns: 1 };
    active.push(placed);
    clusterMembers.push(placed);
    clusterMaxColumns = Math.max(clusterMaxColumns, active.length);
  }
  flushCluster();

  return result;
}
