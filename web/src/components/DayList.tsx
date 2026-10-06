import type { CalendarEvent } from '../types';
import { getEventStatus, formatTime } from '../dateUtils';
import { displayTitle, isDone } from '../eventUtils';
import { TYPE_META } from '../typeMeta';
import { DoneCheck } from './DoneCheck';

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
  isCheckable,
  onToggleDone,
  onSelect,
}: {
  events: CalendarEvent[];
  now: Date;
  nextEventId: string | null;
  isCheckable: (event: CalendarEvent) => boolean;
  onToggleDone: (event: CalendarEvent) => void;
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
        const done = isDone(event);
        const title = displayTitle(event.title);
        const hasDetail = event.rescheduled || event.note;
        return (
          <li key={event.id}>
            <div className={`daylist-row status-${status} ${done ? 'is-done' : ''}`}>
              <div className="daylist-check-slot">
                {isCheckable(event) && <DoneCheck done={done} onToggle={() => onToggleDone(event)} title={title} />}
              </div>
              <button className="daylist-row-body" onClick={() => onSelect(event)}>
                <div className="daylist-row-main">
                  <span className="daylist-time">{event.isAllDay ? 'Hele dag' : formatTime(event.start)}</span>
                  <span className={`daylist-dot ${meta.className}`} title={meta.label} />
                  <span className="daylist-title-group">
                    <span className="daylist-title">{title}</span>
                  </span>
                  <span className={`daylist-status status-pill-${status}`}>{done ? 'Afgerond' : STATUS_LABEL[status]}</span>
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
                  </div>
                )}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
