import type { CalendarEvent } from './types';

// Zelfde teken als config.doneMark op de server: een afgeronde afspraak heeft
// dit teken voor zijn titel in Fantastical zelf.
export const DONE_MARK = '✓';

export function isDone(event: Pick<CalendarEvent, 'title'>): boolean {
  return event.title.startsWith(DONE_MARK);
}

/** Titel zonder het afvink-teken, voor weergave. */
export function displayTitle(title: string): string {
  return title.startsWith(DONE_MARK) ? title.slice(DONE_MARK.length).trimStart() : title;
}

export function withDoneMark(title: string, done: boolean): string {
  const bare = displayTitle(title);
  return done ? `${DONE_MARK} ${bare}` : bare;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Datum + minuten sinds middernacht -> Date (1440 = middernacht daarna). */
export function dateAtMinutes(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes, 0, 0);
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} uur` : `${h} uur ${m} min`;
}
