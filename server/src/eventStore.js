import fs from 'node:fs';
import { config, ensureDataDir } from './config.js';
import { applyAnnotations } from './annotations.js';

let rawEvents = [];

let state = {
  events: [],
  calendars: [],
  source: null,
  timezone: 'Europe/Amsterdam',
  lastUpdated: null,
  lastError: null,
};

/** Laadt de laatst bekende stand van schijf, zodat de app na een herstart niet leeg begint. */
export function loadPersistedState() {
  try {
    ensureDataDir();
    if (fs.existsSync(config.dataFile)) {
      const parsed = JSON.parse(fs.readFileSync(config.dataFile, 'utf-8'));
      state = { ...state, ...parsed, lastError: null };
    }
  } catch {
    // Corrupte cache is niet fataal; we beginnen dan gewoon leeg.
  }
  return state;
}

export function getState() {
  return state;
}

/** De laatst opgehaalde, niet-geannoteerde events — gebruikt om notitie/verzet-acties op te baseren. */
export function getRawEvents() {
  return rawEvents;
}

/** Zoekt een event op id, eerst in de ruwe laatste ophaal, anders in de al geannoteerde stand. */
export function findEventById(eventId) {
  return rawEvents.find((e) => e.id === eventId) || state.events.find((e) => e.id === eventId) || null;
}

export function setSuccessState({ events, calendars, source, timezone }) {
  rawEvents = events;
  state = {
    events: applyAnnotations(rawEvents),
    calendars,
    source,
    timezone,
    lastUpdated: new Date().toISOString(),
    lastError: null,
  };
  persist();
  return state;
}

/** Herberekent de geannoteerde events (na een notitie/verzet-actie), zonder opnieuw op te halen. */
export function recomputeEvents() {
  state = { ...state, events: applyAnnotations(rawEvents) };
  persist();
  return state;
}

/** Bewaart eerder opgehaalde events; de UI toont die stil door met een subtiele syncstatus. */
export function setErrorState(message) {
  state = { ...state, lastError: message };
  return state;
}

// Schrijf-dan-hernoem: een rename is atomisch, dus een crash midden in het
// schrijven kan dit bestand nooit half-geschreven achterlaten.
function persist() {
  try {
    ensureDataDir();
    const tmpFile = `${config.dataFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
    fs.renameSync(tmpFile, config.dataFile);
  } catch {
    // Best effort; een mislukte schrijfactie mag de app niet laten crashen.
  }
}
