/**
 * Classificeert een agenda-item in 'call' (telefonisch), 'external' (fysiek/extern)
 * of 'internal' (overig/intern), puur op basis van titel + locatie-tekst.
 * Volgorde is opzettelijk: een expliciet bel-signaal wint van een locatie-signaal.
 */
export function classifyEvent(title, location, config) {
  const normalizedTitle = (title || '').toLowerCase();
  const normalizedLocation = (location || '').toLowerCase();

  const hasCallKeyword = config.callKeywords.some((keyword) =>
    normalizedTitle.includes(keyword.toLowerCase())
  );
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
 * titel, zoals Rosalinde die zelf hanteert: korte belletjes (call,
 * belafspraak, tb) duren 15 minuten, langere gesprekken (teams gesprek,
 * interview, acq) duren 1,5 uur. Geeft `null` als geen van beide
 * trefwoordenlijsten matcht, zodat de aanroeper dan op de bestaande
 * standaardduur (defaultCallDurationMinutes/defaultEventDurationMinutes)
 * terugvalt. Lange-gesprek-trefwoorden winnen bij een eventuele overlap.
 */
export function classifyDurationMinutes(title, config) {
  const normalizedTitle = (title || '').toLowerCase();
  const hasLongKeyword = config.longCallKeywords.some((keyword) =>
    normalizedTitle.includes(keyword.toLowerCase())
  );
  if (hasLongKeyword) return config.longCallDurationMinutes;

  const hasShortKeyword = config.shortCallKeywords.some((keyword) =>
    normalizedTitle.includes(keyword.toLowerCase())
  );
  if (hasShortKeyword) return config.shortCallDurationMinutes;

  return null;
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
  return config.longCallKeywords.some((keyword) => normalizedTitle.includes(keyword.toLowerCase()));
}
