import type { CalendarEvent } from './types';

const dateFormatter = new Intl.DateTimeFormat('nl-NL', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit' });
const clockFormatter = new Intl.DateTimeFormat('nl-NL', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatDate(now: Date): string {
  const text = dateFormatter.format(now);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatClock(now: Date): string {
  return clockFormatter.format(now);
}

export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 6) return 'Goedenacht';
  if (hour < 12) return 'Goedemorgen';
  if (hour < 18) return 'Goedemiddag';
  return 'Goedenavond';
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Een event "hoort bij vandaag" als zijn interval het huidige lokale etmaal raakt. */
export function isOnDay(event: CalendarEvent, day: Date): boolean {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const start = new Date(event.start);
  const end = new Date(event.end);
  return start <= dayEnd && end > dayStart;
}

export type EventStatus = 'past' | 'current' | 'next' | 'upcoming';

export function getEventStatus(event: CalendarEvent, now: Date, nextEventId: string | null): EventStatus {
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (end <= now) return 'past';
  if (start <= now && now < end) return 'current';
  if (event.id === nextEventId) return 'next';
  return 'upcoming';
}

export function findCurrentEvent(events: CalendarEvent[], now: Date): CalendarEvent | null {
  const timed = events.filter((e) => !e.isAllDay);
  return timed.find((e) => new Date(e.start) <= now && now < new Date(e.end)) || null;
}

export function findNextEvent(events: CalendarEvent[], now: Date): CalendarEvent | null {
  const timed = events
    .filter((e) => !e.isAllDay && new Date(e.start) > now)
    .sort((a, b) => +new Date(a.start) - +new Date(b.start));
  return timed[0] || null;
}

export function countdownLabel(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return 'nu';
  const totalMinutes = Math.round(diffMs / 60000);
  if (totalMinutes < 1) return 'over minder dan een minuut';
  if (totalMinutes < 60) return `over ${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `over ${hours}u` : `over ${hours}u ${minutes}m`;
}

export function relativeUpdated(lastUpdated: string | null, now: Date): string {
  if (!lastUpdated) return 'nog niet bijgewerkt';
  const diffMs = now.getTime() - new Date(lastUpdated).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'zojuist bijgewerkt';
  if (minutes === 1) return '1 minuut geleden bijgewerkt';
  if (minutes < 60) return `${minutes} minuten geleden bijgewerkt`;
  return `bijgewerkt om ${timeFormatter.format(new Date(lastUpdated))}`;
}
