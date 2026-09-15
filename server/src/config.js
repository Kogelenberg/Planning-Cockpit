import path from 'node:path';
import fs from 'node:fs';

const rootDir = path.resolve(import.meta.dirname, '..', '..');

const defaultFantasticalPath = path.join(
  process.env.HOME || '',
  'Library/Application Support/Claude/Claude Extensions/ant.dir.gh.flexibits.fantastical-mcp/server/FantasticalMCP.app/Contents/MacOS/FantasticalMCP'
);

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
  allowedCalendarNames: ['Privé', 'School', 'Hogeschool Utrecht'],

  // Indeling van agenda's in Werk / Privé voor de knoppen bovenaan het dashboard.
  // Matching op exacte agendanaam (hoofdletterongevoelig). Alleen relevant voor
  // agenda's die de allowlist hierboven al gepasseerd zijn.
  calendarCategories: {
    work: ['School', 'Hogeschool Utrecht'],
    personal: ['Privé'],
  },

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
