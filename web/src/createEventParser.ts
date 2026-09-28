/**
 * Herkent titel + tijdstip in vrije tekst voor het snel toevoegen van een nieuwe
 * afspraak (bv. "call met Lars om 17:00" of "koffie met Jan morgen om 10 uur").
 * Zelfde filosofie als rescheduleParser.ts: een kleine, voorspelbare
 * regex-matcher, geen echte taalherkenning — een onherkende tijdsuitdrukking
 * levert gewoon `null` op en de gebruiker krijgt een duidelijke melding.
 */

export interface ParsedNewEvent {
  title: string;
  targetStart: Date;
}

const AM_MARKER = /\b(?:'?s\s?)?ochtends\b|\bmorgens\b/i;
const PM_MARKER = /\b(?:'?s\s?)?middags\b|\b(?:'?s\s?)?avonds\b/i;
const TOMORROW_MARKER = /\bmorgen\b/i;
const TODAY_MARKER = /\bvandaag\b/i;

const WORD_NUMBERS: Record<string, number> = {
  een: 1,
  twee: 2,
  drie: 3,
  vier: 4,
  vijf: 5,
  zes: 6,
  zeven: 7,
  acht: 8,
  negen: 9,
  tien: 10,
  elf: 11,
  twaalf: 12,
};

const NUMBER_WORD_PATTERN = Object.keys(WORD_NUMBERS).join('|');
const RELATIVE_UNIT_PATTERN = 'minuten?|min|uren?|uur|u\\b';

interface RelativeMatch {
  full: string;
  minutes: number;
}

/**
 * Herkent "over X" t.o.v. NU (niet t.o.v. een al bestaande afspraaktijd, want
 * die is er bij het aanmaken nog niet) — bv. "over een uur", "over 30
 * minuten", "over een kwartier". Zonder dit zou "call met Jan over een uur"
 * stuklopen op matchTime hieronder, dat "uur" zou lezen als een klok-tijd
 * (dus letterlijk 01:00) in plaats van "nu + 1 uur" — en dan komt de afspraak
 * op een compleet verkeerd moment terecht (buiten "vandaag", dus onzichtbaar
 * op het dashboard, terwijl hij wel echt in Fantastical staat).
 */
function matchRelative(text: string): RelativeMatch | null {
  let m = text.match(/\bover\s+(?:een\s+)?half\s?uur\b/i);
  if (m) return { full: m[0], minutes: 30 };

  m = text.match(/\bover\s+anderhalf\s?uur\b/i);
  if (m) return { full: m[0], minutes: 90 };

  m = text.match(/\bover\s+(?:een\s+)?kwartier\b/i);
  if (m) return { full: m[0], minutes: 15 };

  m = text.match(new RegExp(`\\bover\\s+(\\d+|${NUMBER_WORD_PATTERN})\\s*(${RELATIVE_UNIT_PATTERN})`, 'i'));
  if (m) {
    const amount = Number(m[1]) || WORD_NUMBERS[m[1].toLowerCase()] || 1;
    const perUnit = m[2].toLowerCase().startsWith('u') ? 60 : 1;
    return { full: m[0], minutes: amount * perUnit };
  }

  return null;
}

interface TimeMatch {
  full: string;
  hour: number;
  minute: number;
}

function matchTime(text: string): TimeMatch | null {
  let m = text.match(/\bom\s+(\d{1,2})[:.](\d{2})\b/i);
  if (m) return { full: m[0], hour: Number(m[1]), minute: Number(m[2]) };

  m = text.match(/\bom\s+(\d{1,2})\s*u(?:ur)?\b/i);
  if (m) return { full: m[0], hour: Number(m[1]), minute: 0 };

  m = text.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (m) return { full: m[0], hour: Number(m[1]), minute: Number(m[2]) };

  m = text.match(/\b(\d{1,2})\s*u(?:ur)?\b/i);
  if (m) return { full: m[0], hour: Number(m[1]), minute: 0 };

  m = text.match(/\bom\s+(\d{1,2})\b/i);
  if (m) return { full: m[0], hour: Number(m[1]), minute: 0 };

  return null;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Lost het "om 5:00"-probleem op: Fantastical's eigen parser neemt zulke uren
 * altijd letterlijk (05:00) en schuift stilzwijgend door naar morgenvroeg als
 * dat al voorbij is — voor een dagelijkse planning is dat vrijwel nooit de
 * bedoeling. Zonder expliciete 's ochtends/'s middags-aanduiding kiezen we
 * daarom de eerstvolgende van {H:00, H+12:00} die nog in de toekomst ligt; zijn
 * ze allebei al voorbij, dan gaan we naar morgen — met een voorkeur voor de
 * middag/avond-variant bij lage uren (1-6), omdat dat de gebruikelijke
 * belafspraak-uren zijn.
 */
function resolveAmbiguousHour(hour: number, minute: number, now: Date, base: Date): Date {
  if (hour >= 13 || hour === 0 || hour === 12) {
    const target = new Date(base);
    target.setHours(hour, minute, 0, 0);
    return target <= now ? addDays(target, 1) : target;
  }

  const literal = new Date(base);
  literal.setHours(hour, minute, 0, 0);
  const pm = new Date(base);
  pm.setHours(hour + 12, minute, 0, 0);

  const futureCandidates = [literal, pm].filter((d) => d > now).sort((a, b) => +a - +b);
  if (futureCandidates.length > 0) return futureCandidates[0];

  return addDays(hour >= 1 && hour <= 6 ? pm : literal, 1);
}

export function parseNewEventInput(text: string, now: Date): ParsedNewEvent | null {
  const relative = matchRelative(text);
  if (relative) {
    const title = text.replace(relative.full, ' ').replace(/\s+/g, ' ').trim();
    if (!title) return null;
    return { title, targetStart: new Date(now.getTime() + relative.minutes * 60000) };
  }

  const timeMatch = matchTime(text);
  if (!timeMatch) return null;

  const isTomorrow = TOMORROW_MARKER.test(text);
  const isAm = AM_MARKER.test(text);
  const isPm = PM_MARKER.test(text);

  const base = isTomorrow ? addDays(now, 1) : new Date(now);

  let targetStart: Date;
  if (isTomorrow) {
    targetStart = new Date(base);
    let hour = timeMatch.hour;
    if (isPm && hour < 12) hour += 12;
    targetStart.setHours(hour, timeMatch.minute, 0, 0);
  } else if (isAm) {
    targetStart = new Date(base);
    targetStart.setHours(timeMatch.hour, timeMatch.minute, 0, 0);
    if (targetStart <= now) targetStart = addDays(targetStart, 1);
  } else if (isPm) {
    targetStart = new Date(base);
    const hour = timeMatch.hour < 12 ? timeMatch.hour + 12 : timeMatch.hour;
    targetStart.setHours(hour, timeMatch.minute, 0, 0);
    if (targetStart <= now) targetStart = addDays(targetStart, 1);
  } else {
    targetStart = resolveAmbiguousHour(timeMatch.hour, timeMatch.minute, now, base);
  }

  const title = text
    .replace(timeMatch.full, ' ')
    .replace(TOMORROW_MARKER, ' ')
    .replace(TODAY_MARKER, ' ')
    .replace(AM_MARKER, ' ')
    .replace(PM_MARKER, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!title) return null;

  return { title, targetStart };
}
