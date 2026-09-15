import { useEffect, useMemo, useState } from 'react';
import { subscribeToState } from './api';
import type { CalendarEvent, DashboardState, ViewFilter } from './types';
import { Header } from './components/Header';
import { NowNext } from './components/NowNext';
import { Timeline } from './components/Timeline';
import { DayList } from './components/DayList';
import { Filters } from './components/Filters';
import { DetailPanel } from './components/DetailPanel';
import { FollowUps } from './components/FollowUps';
import { SyncStatus } from './components/SyncStatus';
import { findCurrentEvent, findNextEvent, isOnDay } from './dateUtils';

const EMPTY_STATE: DashboardState = {
  events: [],
  calendars: [],
  source: null,
  timezone: 'Europe/Amsterdam',
  lastUpdated: null,
  lastError: null,
};

export default function App() {
  const [state, setState] = useState<DashboardState>(EMPTY_STATE);
  const [connected, setConnected] = useState(true);
  const [now, setNow] = useState(new Date());
  const [viewFilter, setViewFilter] = useState<ViewFilter>('all');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  useEffect(() => subscribeToState(setState, setConnected), []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const scopedCalendarIds = useMemo(() => {
    if (viewFilter !== 'work' && viewFilter !== 'personal') return null;
    return new Set(state.calendars.filter((c) => c.category === viewFilter).map((c) => c.id));
  }, [viewFilter, state.calendars]);

  const todaysEvents = useMemo(() => state.events.filter((event) => isOnDay(event, now)), [state.events, now]);

  const visibleEvents = useMemo(
    () =>
      todaysEvents.filter((event) => {
        if (scopedCalendarIds && !scopedCalendarIds.has(event.calendarId)) return false;
        if (viewFilter === 'calls' && event.type !== 'call') return false;
        return true;
      }),
    [todaysEvents, scopedCalendarIds, viewFilter]
  );

  const followUps = useMemo(
    () =>
      state.events
        .filter((event) => event.rescheduled && !isOnDay(event, now) && new Date(event.start) > now)
        .filter((event) => !scopedCalendarIds || scopedCalendarIds.has(event.calendarId))
        .sort((a, b) => +new Date(a.start) - +new Date(b.start)),
    [state.events, now, scopedCalendarIds]
  );

  const currentEvent = useMemo(() => findCurrentEvent(visibleEvents, now), [visibleEvents, now]);
  const nextEvent = useMemo(() => findNextEvent(visibleEvents, now), [visibleEvents, now]);

  const selectedEvent: CalendarEvent | null = useMemo(
    () => state.events.find((e) => e.id === selectedEventId) ?? null,
    [state.events, selectedEventId]
  );

  return (
    <div className="app">
      <Header now={now} />
      <main className="main">
        <div className="main-column main-column-primary">
          <NowNext current={currentEvent} next={nextEvent} now={now} onSelect={(e) => setSelectedEventId(e.id)} />
          <section className="panel timeline-panel">
            <h2 className="panel-title">Tijdlijn</h2>
            <Timeline events={visibleEvents} now={now} onSelect={(e) => setSelectedEventId(e.id)} />
          </section>
          <section className="panel daylist-panel">
            <h2 className="panel-title">Dagoverzicht</h2>
            <DayList
              events={visibleEvents}
              now={now}
              nextEventId={nextEvent?.id ?? null}
              onSelect={(e) => setSelectedEventId(e.id)}
            />
          </section>
        </div>
        <div className="main-column main-column-secondary">
          <section className="panel panel-compact">
            <Filters value={viewFilter} onChange={setViewFilter} />
          </section>
          {followUps.length > 0 && (
            <section className="panel followups-panel">
              <h2 className="panel-title">Nog te bellen</h2>
              <FollowUps events={followUps} onSelect={(e) => setSelectedEventId(e.id)} />
            </section>
          )}
          <SyncStatus lastUpdated={state.lastUpdated} hasError={Boolean(state.lastError)} connected={connected} now={now} />
        </div>
      </main>
      <DetailPanel event={selectedEvent} now={now} onClose={() => setSelectedEventId(null)} />
    </div>
  );
}
