/**
 * Herkent een verzet-instructie in vrije tekst (de notitie), zodat je niet per se
 * de knoppen hoeft te gebruiken — typ je "30 minuten vertraagd" of "over 2 uur
 * terugbellen", dan verzet Planning Cockpit de afspraak automatisch mee.
 *
 * Dit is bewust een kleine, voorspelbare regex-matcher en geen echte taalherkenning:
 * hij mist soms een ongebruikelijke formulering, maar geeft dan simpelweg niets terug
 * (de knoppen in het detailpaneel blijven altijd werken als achtervang).
 */

export interface ParsedReschedule {
  /** Absolute doeltijd (ISO), al berekend t.o.v. het juiste ankerpunt. */
  targetStart: Date;
  reason: string;
  /** Signatuur om te bepalen of dezelfde instructie al eerder is toegepast. */
  signature: string;
}

const UNIT_MINUTES: Record<string, number> = {
  min: 1,
  minuut: 1,
  minuten: 1,
  uur: 60,
  uren: 60,
  u: 60,
  dag: 1440,
  dagen: 1440,
  week: 10080,
  weken: 10080,
};

const UNIT_PATTERN = 'min(?:uut|uten)?|uur|uren|u\\b|dag(?:en)?|we(?:e)?k(?:en)?';

function unitToMinutes(rawUnit: string): number {
  const key = rawUnit.toLowerCase().replace(/\.$/, '');
  return UNIT_MINUTES[key] ?? UNIT_MINUTES[key.replace(/^u$/, 'uur')] ?? 60;
}

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

/**
 * Zet veelgebruikte Nederlandse getal-woorden en tijdsuitdrukkingen om naar
 * cijfers, zodat "over een uur" of "een kwartier vertraagd" hetzelfde werken
 * als "over 1 uur" / "15 minuten vertraagd".
 */
function normalizeDutchNumbers(text: string): string {
  let result = text
    .replace(/\banderhalf\s?uur\b/gi, '90 minuten')
    .replace(/\b(?:een\s+)?half\s?uur\b/gi, '30 minuten')
    .replace(/\b(?:een\s+)?kwartier\b/gi, '15 minuten');

  result = result.replace(/\b(een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\b/gi, (match) => {
    const n = WORD_NUMBERS[match.toLowerCase()];
    return n ? String(n) : match;
  });

  return result;
}

export function parseRescheduleInstruction(
  text: string,
  currentStart: Date,
  now: Date
): ParsedReschedule | null {
  const t = normalizeDutchNumbers(text).toLowerCase();

  // 1. Absolute tijd: "om 15:00" / "naar 9.30"
  const absoluteMatch = t.match(/\b(?:om|naar)\s+(\d{1,2})[:.](\d{2})\b/);
  if (absoluteMatch) {
    const hours = Number(absoluteMatch[1]);
    const minutes = Number(absoluteMatch[2]);
    if (hours < 24 && minutes < 60) {
      const target = new Date(currentStart);
      target.setHours(hours, minutes, 0, 0);
      return {
        targetStart: target,
        reason: `Automatisch verzet naar ${absoluteMatch[1]}:${absoluteMatch[2]} (uit notitie)`,
        signature: `abs:${hours}:${minutes}`,
      };
    }
  }

  // 2. Vertraagd/uitgesteld t.o.v. de huidige geplande tijd: "30 minuten vertraagd",
  //    "vertraagd met 2 uur", "1 dag uitgesteld"
  const delayMatch =
    t.match(new RegExp(`\\b(\\d+)\\s*(${UNIT_PATTERN})\\s+(vertraagd|later|uitgesteld)\\b`)) ||
    t.match(new RegExp(`\\b(?:vertraagd|uitgesteld)\\s+met\\s+(\\d+)\\s*(${UNIT_PATTERN})\\b`));
  if (delayMatch) {
    const amount = Number(delayMatch[1]);
    const minutes = amount * unitToMinutes(delayMatch[2]);
    const target = new Date(currentStart.getTime() + minutes * 60000);
    return {
      targetStart: target,
      reason: `Automatisch ${amount} ${delayMatch[2]} verzet (uit notitie)`,
      signature: `delay:${amount}:${delayMatch[2].toLowerCase()}`,
    };
  }

  // 3. Relatief t.o.v. nu: "over 2 uur", "over 3 dagen"
  const nowMatch = t.match(new RegExp(`\\bover\\s+(\\d+)\\s*(${UNIT_PATTERN})\\b`));
  if (nowMatch) {
    const amount = Number(nowMatch[1]);
    const minutes = amount * unitToMinutes(nowMatch[2]);
    const target = new Date(now.getTime() + minutes * 60000);
    return {
      targetStart: target,
      reason: `Automatisch verzet: over ${amount} ${nowMatch[2]} (uit notitie)`,
      signature: `now:${amount}:${nowMatch[2].toLowerCase()}`,
    };
  }

  // 4. Losse "morgen" (zonder al herkend getal) — zelfde tijdstip, één dag later
  //    t.o.v. de huidige geplande tijd.
  if (/\bmorgen\b/.test(t)) {
    const target = new Date(currentStart.getTime() + 24 * 60 * 60000);
    return {
      targetStart: target,
      reason: 'Automatisch verzet naar morgen (uit notitie)',
      signature: 'tomorrow',
    };
  }

  return null;
}
