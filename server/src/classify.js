/**
 * Test of `keyword` in `normalizedText` voorkomt. Korte, kale trefwoorden
 * (zoals "tb" of "acq", 3 letters of minder) worden op woordgrens gematcht
 * in plaats van als los substring, anders zou "tb" ook midden in een
 * onschuldig ander woord kunnen matchen. Langere trefwoorden (en trefwoorden
 * met eigen spaties/haakjes, zoals "bel " of "(bel)") blijven gewoon op
 * substring matchen, zoals altijd al het geval was.
 */
function matchesKeyword(normalizedText, keyword) {
  const normalizedKeyword = keyword.toLowerCase();
  if (normalizedKeyword.length <= 3 && /^[a-z]+$/.test(normalizedKeyword)) {
    return new RegExp(`\\b${normalizedKeyword}\\b`).test(normalizedText);
  }
  return normalizedText.includes(normalizedKeyword);
}

/**
 * Classificeert een agenda-item in 'call' (telefonisch), 'external' (fysiek/extern)
 * of 'internal' (overig/intern), puur op basis van titel + locatie-tekst.
 * Volgorde is opzettelijk: een expliciet bel-signaal wint van een locatie-signaal.
 */
export function classifyEvent(title, location, config) {
  const normalizedTitle = (title || '').toLowerCase();
  const normalizedLocation = (location || '').toLowerCase();

  const hasCallKeyword = config.callKeywords.some((keyword) => matchesKeyword(normalizedTitle, keyword));
  const isVideoLink = config.videoLinkPatterns.some((pattern) =>
    normalizedLocation.includes(pattern.toLowerCase())
  );
  const hasPhysicalLocation = Boolean(location) && !isVideoLink;
  const hasExternalKeyword = config.externalKeywords.some((keyword) =>
    normalizedTitle.includes(keyword.toLowerCase())
  );
  const hasPostalCodeInTitle = config.postalCodePattern?.test(title || '');

  if (hasCallKeyword || isVideoLink) {
    return 'call';
  }
  if (hasPhysicalLocation || hasExternalKeyword || hasPostalCodeInTitle) {
    return 'external';
  }
  return 'internal';
}

/**
 * Bepaalt de standaardduur (in minuten) op basis van trefwoorden in de
 * titel: een lang gesprek (teams gesprek, interview, acq) duurt 1,5 uur.
 * Geeft `null` als dat niet matcht, zodat de aanroeper dan terugvalt op de
 * gewone call/overig-standaard (defaultCallDurationMinutes — inmiddels ook
 * 15 minuten, zie config.js — of defaultEventDurationMinutes), gebaseerd op
 * classifyEvent's type. Zo is er nu precies één plek (callKeywords in
 * config.js) die bepaalt wat een "belletje" is, voor zowel de classificatie
 * als de duur.
 */
export function classifyDurationMinutes(title, config) {
  const normalizedTitle = (title || '').toLowerCase();
  const hasLongKeyword = config.longCallKeywords.some((keyword) => matchesKeyword(normalizedTitle, keyword));
  return hasLongKeyword ? config.longCallDurationMinutes : null;
}

/**
 * Of een afspraak meetelt als "bezet" bij het conflictcheck voor nieuwe
 * afspraken: een belletje/videogesprek (type 'call', al dan niet via een
 * videolink-locatie) of een gesprek dat aan de titel te herkennen is als
 * teams-gesprek/interview/acq, ook zonder videolink-locatie erbij. Een
 * hele dag durend item telt nooit als bezet in deze zin.
 */
export function isBusyBlockingEvent(event, config) {
  if (!event || event.isAllDay) return false;
  if (event.type === 'call') return true;
  const normalizedTitle = (event.title || '').toLowerCase();
  return config.longCallKeywords.some((keyword) => matchesKeyword(normalizedTitle, keyword));
}
