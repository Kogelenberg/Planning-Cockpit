import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import { getState, findEventById, recomputeEvents } from './eventStore.js';
import { setNote, getAnnotation, setRescheduleHistory, clearRescheduleHistory } from './annotations.js';
import { modifyCalendarItem } from './mcpClient.js';
import { formatWhenRange } from './whenFormat.js';
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

    // Haalt de zojuist gewijzigde, echte tijd meteen op i.p.v. te wachten op
    // de volgende ververscyclus.
    const state = await pollOnce();
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

  return app;
}

export function startServer() {
  const app = createApp();
  return app.listen(config.port, () => {
    console.log(`Planning cockpit draait op http://localhost:${config.port}`);
  });
}
