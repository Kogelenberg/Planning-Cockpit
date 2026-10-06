import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import {
  getState,
  findEventById,
  recomputeEvents,
  pinEvent,
  updatePinnedEvent,
  patchRawEvent,
  noteDoneToggle,
} from './eventStore.js';
import { setNote, getAnnotation, setRescheduleHistory, clearRescheduleHistory } from './annotations.js';
import { modifyCalendarItem, createCalendarItem } from './mcpClient.js';
import { formatWhenRange, isoDateTime } from './whenFormat.js';
import { classifyEvent, classifyDurationMinutes, isBusyBlockingEvent, withDoneMark } from './classify.js';
import { pollOnce } from './sync.js';
import { addClient, removeClient, broadcast } from './sse.js';

const webDist = path.resolve(import.meta.dirname, '..', '..', 'web', 'dist');

// Extra controlepunt vlak vóór elke schrijfactie, los van het feit dat een
// niet-toegestane agenda sowieso al nooit in de opgehaalde events terechtkomt
// (zie calendarService.js). Twee onafhankelijke sloten op dezelfde deur.
function isCalendarAllowed(calendarId) {
  return getState().calendars.some((cal) => cal.id === calendarId);
}

/**
 * Standaardduur van een nieuwe afspraak op basis van de titel: een
 * trefwoord-duur (teams gesprek/interview/acq: 1,5 uur) wint, anders 15
 * minuten voor een call (bellen, peptalk, ...) en 1 uur voor de rest.
 */
function defaultDurationMinutes(title) {
  const keywordDuration = classifyDurationMinutes(title, config);
  if (keywordDuration) return keywordDuration;
  return classifyEvent(title, undefined, config) === 'call'
    ? config.defaultCallDurationMinutes
    : config.defaultEventDurationMinutes;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function formatTimeRange(start, end) {
  const fmt = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${fmt.format(start)}–${fmt.format(end)}`;
}

/**
 * Zoekt een bestaand, "bezet" item (zie classify.js: isBusyBlockingEvent —
 * belletjes, videogesprekken, teams-gesprek/interview/acq) dat overlapt met
 * het opgegeven tijdvak. `excludeId` sluit de afspraak die je zelf aan het
 * verzetten bent uit, anders zou die altijd met zichzelf conflicteren.
 * Gebruikt bij zowel het aanmaken als het verzetten van een afspraak, zodat
 * er nooit iets nieuws bovenop een lopend belletje/gesprek gepland wordt.
 */
function findBlockingConflict({ start, end, excludeId }) {
  return (
    getState().events.find((event) => {
      if (excludeId && event.id === excludeId) return false;
      if (!isBusyBlockingEvent(event, config)) return false;
      return overlaps(start, end, new Date(event.start), new Date(event.end));
    }) || null
  );
}

export function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.static(webDist));

  app.get('/api/state', (req, res) => {
    res.json(getState());
  });

  // Server-Sent Events: pusht elke nieuwe stand naar alle open tabbladen,
  // zodat de pagina de hele dag open kan staan zonder handmatige refresh.
  app.get('/api/events/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': verbonden\n\n');
    res.write(`event: state\ndata: ${JSON.stringify(getState())}\n\n`);

    addClient(res);
    req.on('close', () => removeClient(res));
  });

  // Notities blijven puur lokaal (zie server/src/annotations.js) — Fantastical
  // heeft geen schrijfbaar notitieveld, dus dit wijzigt nooit de echte agenda.
  app.post('/api/events/:id/note', (req, res) => {
    const { id } = req.params;
    const { note } = req.body || {};
    if (typeof note !== 'string') {
      return res.status(400).json({ error: 'note (string) is verplicht' });
    }
    setNote(id, note);
    const state = recomputeEvents();
    broadcast('state', state);
    res.json(state);
  });

  // Verzet de afspraak ECHT in Fantastical (via MCP modifyCalendarItem) —
  // dit is dus geen lokale weergave-truc meer, maar een echte wijziging die
  // overal doorkomt waar die agenda gesynchroniseerd wordt.
  app.post('/api/events/:id/reschedule', async (req, res) => {
    const { id } = req.params;
    const { targetStart, reason, durationMinutes } = req.body || {};

    const current = findEventById(id);
    if (!current) {
      return res.status(404).json({ error: 'Afspraak niet gevonden' });
    }
    if (!isCalendarAllowed(current.calendarId)) {
      return res.status(403).json({ error: 'Deze agenda mag niet gewijzigd worden.' });
    }
    if (typeof targetStart !== 'string') {
      return res.status(400).json({ error: 'targetStart is verplicht' });
    }
    const newStart = new Date(targetStart);
    if (Number.isNaN(newStart.getTime())) {
      return res.status(400).json({ error: 'targetStart is geen geldige datum/tijd' });
    }

    // Duur t.o.v. de HUIDIGE (echte, net opgehaalde) tijd, zodat een reeks
    // verzet-acties consistent blijft met wat er nu daadwerkelijk gepland staat
    // — tenzij de pagina bewust een andere duur meegeeft (tijdbalk met begin
    // én eind).
    const requestedMinutes = Number(durationMinutes);
    const durationMs =
      requestedMinutes > 0
        ? requestedMinutes * 60000
        : new Date(current.end).getTime() - new Date(current.start).getTime();
    const newEnd = new Date(newStart.getTime() + durationMs);

    // Mag niet bovenop een ander belletje/gesprek terechtkomen (zie
    // findBlockingConflict hierboven) — de afspraak die je zelf verzet
    // telt daarbij niet mee als conflict met zichzelf.
    const conflict = findBlockingConflict({ start: newStart, end: newEnd, excludeId: id });
    if (conflict) {
      return res.status(409).json({
        error: `Dit overlapt met "${conflict.title}" (${formatTimeRange(new Date(conflict.start), new Date(conflict.end))}). Kies een ander tijdstip.`,
      });
    }

    const when = formatWhenRange(newStart, newEnd);

    try {
      await modifyCalendarItem({ id, when });
    } catch (err) {
      return res.status(502).json({ error: `Wijzigen in Fantastical is mislukt: ${err.message}` });
    }
    // Als dit een lokaal vastgehouden afspraak is (zie eventStore.js), moet
    // die kopie meeveranderen — anders duikt na de eerstvolgende ophaal de
    // oude tijd weer op.
    updatePinnedEvent(id, { start: newStart.toISOString(), end: newEnd.toISOString() });

    const existing = getAnnotation(id);
    const originalStart = existing?.history?.originalStart || current.start;
    const originalEnd = existing?.history?.originalEnd || current.end;
    setRescheduleHistory(id, { originalStart, originalEnd, reason });

    // Haalt de zojuist gewijzigde, echte tijd meteen op i.p.v. te wachten op
    // de volgende ververscyclus.
    const state = await pollOnce();
    res.json(state);
  });

  // Afvinken: zet een vinkje (✓) voor de titel in Fantastical zelf, zodat je het
  // overal ziet waar die agenda staat. Een niet afgevinkte, verplaatsbare
  // afspraak gaat 's avonds automatisch naar de volgende werkdag (zie
  // autoMoveScheduler.js). De lokale stand wordt meteen aangepast, zodat het
  // vinkje direct geldt; mislukt het schrijven in Fantastical, dan gaat dat
  // terug.
  app.post('/api/events/:id/done', async (req, res) => {
    const { id } = req.params;
    const { done } = req.body || {};
    if (typeof done !== 'boolean') {
      return res.status(400).json({ error: 'done (true/false) is verplicht' });
    }
    const current = findEventById(id);
    if (!current) {
      return res.status(404).json({ error: 'Afspraak niet gevonden' });
    }
    const calendar = getState().calendars.find((cal) => cal.id === current.calendarId);
    if (!calendar || !calendar.writable) {
      return res.status(403).json({ error: 'Deze agenda mag niet gewijzigd worden.' });
    }

    const newTitle = withDoneMark(current.title, done, config);
    if (newTitle === current.title) {
      return res.json(getState());
    }

    noteDoneToggle(id);
    const previousTitle = current.title;
    broadcast('state', patchRawEvent(id, { title: newTitle }));
    try {
      await modifyCalendarItem({ id, title: newTitle });
    } catch (err) {
      broadcast('state', patchRawEvent(id, { title: previousTitle }));
      return res.status(502).json({ error: `Wijzigen in Fantastical is mislukt: ${err.message}` });
    }
    res.json(getState());
  });

  // Standaardduur voor de tijdbalk in het "+"-scherm, op basis van de titel.
  app.get('/api/default-duration', (req, res) => {
    const title = typeof req.query.title === 'string' ? req.query.title : '';
    res.json({ durationMinutes: defaultDurationMinutes(title) });
  });

  // Zet de afspraak terug naar zijn oorspronkelijke tijd — ook dit is een
  // echte wijziging in Fantastical, geen lokale ongedaan-actie.
  app.delete('/api/events/:id/reschedule', async (req, res) => {
    const { id } = req.params;
    const existing = getAnnotation(id);
    if (!existing?.history) {
      return res.json(getState());
    }
    const current = findEventById(id);
    if (current && !isCalendarAllowed(current.calendarId)) {
      return res.status(403).json({ error: 'Deze agenda mag niet gewijzigd worden.' });
    }

    const when = formatWhenRange(new Date(existing.history.originalStart), new Date(existing.history.originalEnd));
    try {
      await modifyCalendarItem({ id, when });
    } catch (err) {
      return res.status(502).json({ error: `Terugzetten in Fantastical is mislukt: ${err.message}` });
    }

    clearRescheduleHistory(id);
    updatePinnedEvent(id, { start: existing.history.originalStart, end: existing.history.originalEnd });
    const state = await pollOnce();
    res.json(state);
  });

  // Maakt een nieuwe afspraak ECHT aan in Fantastical, altijd in
  // `config.defaultNewEventCalendarName` (staat sowieso al op de allowlist).
  // De titel/tijd komt uit een client-side geparste vrije tekst; de duur wordt
  // hier bepaald (bellen: kort, anders: Fantastical's gebruikelijke uur) en
  // meteen na het aanmaken exact vastgezet via modifyCalendarItem — net als bij
  // verzetten vertrouwen we niet op Fantastical's eigen duur-interpretatie.
  app.post('/api/events', async (req, res) => {
    const { title, targetStart, durationMinutes, calendarId } = req.body || {};

    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is verplicht' });
    }
    if (typeof targetStart !== 'string') {
      return res.status(400).json({ error: 'targetStart is verplicht' });
    }
    const start = new Date(targetStart);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ error: 'targetStart is geen geldige datum/tijd' });
    }

    // Kies de opgegeven agenda, of val terug op de standaard — in beide
    // gevallen moet die zowel op de allowlist staan ALS schrijfbaar zijn
    // (bv. "Hogeschool Utrecht" staat wel op de allowlist om te tonen, maar
    // is een alleen-lezen gedeelde agenda en dus nooit een geldig doel hier).
    // Zonder expliciete agenda: de ingestelde standaardagenda, of — als er maar
    // één schrijfbare agenda is (bv. alleen "Werk Brecs") — gewoon die ene.
    const calendars = getState().calendars;
    const writableCalendars = calendars.filter((cal) => cal.writable);
    const targetCalendar = calendarId
      ? calendars.find((cal) => cal.id === calendarId)
      : calendars.find((cal) => cal.name.toLowerCase() === config.defaultNewEventCalendarName.toLowerCase()) ??
        (writableCalendars.length === 1 ? writableCalendars[0] : undefined);
    if (!targetCalendar || !isCalendarAllowed(targetCalendar.id) || !targetCalendar.writable) {
      return res.status(403).json({ error: 'Deze agenda is geen geldig doel voor een nieuwe afspraak.' });
    }

    const type = classifyEvent(title, undefined, config);
    // Een expliciet meegegeven durationMinutes (tijdbalk) wint altijd; anders de
    // standaardduur op basis van de titel (zie defaultDurationMinutes).
    const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : defaultDurationMinutes(title);
    const end = new Date(start.getTime() + duration * 60000);

    // Mag niet bovenop een ander belletje/gesprek gepland worden (zie
    // findBlockingConflict hierboven).
    const conflict = findBlockingConflict({ start, end });
    if (conflict) {
      return res.status(409).json({
        error: `Dit overlapt met "${conflict.title}" (${formatTimeRange(new Date(conflict.start), new Date(conflict.end))}). Kies een ander tijdstip.`,
      });
    }

    let created;
    try {
      created = await createCalendarItem({
        description: `${title.trim()} ${isoDateTime(start)}`,
        calendarId: targetCalendar.id,
      });
    } catch (err) {
      return res.status(502).json({ error: `Aanmaken in Fantastical is mislukt: ${err.message}` });
    }

    // Best effort: de afspraak bestaat al, dus een mislukte titel/duur-correctie
    // mag niet de hele actie laten falen — hooguit staat de titel/duur dan op
    // wat Fantastical zelf verzon i.p.v. wat hierboven bedoeld was.
    //
    // Belangrijke uitzoekbevinding: Fantastical's eigen datumherkenning leest
    // een woord als "Jan" (een heel gewone naam) soms als de maand januari,
    // en verknoeit dan zowel de datum ALS de titel (bv. "interview met Jan"
    // wordt "interview met" — "Jan" verdwijnt). Daarom hier ook expliciet de
    // titel opnieuw meegeven, niet alleen `when`.
    try {
      await modifyCalendarItem({ id: created.id, title: title.trim(), when: formatWhenRange(start, end) });
    } catch {
      // Negeren; het item bestaat, alleen titel/duur konden niet gecorrigeerd worden.
    }

    // Fantastical's queryCalendarItems (met lege zoekterm, zie calendarService.js)
    // geeft een net aangemaakt item soms niet terug — ook niet na lang wachten;
    // dit is dus geen kort synchronisatiemomentje maar een onbetrouwbare zoekopdracht
    // aan Fantastical's kant. In plaats van daarop te wachten/hopen, houden we onze
    // eigen kopie van de nieuwe afspraak vast (zie eventStore.js: pinEvent) zodat hij
    // altijd meteen in de cockpit verschijnt, tot Fantastical 'm zelf ook teruggeeft.
    pinEvent({
      id: created.id,
      title: title.trim(),
      start: start.toISOString(),
      end: end.toISOString(),
      calendarId: targetCalendar.id,
      calendarName: targetCalendar.name,
      isAllDay: false,
      type,
    });
    const state = await pollOnce();
    res.json(state);
  });

  return app;
}

export function startServer() {
  const app = createApp();
  return app.listen(config.port, () => {
    console.log(`Planning cockpit draait op http://localhost:${config.port}`);
  });
}
