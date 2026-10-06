import { config } from './config.js';
import { getState } from './eventStore.js';
import { matchesKeyword, isDoneTitle, withDoneMark } from './classify.js';
import { createCalendarItem, modifyCalendarItem } from './mcpClient.js';
import { formatWhenRange, isoDateTime } from './whenFormat.js';
import {
  loadCompanionState,
  isGeneratedId,
  getPrepBlock,
  setPrepBlock,
  getTerugbellenBlock,
  setTerugbellenBlock,
  getUitwerkenBlock,
  setUitwerkenBlock,
} from './companionState.js';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(date) {
  const d = startOfDay(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isCalendarWritable(calendarId) {
  return getState().calendars.some((cal) => cal.id === calendarId && cal.writable);
}

function matchedAutoCompanionKeyword(title) {
  const normalized = (title || '').toLowerCase();
  return config.autoCompanionKeywords.find((keyword) => matchesKeyword(normalized, keyword)) || null;
}

function matchesFirstConversation(title) {
  return matchesKeyword((title || '').toLowerCase(), config.firstConversationKeyword);
}

/** Haalt de kandidaatnaam uit bv. "Eerste gesprek Jan Jansen" of "Eerste gesprek (Jan Jansen)". */
function extractNameAfterKeyword(title, keyword) {
  const idx = title.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return '';
  return title
    .slice(idx + keyword.length)
    .trim()
    .replace(/^[:\-(]+/, '')
    .replace(/[)]+$/, '')
    .trim();
}

/**
 * Belangrijke uitzoekbevinding: Fantastical's eigen datumherkenning leest een
 * woord als "Jan" (heel gewone Nederlandse naam) soms als de maand januari,
 * en verknoeit dan zowel de datum ALS de titel (het stript "Jan" eruit,
 * bijvoorbeeld "interview met Jan" wordt "interview met"). Losse titel-tekst
 * meegeven aan `createCalendarItem` is dus niet genoeg — na het aanmaken
 * zetten we daarom zowel `title` als `when` expliciet nog een keer vast via
 * modifyCalendarItem, in plaats van te vertrouwen op wat Fantastical zelf
 * uit de description destilleerde.
 */
/**
 * Een hulp-blok dat al is afgevinkt ("✓ Uitwerken acq") behoudt zijn vinkje
 * als de automatisering later zijn titel bijwerkt.
 */
function titleKeepingDoneMark(title, companionId, events) {
  const current = events.find((e) => e.id === companionId);
  return current && isDoneTitle(current.title, config) ? withDoneMark(title, true, config) : title;
}

async function createExactBlock({ title, start, end, calendarId }) {
  const created = await createCalendarItem({ description: `${title} ${isoDateTime(start)}`, calendarId });
  try {
    await modifyCalendarItem({ id: created.id, title, when: formatWhenRange(start, end) });
  } catch {
    // Best effort: het blok bestaat al, alleen titel/duur konden niet exact gezet worden.
  }
  return created.id;
}

/**
 * Draait na elke geslaagde ophaal. Maakt automatisch drie soorten hulp-
 * afspraken aan, telkens in dezelfde agenda als de afspraak die de trigger
 * was — nooit als de agenda niet schrijfbaar is. Alles is idempotent (zie
 * companionState.js): een afspraak die al een blok opgeleverd heeft, krijgt
 * er nooit een tweede bij, ook niet over herstarts heen. Gooit nooit — een
 * enkele mislukking mag de rest van de ronde niet blokkeren.
 *
 * 1. "Voorbereiden en link Teams sturen" — plakt direct vóór elke
 *    interview/acq/bezoek-afspraak (config.autoCompanionKeywords). Verhuist
 *    automatisch mee als die afspraak verzet wordt (zelfde afspraak-id blijft
 *    behouden bij een verzet, zie server.js's /reschedule-route): elke ronde
 *    wordt de opgeslagen tijd vergeleken met de nu verwachte tijd, en alleen
 *    bij een verschil wordt het blok verplaatst.
 * 2. "Uitwerken ..." — één blok per dag+agenda om config.followUpHour, met
 *    een duur die meegroeit met het aantal interview/acq/bezoek-afspraken
 *    die dag (nooit krimpt als er eentje wegvalt — alleen groeien, nooit
 *    verwijderen, zie het "nooit deleteCalendarItem"-principe elders).
 * 3. "Terugbellen [naam]" — direct ná elke "eerste gesprek"-afspraak: die
 *    is bewust niet blokkerend (degene die de agenda beheert is er zelf niet
 *    bij), dus dit mag overlappen met calls en andere afspraken. Verhuist
 *    net als het voorbereiden-blok automatisch mee bij een verzet.
 */
export async function runCompanionScheduler(events) {
  loadCompanionState();

  const relevant = events.filter((e) => !e.isAllDay && !isGeneratedId(e.id));
  const dayGroups = new Map();

  for (const event of relevant) {
    const keyword = matchedAutoCompanionKeyword(event.title);
    if (!keyword) continue;
    if (!isCalendarWritable(event.calendarId)) continue;

    const start = new Date(event.start);
    const groupKey = `${event.calendarId}|${dateKey(start)}`;
    if (!dayGroups.has(groupKey)) dayGroups.set(groupKey, { calendarId: event.calendarId, dayKey: dateKey(start), events: [] });
    dayGroups.get(groupKey).events.push({ event, keyword });

    const prepStart = new Date(start.getTime() - config.prepReminderMinutes * 60000);
    const prepStartIso = prepStart.toISOString();
    const prepEndIso = start.toISOString();
    const existingPrep = getPrepBlock(event.id);

    if (!existingPrep) {
      try {
        const createdId = await createExactBlock({
          title: config.prepReminderTitle,
          start: prepStart,
          end: start,
          calendarId: event.calendarId,
        });
        setPrepBlock(event.id, { companionId: createdId, start: prepStartIso, end: prepEndIso });
      } catch (err) {
        console.error(`[companionScheduler] Voorbereiden-blok voor "${event.title}" mislukt:`, err.message);
      }
    } else if (existingPrep.start !== prepStartIso || existingPrep.end !== prepEndIso) {
      try {
        await modifyCalendarItem({ id: existingPrep.companionId, when: formatWhenRange(prepStart, start) });
        setPrepBlock(event.id, { companionId: existingPrep.companionId, start: prepStartIso, end: prepEndIso });
      } catch (err) {
        console.error(`[companionScheduler] Voorbereiden-blok verplaatsen voor "${event.title}" mislukt:`, err.message);
      }
    }
  }

  for (const [groupKey, group] of dayGroups) {
    const count = group.events.length;
    const expectedDuration = config.followUpBaseDurationMinutes + config.followUpExtraDurationMinutes * (count - 1);
    const [year, month, day] = group.dayKey.split('-').map(Number);
    const blockStart = new Date(year, month - 1, day, config.followUpHour, 0, 0, 0);
    const blockEnd = new Date(blockStart.getTime() + expectedDuration * 60000);
    const existing = getUitwerkenBlock(groupKey);
    const distinctKeywords = Array.from(new Set(group.events.map((g) => g.keyword)));
    const title = `${config.followUpTitlePrefix} ${distinctKeywords.join(', ')}`;

    if (existing?.movedAway) continue;

    if (!existing) {
      try {
        const createdId = await createExactBlock({ title, start: blockStart, end: blockEnd, calendarId: group.calendarId });
        setUitwerkenBlock(groupKey, { eventId: createdId, count });
      } catch (err) {
        console.error(`[companionScheduler] Uitwerken-blok voor ${group.dayKey} mislukt:`, err.message);
      }
    } else if (existing.count !== count) {
      try {
        // Titel ook bijwerken: een tweede afspraak kan een ander trefwoord
        // toevoegen (bv. "Uitwerken interview" -> "Uitwerken interview, acq").
        await modifyCalendarItem({
          id: existing.eventId,
          title: titleKeepingDoneMark(title, existing.eventId, events),
          when: formatWhenRange(blockStart, blockEnd),
        });
        setUitwerkenBlock(groupKey, { eventId: existing.eventId, count });
      } catch (err) {
        console.error(`[companionScheduler] Uitwerken-blok bijwerken voor ${group.dayKey} mislukt:`, err.message);
      }
    }
  }

  // --- "Eerste gesprek [naam]" -> "Terugbellen [naam]" direct erna ---
  for (const event of relevant) {
    if (!matchesFirstConversation(event.title)) continue;
    if (!isCalendarWritable(event.calendarId)) continue;

    const name = extractNameAfterKeyword(event.title, config.firstConversationKeyword);
    const title = name ? `${config.followUpCallTitle} ${name}` : config.followUpCallTitle;
    const start = new Date(event.end);
    const end = new Date(start.getTime() + config.followUpCallDurationMinutes * 60000);
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const existing = getTerugbellenBlock(event.id);

    if (!existing) {
      try {
        const createdId = await createExactBlock({ title, start, end, calendarId: event.calendarId });
        setTerugbellenBlock(event.id, { companionId: createdId, start: startIso, end: endIso });
      } catch (err) {
        console.error(`[companionScheduler] Terugbellen-blok voor "${event.title}" mislukt:`, err.message);
      }
    } else if (existing.start !== startIso || existing.end !== endIso) {
      try {
        await modifyCalendarItem({
          id: existing.companionId,
          title: titleKeepingDoneMark(title, existing.companionId, events),
          when: formatWhenRange(start, end),
        });
        setTerugbellenBlock(event.id, { companionId: existing.companionId, start: startIso, end: endIso });
      } catch (err) {
        console.error(`[companionScheduler] Terugbellen-blok verplaatsen voor "${event.title}" mislukt:`, err.message);
      }
    }
  }
}
