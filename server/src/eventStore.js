import fs from 'node:fs';
import { config, ensureDataDir } from './config.js';
import { applyAnnotations } from './annotations.js';

let rawEvents = [];

// Lokaal vastgehouden, net-aangemaakte (of net-verzette) afspraken die
// Fantastical's eigen zoekopdracht (queryCalendarItems met een lege
// zoekterm) soms niet teruggeeft — ook niet na een lange tijd. Zonder dit
// verdwijnt zo'n afspraak na de eerstvolgende automatische ververscyclus
// weer uit de cockpit, ook al staat hij écht in Fantastical. Zodra een
// verse ophaal het item zelf wél bevat, laten we onze eigen kopie los —
// dan heeft de echte data voorrang (ook voor latere wijzigingen elders).
const pinnedEvents = new Map();

// Bovengrens voor hoe lang we een vastgehouden afspraak sowieso maximaal
// vasthouden, ook als Fantastical 'm nooit bevestigt. Zonder dit zou een
// afspraak die je snel weer in Fantastical verwijdert (bv. een test) voor
// altijd in de cockpit blijven staan, want er is dan niets dat de pin ooit
// nog lost.
const PIN_MAX_AGE_MS = 20 * 60 * 1000;

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
      // Zonder dit blijft rawEvents leeg na een herstart, en zou de eerste
      // notitie/verzet-actie vóór de eerste geslaagde live-ophaal de net
      // geladen cache alsnog overschrijven met een lege lijst (recomputeEvents
      // gebruikt rawEvents, niet state.events, als bron).
      rawEvents = parsed.events || [];
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

/** Houdt een net aangemaakte afspraak lokaal vast totdat Fantastical 'm zelf teruggeeft. */
export function pinEvent(event) {
  pinnedEvents.set(event.id, { event, pinnedAt: Date.now() });
}

/** Werkt een vastgehouden afspraak bij (bv. na verzetten), als hij nog vastgehouden wordt. */
export function updatePinnedEvent(id, patch) {
  const entry = pinnedEvents.get(id);
  if (entry) {
    pinnedEvents.set(id, { event: { ...entry.event, ...patch }, pinnedAt: entry.pinnedAt });
  }
}

/**
 * Past één afspraak meteen lokaal aan (bv. de titel na afvinken), zodat de
 * stand direct klopt zonder op de volgende ophaal te wachten. De volgende
 * ophaal levert daarna de echte Fantastical-waarde en overschrijft dit.
 */
export function patchRawEvent(id, patch) {
  rawEvents = rawEvents.map((e) => (e.id === id ? { ...e, ...patch } : e));
  updatePinnedEvent(id, patch);
  return recomputeEvents();
}

// Moment waarop een afspraak voor het laatst afgevinkt/ontvinkt is. De
// automatische verplaatser slaat zulke afspraken even over, zodat een net
// gezet vinkje (dat nog niet in een lopende ophaalronde zat) niet alsnog
// door een verouderde stand genegeerd wordt.
const doneToggledAt = new Map();

export function noteDoneToggle(id) {
  doneToggledAt.set(id, Date.now());
}

export function wasDoneToggledRecently(id, withinMs = 2 * 60 * 1000) {
  const at = doneToggledAt.get(id);
  return Boolean(at) && Date.now() - at < withinMs;
}

export function setSuccessState({ events, calendars, source, timezone }) {
  const now = Date.now();
  for (const [id, entry] of pinnedEvents) {
    const bevestigdDoorFetch = events.some((e) => e.id === id);
    const verlopen = now - entry.pinnedAt > PIN_MAX_AGE_MS;
    if (bevestigdDoorFetch || verlopen) {
      pinnedEvents.delete(id);
    }
  }
  rawEvents = pinnedEvents.size
    ? [...events, ...Array.from(pinnedEvents.values()).map((entry) => entry.event)]
    : events;
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

/**
 * Bewaart eerder opgehaalde events; de UI toont die stil door met een
 * subtiele syncstatus. Net-aangemaakte afspraken die nog vastgehouden
 * worden (pinnedEvents) horen ook hier meegenomen te worden: anders was
 * setSuccessState de enige plek die ze liet zien, en verdween een net
 * aangemaakte afspraak weer uit beeld zodra de eerstvolgende ophaal
 * (bijvoorbeeld door een tijdelijke verbindingsstoring) mislukte, terwijl
 * de afspraak intussen wél echt in Fantastical stond.
 */
export function setErrorState(message) {
  const now = Date.now();
  for (const [id, entry] of pinnedEvents) {
    if (now - entry.pinnedAt > PIN_MAX_AGE_MS) {
      pinnedEvents.delete(id);
    }
  }
  const displayEvents = pinnedEvents.size
    ? [...rawEvents.filter((e) => !pinnedEvents.has(e.id)), ...Array.from(pinnedEvents.values()).map((entry) => entry.event)]
    : rawEvents;
  state = { ...state, events: applyAnnotations(displayEvents), lastError: message };
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
