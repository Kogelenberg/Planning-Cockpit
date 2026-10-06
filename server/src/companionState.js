import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir } from './config.js';

/**
 * Onthoudt welke afspraken al een automatisch hulp-blok opgeleverd hebben
 * (zie companionScheduler.js), zodat dat nooit dubbel gebeurt — ook niet na
 * een herstart. Drie soorten:
 *
 * - `prepBlocks` / `terugbellenBlocks`: per trigger-afspraak het aangemaakte
 *   hulp-blok (`companionId`) én de tijd (`start`/`end`, ISO) waarop dat
 *   hulp-blok destijds gezet is. Die tijd wordt elke ronde vergeleken met de
 *   nu verwachte tijd (op basis van de huidige, mogelijk verzette,
 *   trigger-afspraak) — zo verhuist het hulp-blok automatisch mee als de
 *   trigger-afspraak verzet wordt (Fantastical/de "verzet"-knop behoudt het
 *   afspraak-id, alleen start/eind veranderen).
 * - `uitwerkenBlocks`: per dag+agenda het aangemaakte "Uitwerken ..."-blok en
 *   het aantal interview/acq/bezoek-afspraken waarop de huidige duur
 *   gebaseerd is (zodat een extra afspraak die dag de duur kan bijwerken).
 *   `movedAway: true` betekent dat het blok automatisch naar een andere dag
 *   verplaatst is (zie autoMoveScheduler.js) en niet meer aangeraakt wordt.
 * - `generatedIds`: alle afspraak-id's die deze automatisering zelf heeft
 *   aangemaakt — nodig om te voorkomen dat bv. een "Uitwerken interview"-blok
 *   zichzelf de volgende ronde weer als trigger ziet (de titel bevat immers
 *   het trefwoord "interview").
 */
const COMPANION_FILE = path.join(path.dirname(config.dataFile), 'companions.json');

let state = { prepBlocks: {}, terugbellenBlocks: {}, uitwerkenBlocks: {}, generatedIds: {} };

export function loadCompanionState() {
  try {
    if (fs.existsSync(COMPANION_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(COMPANION_FILE, 'utf-8'));
      state = { ...state, ...parsed };
    }
  } catch {
    // Corrupt bestand is niet fataal; gewoon leeg beginnen.
  }
  return state;
}

function persist() {
  try {
    ensureDataDir();
    const tmpFile = `${COMPANION_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
    fs.renameSync(tmpFile, COMPANION_FILE);
  } catch {
    // Best effort; een mislukte schrijfactie mag de app niet laten crashen.
  }
}

export function isGeneratedId(eventId) {
  return Boolean(state.generatedIds[eventId]);
}

function markGenerated(eventId) {
  state.generatedIds[eventId] = true;
}

export function getPrepBlock(eventId) {
  return state.prepBlocks[eventId] || null;
}

export function setPrepBlock(eventId, value) {
  state.prepBlocks[eventId] = value;
  markGenerated(value.companionId);
  persist();
}

export function getTerugbellenBlock(eventId) {
  return state.terugbellenBlocks[eventId] || null;
}

export function setTerugbellenBlock(eventId, value) {
  state.terugbellenBlocks[eventId] = value;
  markGenerated(value.companionId);
  persist();
}

export function getUitwerkenBlock(key) {
  return state.uitwerkenBlocks[key] || null;
}

export function setUitwerkenBlock(key, value) {
  state.uitwerkenBlocks[key] = value;
  markGenerated(value.eventId);
  persist();
}

/** Zoekt het bijgehouden "Uitwerken"-blok dat bij dit afspraak-id hoort (met zijn dag+agenda-sleutel). */
export function getUitwerkenBlockByEventId(eventId) {
  for (const [key, block] of Object.entries(state.uitwerkenBlocks)) {
    if (block.eventId === eventId) return { key, ...block };
  }
  return null;
}

/**
 * Het blok is door het automatisch verplaatsen naar een andere dag gegaan:
 * de hulp-blokken laten het voortaan met rust (niet terugzetten naar zijn
 * oude dag, niet opnieuw aanmaken voor die dag).
 */
export function markUitwerkenMovedAway(key) {
  const block = state.uitwerkenBlocks[key];
  if (!block) return;
  state.uitwerkenBlocks[key] = { ...block, movedAway: true };
  persist();
}
