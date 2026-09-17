import type { CalendarEvent } from '../types';
import { getEventStatus, formatTime } from '../dateUtils';
import { TYPE_META } from '../typeMeta';

const STATUS_LABEL: Record<string, string> = {
  past: 'Afgelopen',
  current: 'Nu bezig',
  next: 'Volgende',
  upcoming: 'Later',
};

export function DayList({
  events,
  now,
  nextEventId,
  onSelect,
}: {
  events: CalendarEvent[];
  now: Date;
  nextEventId: string | null;
  onSelect: (event: CalendarEvent) => void;
}) {
  if (events.length === 0) {
    return <p className="daylist-empty">Geen afspraken vandaag</p>;
  }

  const sorted = [...events].sort((a, b) => +new Date(a.start) - +new Date(b.start));

  return (
    <ul className="daylist">
      {sorted.map((event) => {
        const status = event.isAllDay ? 'upcoming' : getEventStatus(event, now, nextEventId);
        const meta = TYPE_META[event.type];
        const hasDetail = event.rescheduled || event.note || event.noShowPending;
        return (
          <li key={event.id}>
            <button className={`daylist-row status-${status}`} onClick={() => onSelect(event)}>
              <div className="daylist-row-main">
                <span className="daylist-time">{event.isAllDay ? 'Hele dag' : formatTime(event.start)}</span>
                <span className={`daylist-dot ${meta.className}`} title={meta.label} />
                <span className="daylist-title-group">
                  <span className="daylist-title">{event.title}</span>
                </span>
                <span className={`daylist-status status-pill-${status}`}>{STATUS_LABEL[status]}</span>
              </div>
              {hasDetail && (
                <div className="daylist-row-detail">
                  {event.rescheduled && (
                    <span className="daylist-change daylist-change-reschedule">
                      ↻ Verzet{event.originalStart ? ` — was ${formatTime(event.originalStart)}` : ''}
                      {event.rescheduleReason ? ` (${event.rescheduleReason})` : ''}
                    </span>
                  )}
                  {event.note && <span className="daylist-change daylist-change-note">✎ {event.note}</span>}
                  {event.noShowPending && (
                    <span className="daylist-change daylist-change-noshow">
                      ⏳ Niet doorgegaan — wordt om 17:00 verzet naar morgen
                    </span>
                  )}
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
