import type { CalendarEvent } from '../types';
import { countdownLabel, formatTime } from '../dateUtils';
import { displayTitle, isDone } from '../eventUtils';
import { DoneCheck } from './DoneCheck';

function EventLine({ event }: { event: CalendarEvent }) {
  return (
    <div className="nownext-event">
      <div className="nownext-time">
        {event.isAllDay ? 'Hele dag' : `${formatTime(event.start)}–${formatTime(event.end)}`}
      </div>
      <div className="nownext-title">{displayTitle(event.title)}</div>
      {event.note && <div className="nownext-note">✎ {event.note}</div>}
    </div>
  );
}

export function NowNext({
  current,
  next,
  afterNext,
  now,
  isCheckable,
  onToggleDone,
  onSelect,
}: {
  current: CalendarEvent | null;
  next: CalendarEvent | null;
  afterNext: CalendarEvent | null;
  now: Date;
  isCheckable: (event: CalendarEvent) => boolean;
  onToggleDone: (event: CalendarEvent) => void;
  onSelect: (event: CalendarEvent) => void;
}) {
  function renderCard(label: string, event: CalendarEvent | null, emptyText: string, showCountdown: boolean) {
    return (
      <div className={`nownext-card ${event && isDone(event) ? 'is-done' : ''}`}>
        <span className="nownext-label">{label}</span>
        {event ? (
          <div className="nownext-row">
            {isCheckable(event) && (
              <DoneCheck done={isDone(event)} onToggle={() => onToggleDone(event)} title={displayTitle(event.title)} />
            )}
            <button className="nownext-card-button" onClick={() => onSelect(event)}>
              <EventLine event={event} />
              {showCountdown && <p className="nownext-countdown">{countdownLabel(new Date(event.start), now)}</p>}
            </button>
          </div>
        ) : (
          <p className="nownext-empty">{emptyText}</p>
        )}
      </div>
    );
  }

  return (
    <section className="nownext">
      {renderCard('Nu', current, 'Geen afspraak', false)}
      {renderCard('Volgende', next, 'Geen afspraken meer vandaag', true)}
      {renderCard('Daarna', afterNext, 'Geen afspraken meer vandaag', true)}
    </section>
  );
}
