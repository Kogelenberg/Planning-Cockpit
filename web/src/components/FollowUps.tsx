import type { CalendarEvent } from '../types';
import { TYPE_META } from '../typeMeta';

const dayFormatter = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
const timeFormatter = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });

export function FollowUps({ events, onSelect }: { events: CalendarEvent[]; onSelect: (event: CalendarEvent) => void }) {
  return (
    <ul className="followups">
      {events.map((event) => {
        const meta = TYPE_META[event.type];
        const start = new Date(event.start);
        return (
          <li key={event.id}>
            <button
              className="followups-row"
              onClick={() => onSelect(event)}
              title={event.note ? `${event.title} — ${event.note}` : event.title}
            >
              <div className="followups-row-main">
                <span className={`daylist-dot ${meta.className}`} title={meta.label} />
                <span className="followups-title">{event.title}</span>
                <span className="followups-when">
                  {dayFormatter.format(start)} · {timeFormatter.format(start)}
                </span>
              </div>
              {event.note && <span className="followups-note">✎ {event.note}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
