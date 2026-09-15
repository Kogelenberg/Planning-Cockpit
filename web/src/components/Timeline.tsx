import { useMemo } from 'react';
import type { CalendarEvent } from '../types';
import { layoutTimeline } from '../timelineLayout';
import { formatTime } from '../dateUtils';
import { TYPE_META } from '../typeMeta';

interface TimelineProps {
  events: CalendarEvent[];
  now: Date;
  onSelect: (event: CalendarEvent) => void;
}

// Vast rollend venster rond "nu" i.p.v. de hele dag met scrollbalk: "nu" staat
// altijd op een derde van de hoogte, zodat je nooit hoeft te scrollen om te
// zien wat je net had en wat er nog aankomt. Het venster schuift continu mee
// met de klok (elke render, dus elke seconde).
const PAST_WINDOW_MINUTES = 60;
const FUTURE_WINDOW_MINUTES = 120;
const TOTAL_WINDOW_MINUTES = PAST_WINDOW_MINUTES + FUTURE_WINDOW_MINUTES;
const NOW_LINE_PERCENT = (PAST_WINDOW_MINUTES / TOTAL_WINDOW_MINUTES) * 100;
const MIN_BLOCK_HEIGHT_PERCENT = 4;
const MIN_COLUMN_WIDTH = 108;

function nextHourMarks(windowStart: Date, windowEnd: Date): Date[] {
  const marks: Date[] = [];
  const first = new Date(windowStart);
  first.setMinutes(0, 0, 0);
  if (first < windowStart) first.setHours(first.getHours() + 1);
  for (const t = new Date(first); t <= windowEnd; t.setHours(t.getHours() + 1)) {
    marks.push(new Date(t));
  }
  return marks;
}

export function Timeline({ events, now, onSelect }: TimelineProps) {
  const allDayEvents = useMemo(() => events.filter((e) => e.isAllDay), [events]);
  const timedEvents = useMemo(() => events.filter((e) => !e.isAllDay), [events]);

  const windowStart = useMemo(() => new Date(now.getTime() - PAST_WINDOW_MINUTES * 60000), [now]);
  const windowEnd = useMemo(() => new Date(now.getTime() + FUTURE_WINDOW_MINUTES * 60000), [now]);
  const totalMs = TOTAL_WINDOW_MINUTES * 60000;

  function percentFor(date: Date) {
    return ((date.getTime() - windowStart.getTime()) / totalMs) * 100;
  }

  const visibleEvents = useMemo(
    () => timedEvents.filter((e) => new Date(e.end) > windowStart && new Date(e.start) < windowEnd),
    [timedEvents, windowStart, windowEnd]
  );

  const placed = useMemo(() => layoutTimeline(visibleEvents), [visibleEvents]);
  const maxColumns = useMemo(() => placed.reduce((max, p) => Math.max(max, p.totalColumns), 1), [placed]);
  const gridMinWidth = maxColumns * MIN_COLUMN_WIDTH;

  const hourMarks = useMemo(() => nextHourMarks(windowStart, windowEnd), [windowStart, windowEnd]);

  return (
    <div className="timeline">
      {allDayEvents.length > 0 && (
        <div className="timeline-allday">
          {allDayEvents.map((event) => {
            const meta = TYPE_META[event.type];
            return (
              <button key={event.id} className={`allday-chip ${meta.className}`} onClick={() => onSelect(event)}>
                <span className="type-badge-icon">{meta.icon}</span>
                {event.title}
              </button>
            );
          })}
        </div>
      )}

      <div className="timeline-scroll">
        <div className="timeline-grid" style={{ minWidth: `${gridMinWidth}px` }}>
          {hourMarks.map((mark) => (
            <div key={mark.toISOString()} className="timeline-hour-row" style={{ top: `${percentFor(mark)}%` }}>
              <span className="timeline-hour-label">{String(mark.getHours()).padStart(2, '0')}:00</span>
              <span className="timeline-hour-line" />
            </div>
          ))}

          <div className="timeline-now-line" style={{ top: `${NOW_LINE_PERCENT}%` }}>
            <span className="timeline-now-dot" />
          </div>

          {placed.length === 0 && allDayEvents.length === 0 && <p className="timeline-empty">Geen afspraken nu</p>}

          {placed.map(({ event, column, totalColumns }) => {
            const start = new Date(event.start);
            const end = new Date(event.end);
            const clampedStart = start < windowStart ? windowStart : start;
            const clampedEnd = end > windowEnd ? windowEnd : end;
            const top = percentFor(clampedStart);
            const height = Math.max(percentFor(clampedEnd) - top, MIN_BLOCK_HEIGHT_PERCENT);
            const width = 100 / totalColumns;
            const meta = TYPE_META[event.type];
            return (
              <button
                key={event.id}
                className={`timeline-block ${meta.className} ${event.rescheduled ? 'is-rescheduled' : ''}`}
                style={{
                  top: `${top}%`,
                  height: `${height}%`,
                  left: `${width * column}%`,
                  width: `calc(${width}% - 6px)`,
                }}
                onClick={() => onSelect(event)}
                title={event.note ? `${event.title} — ${event.note}` : event.title}
              >
                <span className="timeline-block-time">
                  {formatTime(event.start)}
                  {event.rescheduled && <span className="timeline-block-reschedule-icon">↻</span>}
                </span>
                <span className="timeline-block-title">{event.title}</span>
                {event.note && <span className="timeline-block-note">✎ {event.note}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
