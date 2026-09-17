import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import { getState, findEventById, recomputeEvents } from './eventStore.js';
import { setNote, getAnnotation, setRescheduleHistory, clearRescheduleHistory, setNoShowPending } from './annotations.js';
import { modifyCalendarItem, createCalendarItem } from './mcpClient.js';
import { formatWhenRange, isoDateTime } from './whenFormat.js';
import { classifyEvent } from './classify.js';
import { pollOnce } from './sync.js';
import { addClient, removeClient, broadcast } from './sse.js';

const webDist = path.resolve(import.meta.dirname, '..', '..', 'web', 'dist');

// Extra controlepunt vlak vóór elke schrijfactie, los van het feit dat een
// niet-toegestane agenda sowieso al nooit in de opgehaalde events terechtkomt
// (zie calendarService.js). Twee onafhankelijke sloten op dezelfde deur.
function isCalendarAllowed(calendarId) {
  return getState().calendars.some((cal) => cal.id === calendarId);
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
    const { targetStart, reason } = req.body || {};

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
    // verzet-acties consistent blijft met wat er nu daadwerkelijk gepland staat.
    const durationMs = new Date(current.end).getTime() - new Date(current.start).getTime();
    const newEnd = new Date(newStart.getTime() + durationMs);
    const when = formatWhenRange(newStart, newEnd);

    try {
      await modifyCalendarItem({ id, when });
    } catch (err) {
      return res.status(502).json({ error: `Wijzigen in Fantastical is mislukt: ${err.message}` });
    }

    const existing = getAnnotation(id);
    const originalStart = existing?.history?.originalStart || current.start;
    const originalEnd = existing?.history?.originalEnd || current.end;
    setRescheduleHistory(id, { originalStart, originalEnd, reason });
    // Handmatig verzet vóór 17:00 vervangt een eventuele "niet doorgegaan"-vlag —
    // anders zou de noShowScheduler 'm later op de dag nog eens verplaatsen.
    setNoShowPending(id, false);

    // Haalt de zojuist gewijzigde, echte tijd meteen op i.p.v. te wachten op
    // de volgende ververscyclus.
    const state = await pollOnce();
    res.json(state);
  });

  // "Call niet doorgegaan": markeert de afspraak alleen — de daadwerkelijke
  // verplaatsing naar een vrije plek gebeurt pas om config.noShowMoveHour
  // door noShowScheduler.js (zie server/README).
  app.post('/api/events/:id/no-show', (req, res) => {
    const { id } = req.params;
    const current = findEventById(id);
    if (!current) {
      return res.status(404).json({ error: 'Afspraak niet gevonden' });
    }
    if (!isCalendarAllowed(current.calendarId)) {
      return res.status(403).json({ error: 'Deze agenda mag niet gewijzigd worden.' });
    }
    if (current.type !== 'call') {
      return res.status(400).json({ error: 'Deze knop is alleen voor belafspraken.' });
    }
    setNoShowPending(id, true);
    const state = recomputeEvents();
    broadcast('state', state);
    res.json(state);
  });

  app.delete('/api/events/:id/no-show', (req, res) => {
    const { id } = req.params;
    setNoShowPending(id, false);
    const state = recomputeEvents();
    broadcast('state', state);
    res.json(state);
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
    const calendars = getState().calendars;
    const targetCalendar = calendarId
      ? calendars.find((cal) => cal.id === calendarId)
      : calendars.find((cal) => cal.name.toLowerCase() === config.defaultNewEventCalendarName.toLowerCase());
    if (!targetCalendar || !isCalendarAllowed(targetCalendar.id) || !targetCalendar.writable) {
      return res.status(403).json({ error: 'Deze agenda is geen geldig doel voor een nieuwe afspraak.' });
    }

    const type = classifyEvent(title, undefined, config);
    const duration =
      Number(durationMinutes) > 0
        ? Number(durationMinutes)
        : type === 'call'
          ? config.defaultCallDurationMinutes
          : config.defaultEventDurationMinutes;
    const end = new Date(start.getTime() + duration * 60000);

    let created;
    try {
      created = await createCalendarItem({
        description: `${title.trim()} ${isoDateTime(start)}`,
        calendarId: targetCalendar.id,
      });
    } catch (err) {
      return res.status(502).json({ error: `Aanmaken in Fantastical is mislukt: ${err.message}` });
    }

    // Best effort: de afspraak bestaat al, dus een mislukte duur-correctie mag
    // niet de hele actie laten falen — hooguit staat de duur dan op
    // Fantastical's eigen standaard i.p.v. de hierboven berekende duur.
    try {
      await modifyCalendarItem({ id: created.id, when: formatWhenRange(start, end) });
    } catch {
      // Negeren; het item bestaat, alleen de duur kon niet gecorrigeerd worden.
    }

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
