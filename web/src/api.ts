import type { DashboardState } from './types';

/**
 * Abonneert op de live agenda-status: eerst een directe fetch voor een snelle
 * eerste render, daarna een Server-Sent Events-stream die automatisch
 * doorverbindt als hij wegvalt. De pagina hoeft zelf nooit iets te weten
 * van MCP of pollingfrequenties.
 */
export function subscribeToState(
  onState: (state: DashboardState) => void,
  onConnectionChange?: (connected: boolean) => void
): () => void {
  let source: EventSource | null = null;
  let reconnectTimer: number | null = null;
  let stopped = false;

  function connect() {
    if (stopped) return;
    source = new EventSource('/api/events/stream');

    source.addEventListener('state', (event) => {
      onConnectionChange?.(true);
      try {
        onState(JSON.parse((event as MessageEvent).data));
      } catch {
        // Negeer een enkel corrupt bericht; de volgende push herstelt het beeld.
      }
    });

    source.onerror = () => {
      onConnectionChange?.(false);
      source?.close();
      source = null;
      if (!stopped) {
        reconnectTimer = window.setTimeout(connect, 5000);
      }
    };
  }

  fetch('/api/state')
    .then((res) => res.json())
    .then(onState)
    .catch(() => {
      onConnectionChange?.(false);
    });

  connect();

  return () => {
    stopped = true;
    source?.close();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
  };
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function toResult(res: Response): Promise<ActionResult> {
  if (res.ok) return { ok: true };
  const data = await res.json().catch(() => ({}));
  return { ok: false, error: data.error || 'Onbekende fout' };
}

/**
 * De notitie blijft puur lokaal aan Planning Cockpit (Fantastical heeft geen
 * schrijfbaar notitieveld). De backend broadcast de nieuwe stand meteen via
 * SSE, dus een losse refresh hier is niet nodig.
 */
export async function saveNote(eventId: string, note: string): Promise<void> {
  await fetch(`/api/events/${encodeURIComponent(eventId)}/note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
}

/**
 * Verzet de afspraak ECHT in Fantastical — geen lokale weergave-truc meer.
 * Geeft {ok:false, error} terug bij een mislukte schrijfactie (bv. Fantastical
 * niet bereikbaar), zodat de UI dat duidelijk kan tonen i.p.v. te doen alsof
 * het gelukt is.
 */
export async function rescheduleEvent(
  eventId: string,
  payload: { targetStart: string; reason?: string; durationMinutes?: number }
): Promise<ActionResult> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/reschedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return toResult(res);
}

export async function clearReschedule(eventId: string): Promise<ActionResult> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/reschedule`, { method: 'DELETE' });
  return toResult(res);
}

/**
 * Vinkt een afspraak af (of maakt dat ongedaan): de server zet een ✓ voor de
 * titel in Fantastical zelf. Een niet afgevinkte call/peptalk/terugbellen/
 * uitwerken gaat 's avonds automatisch naar de volgende werkdag.
 */
export async function setEventDone(eventId: string, done: boolean): Promise<ActionResult> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/done`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done }),
  });
  return toResult(res);
}

/** Standaardduur (minuten) voor een nieuwe afspraak met deze titel, bepaald door de server. */
export async function fetchDefaultDuration(title: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/default-duration?title=${encodeURIComponent(title)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.durationMinutes === 'number' ? data.durationMinutes : null;
  } catch {
    return null;
  }
}

/**
 * Maakt een nieuwe afspraak ECHT aan in Fantastical, in de standaardagenda van
 * deze installatie (zie DEFAULT_NEW_EVENT_CALENDAR_NAME). De duur komt uit de
 * tijdbalk (durationMinutes); zonder die waarde bepaalt de server hem.
 */
export async function createEvent(payload: {
  title: string;
  targetStart: string;
  durationMinutes?: number;
  calendarId?: string;
}): Promise<ActionResult> {
  const res = await fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return toResult(res);
}
