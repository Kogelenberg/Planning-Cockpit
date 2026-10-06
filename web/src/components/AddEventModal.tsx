import { useEffect, useState } from 'react';
import { createEvent, fetchDefaultDuration } from '../api';
import { parseNewEventInput } from '../createEventParser';
import { addDays, dateAtMinutes, formatDuration, formatMinutes, minutesOfDay, startOfDay } from '../eventUtils';
import { DatePicker } from './DatePicker';
import { TimeRangeSlider } from './TimeRangeSlider';

const STEP = 5;
const END_OF_DAY = 24 * 60;

const dayFormatter = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

function roundTo5(minutes: number): number {
  return Math.round(minutes / STEP) * STEP;
}

/** Eerstvolgend kwartier vanaf nu; na 22:00 morgenochtend 09:00. */
function initialSlot(now: Date): { day: Date; startMin: number } {
  const rounded = Math.ceil((minutesOfDay(now) + 1) / 15) * 15;
  if (rounded > 22 * 60) return { day: addDays(startOfDay(now), 1), startMin: 9 * 60 };
  return { day: startOfDay(now), startMin: Math.max(rounded, 7 * 60) };
}

interface InterpretedText {
  title: string;
  day?: Date;
  startMin?: number;
}

/**
 * Leest de getypte tekst: "call met Lars om 17:00" geeft titel + dag + tijd
 * (die dan in de kalender en op de tijdbalk verschijnen), een los woord als
 * "morgen" of "vandaag" geeft alleen de dag, en anders is alles titel — dan
 * kies je dag en tijd zelf met de kalender en de balk.
 */
function interpretText(raw: string, now: Date): InterpretedText {
  const parsed = parseNewEventInput(raw, now);
  if (parsed) {
    return {
      title: parsed.title,
      day: startOfDay(parsed.targetStart),
      startMin: Math.min(roundTo5(minutesOfDay(parsed.targetStart)), END_OF_DAY - STEP),
    };
  }
  const tomorrow = /\bmorgen\b/i;
  const today = /\bvandaag\b/i;
  if (tomorrow.test(raw) || today.test(raw)) {
    const day = tomorrow.test(raw) ? addDays(startOfDay(now), 1) : startOfDay(now);
    const title = raw.replace(tomorrow, ' ').replace(today, ' ').replace(/\s+/g, ' ').trim();
    return { title, day };
  }
  return { title: raw.trim() };
}

export function AddEventModal({ now, onClose }: { now: Date; onClose: () => void }) {
  const [initial] = useState(() => initialSlot(now));
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [day, setDay] = useState(initial.day);
  const [startMin, setStartMin] = useState(initial.startMin);
  const [endMin, setEndMin] = useState(initial.startMin + 60);
  const [defaultDuration, setDefaultDuration] = useState(60);
  const [durationTouched, setDurationTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // De standaardduur hangt van de titel af (bellen/peptalk: 15 min, interview
  // en dergelijke: 1,5 uur, anders 1 uur) en wordt door de server bepaald, zodat
  // die ene plek (config.js) bepaalt wat een belletje is.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const minutes = await fetchDefaultDuration(title);
      if (!cancelled && minutes) setDefaultDuration(minutes);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [title]);

  // Zolang je de duur niet zelf op de balk aangepast hebt, volgt het eind de
  // standaardduur van de titel.
  useEffect(() => {
    if (durationTouched) return;
    setEndMin(Math.min(END_OF_DAY, startMin + defaultDuration));
  }, [defaultDuration]);

  function handleTextChange(value: string) {
    setText(value);
    setMessage(null);
    const interpreted = interpretText(value, now);
    setTitle(interpreted.title);
    if (interpreted.day) setDay(interpreted.day);
    if (interpreted.startMin !== undefined) {
      const duration = durationTouched ? endMin - startMin : defaultDuration;
      setStartMin(interpreted.startMin);
      setEndMin(Math.min(END_OF_DAY, interpreted.startMin + duration));
    }
  }

  function handleRangeChange(nextStart: number, nextEnd: number) {
    if (nextEnd - nextStart !== endMin - startMin) setDurationTouched(true);
    setStartMin(nextStart);
    setEndMin(nextEnd);
    setMessage(null);
  }

  const start = dateAtMinutes(day, startMin);
  const canSubmit = title.length > 0 && !isSaving;

  async function submit() {
    if (!title) {
      setMessage('Vul eerst een titel in.');
      return;
    }
    if (start.getTime() < now.getTime() - 60000) {
      setMessage('Deze tijd ligt al in het verleden — kies een tijd vanaf nu.');
      return;
    }
    setIsSaving(true);
    setMessage(null);
    const result = await createEvent({
      title,
      targetStart: start.toISOString(),
      durationMinutes: endMin - startMin,
    });
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
          Typ een titel, bijv. "call met Lars". Typ je er een tijd bij ("call met Lars om 17:00" of "koffie morgen om
          10 uur"), dan wordt dat hieronder vanzelf ingevuld. Daarna kun je dag en tijd gewoon aanklikken.
        </p>
        <div className="detail-section" style={{ borderTop: 'none', paddingTop: 0 }}>
          <input
            autoFocus
            className="add-event-input"
            placeholder="call met Lars"
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSaving}
          />
        </div>

        <div className="detail-section">
          <span className="detail-label">Dag</span>
          <DatePicker value={day} minDate={startOfDay(now)} onChange={setDay} disabled={isSaving} />
        </div>

        <div className="detail-section">
          <span className="detail-label">Van – tot</span>
          <TimeRangeSlider startMin={startMin} endMin={endMin} onChange={handleRangeChange} disabled={isSaving} />
        </div>

        <div className="detail-section">
          {title && (
            <p className="detail-hint add-event-summary">
              "{title}" · {dayFormatter.format(day)}, {formatMinutes(startMin)} ({formatDuration(endMin - startMin)})
            </p>
          )}
          <button className="note-apply-button" onClick={submit} disabled={!canSubmit}>
            {isSaving ? 'Bezig met toevoegen...' : 'Toevoegen'}
          </button>
          {message && <p className="detail-auto-message">{message}</p>}
        </div>
      </aside>
    </div>
  );
}
