import { useEffect, useState } from 'react';
import { addDays, startOfDay } from '../eventUtils';

const WEEKDAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const monthFormatter = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' });

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function firstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Maandkalender waar je op een dag klikt in plaats van een datum te typen.
 * Dagen vóór `minDate` zijn uitgeschakeld. De getoonde maand volgt de gekozen
 * dag (ook als die van buitenaf verandert, bv. door tekst in het titelveld).
 */
export function DatePicker({
  value,
  minDate,
  onChange,
  disabled,
}: {
  value: Date;
  minDate: Date;
  onChange: (day: Date) => void;
  disabled?: boolean;
}) {
  const [viewMonth, setViewMonth] = useState(() => firstOfMonth(value));

  useEffect(() => {
    setViewMonth(firstOfMonth(value));
  }, [value.getFullYear(), value.getMonth()]);

  const today = startOfDay(new Date());
  const min = startOfDay(minDate);
  const tomorrow = addDays(today, 1);

  const leadingBlanks = (viewMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i + 1)),
  ];

  const canGoBack = firstOfMonth(min) < viewMonth;
  const monthLabel = monthFormatter.format(viewMonth);

  return (
    <div className="datepicker">
      <div className="datepicker-quick">
        <button
          type="button"
          className="reschedule-chip"
          disabled={disabled || today < min}
          onClick={() => onChange(today)}
        >
          Vandaag
        </button>
        <button
          type="button"
          className="reschedule-chip"
          disabled={disabled || tomorrow < min}
          onClick={() => onChange(tomorrow)}
        >
          Morgen
        </button>
      </div>
      <div className="datepicker-header">
        <button
          type="button"
          className="datepicker-nav"
          aria-label="Vorige maand"
          disabled={disabled || !canGoBack}
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
        >
          ‹
        </button>
        <span className="datepicker-month">{monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</span>
        <button
          type="button"
          className="datepicker-nav"
          aria-label="Volgende maand"
          disabled={disabled}
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
        >
          ›
        </button>
      </div>
      <div className="datepicker-grid">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className="datepicker-weekday">
            {weekday}
          </span>
        ))}
        {cells.map((day, index) => {
          if (!day) return <span key={`blank-${index}`} />;
          const isPast = day < min;
          const isSelected = sameDay(day, value);
          const isToday = sameDay(day, today);
          return (
            <button
              key={day.toISOString()}
              type="button"
              className={`datepicker-day ${isSelected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}`}
              disabled={disabled || isPast}
              aria-pressed={isSelected}
              onClick={() => onChange(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
