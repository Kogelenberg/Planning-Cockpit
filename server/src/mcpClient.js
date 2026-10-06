import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import { config } from './config.js';

let clientPromise = null;

// Fantastical's MCP-server verdraagt geen gelijktijdige aanvragen over één
// verbinding (dan volgt "XPC connection was invalidated"). Omdat de ophaalronde,
// de automatische hulp-blokken, het automatisch verplaatsen en acties vanuit
// de pagina los van elkaar kunnen draaien, gaan ALLE aanroepen door deze ene
// wachtrij: er loopt altijd maar één tegelijk.
let queue = Promise.resolve();

function serialized(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function assertBinaryExists() {
  if (!fs.existsSync(config.fantasticalMcpPath)) {
    throw new Error(
      `Fantastical MCP-server niet gevonden op ${config.fantasticalMcpPath}. Is de Fantastical-extensie geïnstalleerd?`
    );
  }
}

async function createClient() {
  assertBinaryExists();

  const transport = new StdioClientTransport({
    command: config.fantasticalMcpPath,
    args: [],
    env: { ...getDefaultEnvironment(), ...process.env },
  });

  const client = new Client({ name: 'planning-cockpit', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

async function getClient() {
  if (!clientPromise) {
    clientPromise = createClient().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

function parseToolResult(result) {
  if (result?.isError) {
    const message = result.content?.map((part) => part.text).filter(Boolean).join(' ') || 'Onbekende MCP-fout';
    throw new Error(message);
  }
  const textPart = result?.content?.find((part) => part.type === 'text');
  if (!textPart) return null;
  try {
    return JSON.parse(textPart.text);
  } catch {
    return textPart.text;
  }
}

async function callTool(name, args) {
  return serialized(async () => {
    const client = await getClient();
    return parseToolResult(await client.callTool({ name, arguments: args }));
  });
}

export async function queryCalendars() {
  return (await callTool('queryCalendars', {})) || [];
}

export async function queryCalendarItems({ query = '', when }) {
  return (await callTool('queryCalendarItems', { query, when })) || { items: [] };
}

/**
 * Wijzigt een bestaand item écht in Fantastical. `when` moet een door
 * server/src/whenFormat.js opgebouwde, ondubbelzinnige tekst zijn — dit tool
 * gebruikt Fantastical's eigen vrije-tekst-interpretatie, geen exacte
 * start/eind-velden (zie server/README voor de geteste, betrouwbare vorm).
 */
export async function modifyCalendarItem({ id, when, title, location }) {
  const args = { id };
  if (when !== undefined) args.when = when;
  if (title !== undefined) args.title = title;
  if (location !== undefined) args.location = location;
  return callTool('modifyCalendarItem', args);
}

/**
 * Maakt een nieuw item écht aan in Fantastical. `description` gebruikt
 * Fantastical's eigen vrije-tekst-parser voor titel + tijdstip (compacte,
 * parser-vriendelijke stijl, bv. "Call met Lars 2026-09-16 17:00") — een
 * volledige datum + 24-uurs tijd voorkomt de dubbelzinnigheid die een kale
 * "om 5:00" zou geven. Geeft het aangemaakte item (met `id`) terug zodat de
 * duur meteen daarna exact gezet kan worden via modifyCalendarItem.
 */
export async function createCalendarItem({ description, calendarId, location, type = 'event' }) {
  const args = { description, type };
  if (calendarId !== undefined) args.calendarId = calendarId;
  if (location !== undefined) args.location = location;
  const parsed = await callTool('createCalendarItem', args);
  const item = parsed?.items?.[0];
  if (!item) {
    throw new Error('Fantastical gaf geen aangemaakt item terug');
  }
  return item;
}

/** Sluit en vergeet de huidige MCP-verbinding, zodat de volgende call een verse start maakt. */
export async function resetMcpConnection() {
  return serialized(async () => {
    const pending = clientPromise;
    clientPromise = null;
    if (!pending) return;
    try {
      const client = await pending;
      await client.close();
    } catch {
      // Verbinding was toch al kapot; niets te doen.
    }
  });
}
