import { useState } from 'react';
import type { CalendarMeta } from '../types';
import { createEvent } from '../api';
import { parseNewEventInput } from '../createEventParser';
import { formatTime } from '../dateUtils';

export function AddEventModal({
  now,
  calendars,
  onClose,
}: {
  now: Date;
  calendars: CalendarMeta[];
  onClose: () => void;
}) {
  // Alleen agenda's die zowel op de allowlist staan (server filtert dit al
  // vóór het de state bereikt) als schrijfbaar zijn — bv. "Hogeschool Utrecht"
  // is een gedeelde, alleen-lezen agenda en verschijnt hier dus niet.
  const writableCalendars = calendars.filter((c) => c.writable);
  const privé = writableCalendars.find((c) => c.name.toLowerCase() === 'privé');

  const [value, setValue] = useState('');
  const [calendarId, setCalendarId] = useState(privé?.id ?? writableCalendars[0]?.id ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const preview = value.trim() ? parseNewEventInput(value, now) : null;

  async function submit() {
    const parsed = parseNewEventInput(value, now);
    if (!parsed) {
      setMessage('Geen tijd herkend — probeer bijvoorbeeld "call met Lars om 17:00".');
      return;
    }
    if (!calendarId) {
      setMessage('Geen agenda beschikbaar om in aan te maken.');
      return;
    }
    setIsSaving(true);
    setMessage(null);
    const result = await createEvent({ title: parsed.title, targetStart: parsed.targetStart.toISOString(), calendarId });
    setIsSaving(false);
    if (result.ok) {
      onClose();
    } else {
      setMessage(result.error || 'Aanmaken in Fantastical is mislukt.');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="detail-overlay" onClick={onClose}>
      <aside className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose} aria-label="Sluiten">
          ✕
        </button>
        <h2 className="detail-title">Afspraak toevoegen</h2>
        <p className="detail-hint">
          Typ bijv. "call met Lars om 17:00" of "koffie met Jan morgen om 10 uur". Bellen krijgt automatisch 30
          minuten, andere afspraken 1 uur.
        </p>
        <div className="detail-section" style={{ borderTop: 'none', paddingTop: 0 }}>
          <label className="detail-label" htmlFor="add-event-calendar">
            Agenda
          </label>
          <select
            id="add-event-calendar"
            className="add-event-select"
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            disabled={isSaving || writableCalendars.length === 0}
          >
            {writableCalendars.map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.name}
              </option>
            ))}
          </select>

          <input
            autoFocus
            className="add-event-input"
            placeholder="call met Lars om 17:00"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSaving}
          />
          {preview && (
            <p className="detail-hint">
              → "{preview.title}" op {formatTime(preview.targetStart.toISOString())}
            </p>
          )}
          <button className="note-apply-button" onClick={submit} disabled={!value.trim() || isSaving || !calendarId}>
            {isSaving ? 'Bezig met toevoegen...' : 'Toevoegen'}
          </button>
          {message && <p className="detail-auto-message">{message}</p>}
        </div>
      </aside>
    </div>
  );
}
