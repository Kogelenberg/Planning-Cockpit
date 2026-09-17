import path from 'node:path';
import fs from 'node:fs';

const rootDir = path.resolve(import.meta.dirname, '..', '..');

const defaultFantasticalPath = path.join(
  process.env.HOME || '',
  'Library/Application Support/Claude/Claude Extensions/ant.dir.gh.flexibits.fantastical-mcp/server/FantasticalMCP.app/Contents/MacOS/FantasticalMCP'
);

/**
 * Komma-gescheiden lijst uit een env-var, of de fallback als die niet gezet is.
 * Bestaat zodat dezelfde codebase (bv. op een andere Mac, met haar eigen
 * agenda-namen) zonder code-wijziging werkt — alleen via env-vars, die je
 * lokaal in `.env.local` zet (nooit in git, zie .gitignore).
 */
function parseList(envVar, fallback) {
  if (!envVar) return fallback;
  return envVar
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT) || 4173,
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 3 * 60 * 1000,
  dataFile: path.join(rootDir, 'data', 'cache.json'),

  // Pad naar de lokale Fantastical MCP-server (macOS Claude Extension bundle).
  // Kan overschreven worden via FANTASTICAL_MCP_PATH als de extensie ergens anders staat.
  fantasticalMcpPath: process.env.FANTASTICAL_MCP_PATH || defaultFantasticalPath,

  // Alleen gebruikt als de directe MCP-verbinding structureel faalt.
  // Zet ICS_FEED_URL (webcal/https-link naar een .ics feed) om deze fallback te activeren.
  icsFeedUrl: process.env.ICS_FEED_URL || null,

  // We vragen een ruimer venster op dan "vandaag" omdat Fantastical's "when"-parameter
  // vaag natuurlijke taal is en niet betrouwbaar strak filtert (zie server/README).
  // De echte "vandaag"-filtering gebeurt client-side op basis van start/eind-tijdstippen.
  // Ruim vooruit (5 weken) omdat een verzet-actie nu een echte Fantastical-wijziging
  // is: die moet ook weken later nog gewoon terug opgehaald kunnen worden.
  fetchWindowDaysBack: 2,
  fetchWindowDaysForward: 35,

  // Harde toegangsbeperking: alleen agenda's op deze lijst worden ooit
  // opgehaald, getoond of gewijzigd — alles daarbuiten (bv. "Familie") komt
  // nooit in de events/calendars van de app terecht, ongeacht wat er verder
  // in de code gebeurt. Matching op exacte agendanaam (hoofdletterongevoelig).
  // Dit is bewust een allowlist, geen blocklist: nieuw toegevoegde agenda's
  // in Fantastical zijn standaard NIET zichtbaar totdat ze hier expliciet
  // bij staan.
  // Override via env: ALLOWED_CALENDAR_NAMES="Agenda A,Agenda B" (komma-gescheiden).
  allowedCalendarNames: parseList(process.env.ALLOWED_CALENDAR_NAMES, ['Privé', 'School', 'Hogeschool Utrecht']),

  // Indeling van agenda's in Werk / Privé voor de knoppen bovenaan het dashboard.
  // Matching op exacte agendanaam (hoofdletterongevoelig). Alleen relevant voor
  // agenda's die de allowlist hierboven al gepasseerd zijn.
  // Override via env: WORK_CALENDAR_NAMES / PERSONAL_CALENDAR_NAMES (komma-gescheiden).
  calendarCategories: {
    work: parseList(process.env.WORK_CALENDAR_NAMES, ['School', 'Hogeschool Utrecht']),
    personal: parseList(process.env.PERSONAL_CALENDAR_NAMES, ['Privé']),
  },

  // Agenda waarin de "+"-knop nieuwe afspraken aanmaakt. Moet op de allowlist
  // hierboven staan; wordt ook expliciet gecontroleerd bij het aanmaken zelf.
  // Override via env: DEFAULT_NEW_EVENT_CALENDAR_NAME.
  defaultNewEventCalendarName: process.env.DEFAULT_NEW_EVENT_CALENDAR_NAME || 'Privé',

  // Standaardduur (in minuten) voor nieuw aangemaakte afspraken via de
  // "+"-knop: bellen is kort, andere afspraken krijgen Fantastical's eigen
  // gebruikelijke uur.
  defaultCallDurationMinutes: 30,
  defaultEventDurationMinutes: 60,

  // "Call niet doorgegaan"-knop: om dit uur (24-uurs, lokale tijd) worden alle
  // die dag zo gemarkeerde afspraken automatisch naar de eerste vrije plek de
  // dag erna verplaatst. Override via env: NO_SHOW_MOVE_HOUR.
  noShowMoveHour: Number(process.env.NO_SHOW_MOVE_HOUR) || 17,

  // Agenda waarin naar een vrije plek gezocht wordt voor een verplaatste
  // "niet doorgegaan"-afspraak. Moet op de allowlist staan. Nu nog de
  // schoolagenda (voor het testen) — later waarschijnlijk een andere agenda.
  // Override via env: NO_SHOW_TARGET_CALENDAR_NAME.
  noShowTargetCalendarName: process.env.NO_SHOW_TARGET_CALENDAR_NAME || 'School',

  // Venster (lokale uren) waarbinnen een vrije plek gezocht wordt — buiten dit
  // venster (bv. midden in de nacht) wordt nooit een plek voorgesteld.
  freeSlotWindowStartHour: Number(process.env.FREE_SLOT_WINDOW_START_HOUR) || 8,
  freeSlotWindowEndHour: Number(process.env.FREE_SLOT_WINDOW_END_HOUR) || 18,

  // Hoeveel dagen vooruit maximaal gezocht wordt als een dag volledig vol zit,
  // voordat het opgeeft (en de afspraak gemarkeerd blijft voor een volgende poging).
  freeSlotMaxDaysAhead: 5,

  // Aanpasbare trefwoordenlijsten voor de bel/extern/intern-classificatie.
  // Matching is case-insensitive substring-match op de titel.
  callKeywords: [
    'bellen',
    'bel ',
    '(bel)',
    'telefoon',
    'telefonisch',
    'call',
    'inbellen',
  ],
  externalKeywords: [
    'bij ',
    'op locatie',
    'kantoor',
    'bezoek',
    'klant',
    'customer',
    'site visit',
  ],
  // Locaties die op een videogesprek wijzen worden behandeld als "Bellen":
  // Fantastical levert geen telefoonnummerveld, dit is de dichtstbijzijnde
  // beschikbare vervangende indicator voor "op afstand, niet fysiek".
  videoLinkPatterns: [
    'meet.google.com',
    'zoom.us',
    'teams.microsoft.com',
    'teams.live.com',
    'webex.com',
    'whereby.com',
  ],

  // Sommige adressen staan (zonder apart locatieveld) in de titel geplakt, bv.
  // "13.45 Rb Retina Traaij 42, 3971 GP Driebergen". Een Nederlandse postcode
  // in de titel is dan ook een signaal voor "extern".
  postalCodePattern: /\b\d{4}\s?[a-z]{2}\b/i,
};

export function ensureDataDir() {
  fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
}
