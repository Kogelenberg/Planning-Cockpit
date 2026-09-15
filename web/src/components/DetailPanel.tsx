import { useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '../types';
import { saveNote, rescheduleEvent, clearReschedule } from '../api';
import { formatTime } from '../dateUtils';
import { parseRescheduleInstruction } from '../rescheduleParser';
import { TypeBadge } from './TypeBadge';

const dayTimeFormatter = new Intl.DateTimeFormat('nl-NL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

const shortDayFormatter = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });

function isToday(date: Date, now: Date): boolean {
  return date.toDateString() === now.toDateString();
}

// Schuift de afspraak op t.o.v. zijn eigen (huidige) geplande tijd — dus
// "+1 uur" betekent altijd "1 uur later dan nu gepland staat", ongeacht op
// welk moment je op de knop drukt.
const PRESETS: { label: string; deltaMinutes: number }[] = [
  { label: '30 min', deltaMinutes: 30 },
  { label: '1 uur', deltaMinutes: 60 },
  { label: '2 uur', deltaMinutes: 120 },
  { label: '3 uur', deltaMinutes: 180 },
  { label: '4 uur', deltaMinutes: 240 },
  { label: '5 uur', deltaMinutes: 300 },
];

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DetailPanel({
  event,
  now,
  onClose,
}: {
  event: CalendarEvent | null;
  now: Date;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    setNote(event?.note ?? '');
    setCustomValue('');
    setMessage(null);
    setIsSaving(false);
  }, [event?.id]);

  if (!event) return null;

  // De notitie blijft puur lokaal (Fantastical heeft geen notitieveld om naar
  // te schrijven) — dus dit slaat alleen op, zonder iets in de echte agenda
  // te veranderen. Verzetten gebeurt alleen nog via een expliciete actie
  // hieronder (knop of Enter), nooit automatisch terwijl je typt: dat zou nu
  // een écht schrijfmoment in Fantastical zijn, niet meer een onschuldige
  // lokale weergave-truc.
  function handleNoteChange(value: string) {
    setNote(value);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveNote(event!.id, value);
    }, 500);
  }

  async function runReschedule(targetStart: Date, reason: string, successMessage?: string) {
    setIsSaving(true);
    setMessage(null);
    const result = await rescheduleEvent(event!.id, { targetStart: targetStart.toISOString(), reason });
    setIsSaving(false);
    if (result.ok) {
      if (successMessage) {
        setMessage(successMessage);
      } else {
        onClose();
      }
    } else {
      setMessage(result.error || 'Wijzigen in Fantastical is mislukt.');
    }
  }

  // Expliciete knop/Enter: forceert het verzetten op basis van de huidige
  // notitietekst, slaat de notitie meteen op (niet pas na de debounce).
  async function handleApplyNoteReschedule() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveNote(event!.id, note);
    const parsed = parseRescheduleInstruction(note, new Date(event!.start), new Date());
    if (parsed) {
      await runReschedule(parsed.targetStart, parsed.reason);
    } else {
      setMessage('Geen tijd of datum herkend in de notitie — gebruik de knoppen hieronder om te verzetten.');
    }
  }

  function handleNoteKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleApplyNoteReschedule();
    }
  }

  function handlePreset(deltaMinutes: number) {
    const target = new Date(new Date(event!.start).getTime() + deltaMinutes * 60000);
    runReschedule(target, `Verzet met ${deltaMinutes} min`);
  }

  function handleCustomSubmit() {
    if (!customValue) return;
    runReschedule(new Date(customValue), 'Handmatig verzet');
    setCustomValue('');
  }

  async function handleUndo() {
    setIsSaving(true);
    setMessage(null);
    const result = await clearReschedule(event!.id);
    setIsSaving(false);
    if (result.ok) {
      onClose();
    } else {
      setMessage(result.error || 'Terugzetten in Fantastical is mislukt.');
    }
  }

  return (
    <div className="detail-overlay" onClick={onClose}>
      <aside className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Sluiten">
          ✕
        </button>
        <TypeBadge type={event.type} />
        <h2 className="detail-title">{event.title}</h2>
        <p className="detail-time">
          {event.isAllDay
            ? 'Hele dag'
            : isToday(new Date(event.start), now)
              ? `${formatTime(event.start)} – ${formatTime(event.end)}`
              : `${shortDayFormatter.format(new Date(event.start))}, ${formatTime(event.start)} – ${formatTime(event.end)}`}
        </p>
        <p className="detail-calendar">{event.calendarName}</p>
        {event.location && <p className="detail-location">{event.location}</p>}

        {event.rescheduled && (
          <div className="detail-rescheduled">
            <span className="detail-rescheduled-label">Verzet</span>
            <p>
              Oorspronkelijk gepland op {event.originalStart && dayTimeFormatter.format(new Date(event.originalStart))}
              {event.rescheduleReason ? ` — ${event.rescheduleReason}` : ''}
            </p>
            <button className="detail-undo" onClick={handleUndo} disabled={isSaving}>
              Zet terug naar oorspronkelijke tijd
            </button>
          </div>
        )}

        <div className="detail-section">
          <label className="detail-label" htmlFor="detail-note">
            Notitie
          </label>
          <textarea
            id="detail-note"
            className="detail-note"
            placeholder="Bijv. niet opgenomen, terugbellen over 2 uur..."
            value={note}
            onChange={(e) => handleNoteChange(e.target.value)}
            onKeyDown={handleNoteKeyDown}
            rows={3}
          />
          <button className="note-apply-button" onClick={handleApplyNoteReschedule} disabled={!note.trim() || isSaving}>
            Pas verzet toe uit notitie
          </button>
        </div>

        <div className="detail-section">
          <span className="detail-label">Verzet deze afspraak</span>
          <p className="detail-hint">Dit wijzigt de tijd ook echt in Fantastical zelf.</p>
          <div className="reschedule-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="reschedule-chip"
                onClick={() => handlePreset(preset.deltaMinutes)}
                disabled={isSaving}
              >
                +{preset.label}
              </button>
            ))}
          </div>
          <div className="reschedule-custom">
            <input
              type="datetime-local"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              min={toDatetimeLocalValue(new Date())}
              disabled={isSaving}
            />
            <button className="reschedule-custom-submit" onClick={handleCustomSubmit} disabled={!customValue || isSaving}>
              Zet op deze tijd
            </button>
          </div>
          {isSaving && <p className="detail-auto-message">Bezig met wijzigen in Fantastical...</p>}
          {message && <p className="detail-auto-message">{message}</p>}
        </div>
      </aside>
    </div>
  );
}
