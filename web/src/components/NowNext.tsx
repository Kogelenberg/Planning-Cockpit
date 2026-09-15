import type { CalendarEvent } from '../types';
import { countdownLabel, formatTime } from '../dateUtils';

function EventLine({ event }: { event: CalendarEvent }) {
  return (
    <div className="nownext-event">
      <div className="nownext-time">
        {event.isAllDay ? 'Hele dag' : `${formatTime(event.start)}–${formatTime(event.end)}`}
      </div>
      <div className="nownext-title">{event.title}</div>
      {event.note && <div className="nownext-note">✎ {event.note}</div>}
    </div>
  );
}

export function NowNext({
  current,
  next,
  now,
  onSelect,
}: {
  current: CalendarEvent | null;
  next: CalendarEvent | null;
  now: Date;
  onSelect: (event: CalendarEvent) => void;
}) {
  return (
    <section className="nownext">
      <div className="nownext-card">
        <span className="nownext-label">Nu</span>
        {current ? (
          <button className="nownext-card-button" onClick={() => onSelect(current)}>
            <EventLine event={current} />
          </button>
        ) : (
          <p className="nownext-empty">Geen afspraak</p>
        )}
      </div>
      <div className="nownext-card">
        <span className="nownext-label">Volgende</span>
        {next ? (
          <button className="nownext-card-button" onClick={() => onSelect(next)}>
            <EventLine event={next} />
            <p className="nownext-countdown">{countdownLabel(new Date(next.start), now)}</p>
          </button>
        ) : (
          <p className="nownext-empty">Geen afspraken meer vandaag</p>
        )}
      </div>
    </section>
  );
}
