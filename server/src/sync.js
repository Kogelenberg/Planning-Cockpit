import { setSuccessState, setErrorState, getRawEvents } from './eventStore.js';
import { fetchCalendarState } from './calendarService.js';
import { broadcast } from './sse.js';
import { runCompanionScheduler } from './companionScheduler.js';

let lastPollAt = 0;

export function getLastPollAt() {
  return lastPollAt;
}

/** Haalt de agenda opnieuw op, past annotaties toe en broadcast het resultaat. Gooit nooit. */
export async function pollOnce() {
  lastPollAt = Date.now();
  try {
    const result = await fetchCalendarState();
    const state = setSuccessState(result);
    broadcast('state', state);
    console.log(
      `[${new Date().toISOString()}] Agenda bijgewerkt: ${result.events.length} items (bron: ${result.source})`
    );
    // Bewust niet awaiten: dit kan meerdere MCP-schrijfacties na elkaar doen
    // (per interview/acq/bezoek/eerste-gesprek), en mag pollOnce() se eigen
    // aanroeper (bv. de "+"-knop, die hierop wacht voor een snelle response)
    // niet vertragen. Verschijnt dus pas op de eerstvolgende ophaalronde.
    runCompanionScheduler(getRawEvents()).catch((err) => {
      console.error(`[${new Date().toISOString()}] companionScheduler-ronde mislukt:`, err.message);
    });
    return state;
  } catch (err) {
    const state = setErrorState(err.message);
    broadcast('state', state);
    console.error(`[${new Date().toISOString()}] Ophalen agenda mislukt:`, err.message);
    return state;
  }
}
