/**
 * Bouwt een ondubbelzinnige "when"-tekst voor Fantastical's modifyCalendarItem.
 *
 * Empirisch getest (zie server/README): Fantastical's "when" is vrije-tekst-
 * interpretatie, geen exact start/eind-veld. Het Nederlandse "tot" wordt NIET
 * als bereik-scheiding herkend (negeert het einde stilzwijgend en valt terug
 * op 1 uur duur!) — Engels "to" met volledige datum aan beide kanten werkt wel
 * betrouwbaar, ook als de nieuwe tijd op een andere dag valt.
 */
function pad(n) {
  return String(n).padStart(2, '0');
}

export function isoDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatWhenRange(start, end) {
  return `${isoDateTime(start)} to ${isoDateTime(end)}`;
}
