export type EventType = 'call' | 'external' | 'internal';
export type CalendarCategory = 'work' | 'personal';
export type ViewFilter = 'all' | 'work' | 'personal' | 'calls';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO 8601 — effectieve tijd (na eventuele lokale verzet-actie)
  end: string; // ISO 8601
  calendarId: string;
  calendarName: string;
  isAllDay: boolean;
  location?: string;
  type: EventType;
  note?: string;
  rescheduled?: boolean;
  rescheduleReason?: string;
  originalStart?: string; // alleen aanwezig als rescheduled true is
  originalEnd?: string;
  noShowPending?: boolean; // "call niet doorgegaan" aangevinkt, nog niet verplaatst
}

export interface CalendarMeta {
  id: string;
  name: string;
  category: CalendarCategory;
  writable: boolean;
}

export interface DashboardState {
  events: CalendarEvent[];
  calendars: CalendarMeta[];
  source: 'mcp' | 'ics' | null;
  timezone: string;
  lastUpdated: string | null;
  lastError: string | null;
}
