import { useCallback, useEffect, useMemo, useState } from 'react';
import { setEventDone, subscribeToState } from './api';
import type { CalendarEvent, DashboardState } from './types';
import { Header } from './components/Header';
import { NowNext } from './components/NowNext';
import { Timeline } from './components/Timeline';
import { DayList } from './components/DayList';
import { DetailPanel } from './components/DetailPanel';
import { AddEventModal } from './components/AddEventModal';
import { FollowUps } from './components/FollowUps';
import { SyncStatus } from './components/SyncStatus';
import { findCurrentEvent, findUpcomingEvents, isOnDay } from './dateUtils';
import { isDone, withDoneMark } from './eventUtils';

const EMPTY_STATE: DashboardState = {
  events: [],
  calendars: [],
  source: null,
  timezone: 'Europe/Amsterdam',
  lastUpdated: null,
  lastError: null,
};

// Een net gezet vinkje geldt meteen op het scherm, ook als een ophaalronde die
// al liep nog de oude titel teruggeeft. Na deze tijd is er zeker minstens één
// verse ophaalronde geweest en geldt weer gewoon wat Fantastical zegt.
const DONE_OVERRIDE_MS = 45 * 1000;

interface DoneOverride {
  value: boolean;
  at: number;
}

export default function App() {
  const [state, setState] = useState<DashboardState>(EMPTY_STATE);
  const [connected, setConnected] = useState(true);
  const [now, setNow] = useState(new Date());
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [doneOverrides, setDoneOverrides] = useState<Record<string, DoneOverride>>({});
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => subscribeToState(setState, setConnected), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setDoneOverrides((prev) => {
      const stale = Object.keys(prev).filter((id) => Date.now() - prev[id].at > DONE_OVERRIDE_MS);
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const id of stale) delete next[id];
      return next;
    });
  }, [state.events, now]);

  const events = useMemo(
    () =>
      state.events.map((event) => {
        const override = doneOverrides[event.id];
        if (!override || now.getTime() - override.at > DONE_OVERRIDE_MS) return event;
        return { ...event, title: withDoneMark(event.title, override.value) };
      }),
    [state.events, doneOverrides, now]
  );

  const writableCalendarIds = useMemo(
    () => new Set(state.calendars.filter((c) => c.writable).map((c) => c.id)),
    [state.calendars]
  );

  const isCheckable = useCallback(
    (event: CalendarEvent) => !event.isAllDay && writableCalendarIds.has(event.calendarId),
    [writableCalendarIds]
  );

  async function handleToggleDone(event: CalendarEvent) {
    const next = !isDone(event);
    setDoneOverrides((prev) => ({ ...prev, [event.id]: { value: next, at: Date.now() } }));
    const result = await setEventDone(event.id, next);
    if (!result.ok) {
      setDoneOverrides((prev) => {
        const rest = { ...prev };
        delete rest[event.id];
        return rest;
      });
      setToast(result.error || 'Afvinken is niet gelukt.');
    }
  }

  const todaysEvents = useMemo(() => events.filter((event) => isOnDay(event, now)), [events, now]);

  const followUps = useMemo(
    () =>
      events
        .filter((event) => event.rescheduled && !isOnDay(event, now) && new Date(event.start) > now)
        .sort((a, b) => +new Date(a.start) - +new Date(b.start)),
    [events, now]
  );

  const currentEvent = useMemo(() => findCurrentEvent(todaysEvents, now), [todaysEvents, now]);
  const upcomingEvents = useMemo(() => findUpcomingEvents(todaysEvents, now, 2), [todaysEvents, now]);
  const nextEvent = upcomingEvents[0] ?? null;
  const afterNextEvent = upcomingEvents[1] ?? null;

  const selectedEvent: CalendarEvent | null = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  return (
    <div className="app">
      <Header now={now} onAddEvent={() => setIsAddOpen(true)} />
      <main className="main">
        <div className="main-column main-column-primary">
          <NowNext
            current={currentEvent}
            next={nextEvent}
            afterNext={afterNextEvent}
            now={now}
            isCheckable={isCheckable}
            onToggleDone={handleToggleDone}
            onSelect={(e) => setSelectedEventId(e.id)}
          />
          <section className="panel timeline-panel">
            <h2 className="panel-title">Tijdlijn</h2>
            <Timeline events={todaysEvents} now={now} onSelect={(e) => setSelectedEventId(e.id)} />
          </section>
          <section className="panel daylist-panel">
            <h2 className="panel-title">Dagoverzicht</h2>
            <DayList
              events={todaysEvents}
              now={now}
              nextEventId={nextEvent?.id ?? null}
              isCheckable={isCheckable}
              onToggleDone={handleToggleDone}
              onSelect={(e) => setSelectedEventId(e.id)}
            />
          </section>
        </div>
        <div className="main-column main-column-secondary">
          {followUps.length > 0 && (
            <section className="panel followups-panel">
              <h2 className="panel-title">Nog te bellen</h2>
              <FollowUps events={followUps} onSelect={(e) => setSelectedEventId(e.id)} />
            </section>
          )}
          <SyncStatus lastUpdated={state.lastUpdated} hasError={Boolean(state.lastError)} connected={connected} now={now} />
        </div>
      </main>
      <DetailPanel
        event={selectedEvent}
        now={now}
        checkable={selectedEvent ? isCheckable(selectedEvent) : false}
        onToggleDone={handleToggleDone}
        onClose={() => setSelectedEventId(null)}
      />
      {isAddOpen && <AddEventModal now={now} onClose={() => setIsAddOpen(false)} />}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
