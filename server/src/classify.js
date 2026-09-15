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
