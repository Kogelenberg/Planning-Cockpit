import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir } from './config.js';

/**
 * Twee soorten lokale aantekeningen naast de echte Fantastical-data:
 *
 * - `note`: puur lokaal, Fantastical heeft geen schrijfbaar notitieveld
 *   (modifyCalendarItem accepteert alleen title/location/when).
 * - `history`: informatief. Een "verzet"-actie wijzigt de afspraak écht in
 *   Fantastical (via mcpClient.modifyCalendarItem) — de opgehaalde start/eind
 *   is dus al de nieuwe, echte tijd. `history` bewaart alleen de
 *   oorspronkelijke tijd + reden, zodat het detailpaneel "oorspronkelijk
 *   gepland op ..." kan tonen en je de wijziging ongedaan kunt maken.
 */
const ANNOTATIONS_FILE = path.join(path.dirname(config.dataFile), 'annotations.json');

let annotations = {};

export function loadAnnotations() {
  try {
    if (fs.existsSync(ANNOTATIONS_FILE)) {
      annotations = JSON.parse(fs.readFileSync(ANNOTATIONS_FILE, 'utf-8'));
    }
  } catch {
    annotations = {};
  }
  return annotations;
}

/**
 * Schrijft eerst naar een tijdelijk bestand en hernoemt dat pas daarna naar de
 * echte bestandsnaam. Een rename is atomisch op hetzelfde bestandssysteem, dus
 * zelfs een stroomstoring of crash midden in het schrijven kan het bestand
 * nooit half-geschreven/corrupt achterlaten — je hebt altijd óf de oude,
 * óf de volledige nieuwe versie, nooit iets ertussenin.
 */
function persist() {
  try {
    ensureDataDir();
    const tmpFile = `${ANNOTATIONS_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(annotations, null, 2));
    fs.renameSync(tmpFile, ANNOTATIONS_FILE);
  } catch {
    // Best effort; een mislukte schrijfactie mag de app niet laten crashen.
  }
}

export function getAnnotation(eventId) {
  return annotations[eventId] || null;
}

function dropIfEmpty(eventId) {
  const entry = annotations[eventId];
  if (entry && !entry.note && !entry.history) {
    delete annotations[eventId];
  }
}

export function setNote(eventId, note) {
  const trimmed = (note || '').trim();
  const existing = annotations[eventId] || {};
  annotations[eventId] = { ...existing, note: trimmed || undefined, updatedAt: new Date().toISOString() };
  dropIfEmpty(eventId);
  persist();
  return annotations[eventId] || null;
}

/** Bewaart de oorspronkelijke tijd + reden. De allereerste oorspronkelijke tijd
 * blijft behouden, ook als je een afspraak meerdere keren achter elkaar verzet. */
export function setRescheduleHistory(eventId, { originalStart, originalEnd, reason }) {
  const existing = annotations[eventId] || {};
  const previous = existing.history;
  annotations[eventId] = {
    ...existing,
    history: {
      originalStart: previous?.originalStart || originalStart,
      originalEnd: previous?.originalEnd || originalEnd,
      reason: reason || null,
      changedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
  persist();
  return annotations[eventId];
}

export function clearRescheduleHistory(eventId) {
  const existing = annotations[eventId];
  if (!existing) return null;
  const { history, ...rest } = existing;
  annotations[eventId] = rest;
  dropIfEmpty(eventId);
  persist();
  return annotations[eventId] || null;
}

/** Ruimt geschiedenis op ruim (30 dagen) na de oorspronkelijke tijd op, zodat het bestand niet onbeperkt groeit. */
function pruneStale(now) {
  const cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [eventId, entry] of Object.entries(annotations)) {
    if (entry.history && new Date(entry.history.originalEnd).getTime() < cutoff) {
      delete entry.history;
      changed = true;
      dropIfEmpty(eventId);
    }
  }
  if (changed) persist();
}

/** Voegt notities en verzet-geschiedenis toe aan de live opgehaalde events. */
export function applyAnnotations(rawEvents, now = new Date()) {
  pruneStale(now);
  return rawEvents.map((event) => {
    const entry = annotations[event.id];
    if (!entry) return event;
    const result = { ...event };
    if (entry.note) result.note = entry.note;
    if (entry.history) {
      result.originalStart = entry.history.originalStart;
      result.originalEnd = entry.history.originalEnd;
      result.rescheduled = true;
      if (entry.history.reason) result.rescheduleReason = entry.history.reason;
    }
    return result;
  });
}
