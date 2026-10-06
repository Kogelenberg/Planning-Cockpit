# Planning cockpit

Een lokaal draaiend live planningsdashboard op basis van je Fantastical-agenda's.
Bedoeld om de hele dag op een scherm open te staan; ververst zichzelf zelfstandig,
zonder dat daar een Claude-gesprek voor open hoeft te staan.

## Hoe het werkt

```
Node.js achtergrondproces (server/)
  → verbindt elke 30 seconden als MCP-client met de lokale Fantastical MCP-server
  → normaliseert en classificeert de agenda-items (bellen/extern/overig)
  → bewaart de laatste stand in data/cache.json
  → serveert de webpagina + een SSE-stream (server-sent events)
        ↓
Browser (web/, gebouwd met React + Vite)
  → toont het dashboard, ontvangt live updates via SSE
  → weet zelf niets van MCP of Fantastical
```

### Route-onderzoek: MCP vs. ICS

Op dit systeem is de Fantastical MCP-server een lokale macOS-binary
(`.../Claude Extensions/ant.dir.gh.flexibits.fantastical-mcp/server/FantasticalMCP.app`).
Die kan door elk MCP-client-proces worden aangeroepen, niet alleen door Claude —
`server/src/mcpClient.js` spawnt deze binary zelf via stdio met de
`@modelcontextprotocol/sdk`, volledig los van een Claude-sessie. Dat bleek
haalbaar en is getest met echte agenda-data, dus dat is de primaire route.

Een ICS/webcal-fallback (`server/src/icsFallback.js`, via `node-ical`) is ook
gebouwd voor het geval de MCP-route ooit niet meer beschikbaar is. Zet
`ICS_FEED_URL` (zie hieronder) om hem te activeren; zonder die variabele wordt
hij nooit aangeroepen.

### Wat Fantastical wel en niet teruggeeft

De MCP-tools leveren alleen: titel, start/eindtijd, agenda-id (+ naam via een
aparte opvraag) en soms een locatietekst. Geen telefoonnummer, notities,
deelnemers of URL-veld. Ontbrekende velden worden gewoon weggelaten in de UI —
er wordt nooit "undefined", "null" of een technische foutmelding getoond.

## Classificatie: bellen / extern / overig

Trefwoorden staan in `server/src/config.js` (`callKeywords`, `externalKeywords`,
`videoLinkPatterns`, `postalCodePattern`) en zijn vrij aan te passen. Logica in
`server/src/classify.js`:

1. **Bellen** — titel bevat een beltrefwoord, of de locatie is een
   videobel-link (Meet/Zoom/Teams/Webex/Whereby). Fantastical levert geen
   telefoonnummerveld; een videolink is de dichtstbijzijnde vervangende
   indicator voor "op afstand, niet fysiek".
2. **Extern** — er is een (niet-video) locatie beschikbaar, de titel bevat een
   extern-trefwoord, of de titel bevat een Nederlandse postcode (sommige
   afspraken plakken het adres in de titel in plaats van het locatieveld).
3. **Overig/intern** — geen van bovenstaande signalen.

## Welke agenda's zijn zichtbaar

`config.allowedCalendarNames` in `server/src/config.js` is een **allowlist**:
alleen agenda's die hier exact (hoofdletterongevoelig) in staan worden
opgehaald, getoond of gewijzigd. Alles daarbuiten — bijvoorbeeld een
gedeelde/familie-agenda — komt nooit in de events of de agendalijst van de
app terecht, en kan dus ook nooit via de verzet-knoppen gewijzigd worden: een
schrijfpoging op een niet-toegestane agenda faalt met "Afspraak niet
gevonden", want de app kent die afspraak simpelweg niet. Dit is bewust op
twee plekken afgedwongen (het ophalen zelf, én nog eens vlak vóór elke
schrijfactie in `server.js`) — twee onafhankelijke sloten op dezelfde deur.

Voeg je een agenda toe aan Fantastical, dan verschijnt die hier dus **niet**
automatisch — je moet 'm zelf aan de lijst toevoegen.

## Eén agenda per installatie

Er is geen filterknop (Alles / Werk / Privé / Alleen belafspraken) meer: het
dashboard toont gewoon alle agenda's op de allowlist, en bij een installatie
met één agenda (bv. "Werk Brecs") is er dus ook niets te kiezen. Welke agenda
nieuwe afspraken krijgt, stel je per Mac in via `.env.local`:
`DEFAULT_NEW_EVENT_CALENDAR_NAME` (zie `.env.local.example`). Is die naam niet
te vinden maar is er precies één schrijfbare agenda, dan gebruikt de server
gewoon die ene.

## Nu / Volgende / Daarna

Bovenaan staan drie kaarten: de afspraak die nu loopt, de eerstvolgende, en
de afspraak daarna — zodat je in één oogopslag ziet wat je nu hebt én waar je
je op voor moet bereiden. Daaronder staat de Tijdlijn (een rollend venster van
±1 tot 2 uur rond nu) en daaronder het Dagoverzicht (de hele dag).

## Afspraak toevoegen

De "+"-knop rechtsboven opent een scherm met:

- een tekstveld voor de titel. Typ je er een tijd bij ("call met Lars om
  17:00", "koffie morgen om 10 uur"), dan wordt de dag en tijd hieronder
  vanzelf ingevuld;
- een **kalender** waar je op de dag klikt (geen datum typen), met
  Vandaag/Morgen-knoppen;
- een **tijdbalk "van – tot"** in stappen van 5 minuten: klik ergens op de balk
  om het blok daar neer te zetten, sleep de balk om te verschuiven, of sleep een
  uiteinde om begin of eind aan te passen (pijltjestoetsen werken ook; Shift =
  30 min). De standaardduur komt van de server op basis van de titel (bellen,
  peptalk: `config.defaultCallDurationMinutes` = 15 min; interview/acq/teams-
  gesprek: 90 min; anders 1 uur) en past zich aan zolang je de duur niet zelf
  op de balk hebt verzet.

"Toevoegen" maakt de afspraak écht aan in Fantastical, in de standaardagenda
van deze installatie. Een tijd in het verleden wordt niet geaccepteerd.

De server controleert bij het aanmaken zelf nogmaals dat de agenda op de
allowlist staat én schrijfbaar is (`isCalendarAllowed` + `writable`-check in
`server.js`) — "Hogeschool Utrecht" is bijvoorbeeld een gedeelde, alleen-lezen
agenda en kan nooit een doel zijn.

Net als bij verzetten (zie "Schrijftoegang" hieronder) wordt titel en duur niet
aan Fantastical's eigen gok overgelaten: na het aanmaken wordt meteen een
tweede `modifyCalendarItem`-aanroep gedaan die de exacte titel en tijd vastzet.

**Belangrijke uitzoekbevinding over tijdsherkenning**: getest met Fantastical
zelf (zie `web/src/createEventParser.ts`) — een kale klokttijd als "om 5:00"
wordt door Fantastical altijd letterlijk als 05:00 gelezen, en schuift
stilzwijgend door naar de volgende dag als dat moment al voorbij is. Voor een
planningsapp overdag is dat vrijwel nooit de bedoeling ("call om 5:00" om
14:00 getypt betekent vrijwel altijd 17:00 vanmiddag, niet 05:00 morgenvroeg).
Planning Cockpit lost dit daarom zelf op vóórdat het naar Fantastical gaat:
zonder expliciete "'s ochtends"/"'s middags"/"'s avonds"-aanduiding kiest de
parser de eerstvolgende van {H:00, H+12:00} die nog in de toekomst ligt.
Typ je zelf een ondubbelzinnige 24-uurs tijd (bv. "17:00") of "morgen", dan
wordt die altijd letterlijk gebruikt.

## Afvinken en automatisch verplaatsen

Bij **Nu / Volgende / Daarna**, in het **Dagoverzicht** en in het detailpaneel
staat bij elke afspraak een rondje om af te vinken. Een klik zet een **✓ voor
de titel in Fantastical zelf** (zo zie je het overal waar die agenda staat) en
laat de afspraak doorgestreept zien; nog een klik maakt het ongedaan. Het
vinkje geldt meteen op het scherm; mislukt het schrijven in Fantastical, dan
gaat het terug met een melding. Alleen afspraken in een schrijfbare agenda
hebben een rondje. Afgelopen afspraken kun je in het Dagoverzicht nog afvinken.

**Niet afgevinkt = niet doorgegaan.** Vanaf `config.autoMoveHour` (standaard
18:00, instelbaar met `AUTO_MOVE_HOUR`) verplaatst `server/src/autoMoveScheduler.js`
elke niet-afgevinkte afspraak van vandaag naar de eerste vrije plek van de
eerstvolgende **werkdag** (weekend wordt overgeslagen). Eindigt een afspraak pas
na 18:00, dan wordt hij `config.autoMoveGraceMinutes` (30 min) na zijn einde
verplaatst, zodat je hem nog kunt afvinken. Alleen losse, flexibele dingen
worden verplaatst (`isAutoMovableEvent` in `classify.js`):

- belafspraken, peptalks (15 min, net als calls) en "Terugbellen ..."
  (herkend aan de titel — een gewone vergadering met een videolink telt niet mee);
- "Uitwerken ..."-blokken.

Vaste afspraken met iemand anders blijven altijd staan: interview, acq, bezoek,
eerste gesprek en teams-gesprek, en het "Voorbereiden"-blok dat aan zo'n
afspraak vastzit. Hele-dag-items verplaatsen nooit. Verplaatste afspraken staan
in "Nog te bellen" met de reden "Niet afgevinkt — automatisch verplaatst", en
blijven elke dag opnieuw verplaatsen zolang ze niet zijn afgevinkt. Met
`AUTO_MOVE_ENABLED=false` zet je het helemaal uit.

De verplaatsing gebruikt de 15s-hartslag (zie "Als de agenda een tijd lang niet
ververste"): sliep de Mac om 18:00, dan gebeurt het alsnog zodra hij wakker
wordt. Lukt het niet (geen vrije plek binnen `freeSlotMaxDaysAhead` werkdagen,
of Fantastical geeft een fout), dan wordt het na 30 minuten opnieuw geprobeerd
in plaats van elke paar seconden.

**Belangrijke uitzoekbevinding — de afspraak "verplaatst" niet echt van
agenda**: getest met een wegwerp-testafspraak. Fantastical's `modifyCalendarItem`
heeft geen `calendarId`-veld — een item kan dus nooit naar een andere agenda
verhuizen, alleen van tijd/titel/locatie veranderen. De vrije plek wordt
daarom gezocht in en blijft in de agenda van de afspraak zelf. Om een afspraak
wél echt naar een andere agenda te verhuizen zou Fantastical's MCP eerst een
nieuw item moeten aanmaken en dan het oude verwijderen (`deleteCalendarItem`) —
bewust niet geïmplementeerd, want dat zou de eerste plek in de app zijn die
iets echt verwijdert uit Fantastical.

De vrije-plek-zoeker (`server/src/freeSlotFinder.js`) kijkt alleen binnen
`freeSlotWindowStartHour`–`freeSlotWindowEndHour` (standaard 8–18 uur). Hele-dag-
items (bv. een verjaardag) tellen niet als bezet. Er wordt nooit een afspraak
"ergens maar" neergezet buiten dat venster.

## Automatische hulp-afspraken bij interview/acq/bezoek/eerste gesprek

`server/src/companionScheduler.js` draait na elke ophaal en maakt drie soorten
hulp-afspraken vanzelf aan — niet via een knop, puur op trefwoorden in de
titel (`config.autoCompanionKeywords`: interview/acq/bezoek). Altijd in
dezelfde agenda als de afspraak die de trigger was, en alleen als die agenda
schrijfbaar is:

1. **"Voorbereiden en link Teams sturen"** — plakt direct vóór elke
   interview/acq/bezoek-afspraak (`config.prepReminderMinutes`, standaard 30 min).
2. **"Uitwerken ..."** — één blok per dag+agenda om `config.followUpHour`
   (standaard 17:00). De duur groeit mee met het aantal interview/acq/bezoek-
   afspraken die dag: 1 = `followUpBaseDurationMinutes` (60 min), elke extra
   +`followUpExtraDurationMinutes` (30 min) — dus 2 = 1,5 uur, 3 = 2 uur. De
   titel groeit mee (bv. "Uitwerken interview, acq"). Krimpt nooit terug als
   een afspraak later wegvalt — alleen groeien, nooit verwijderen (zie
   "Schrijftoegang": deze app gebruikt bewust nergens `deleteCalendarItem`).
3. **"Terugbellen [naam]"** — direct ná een "eerste gesprek [naam]"-afspraak
   (`config.firstConversationKeyword`). Zo'n afspraak is bewust NIET blokkerend
   (degene die de agenda beheert is er zelf niet bij, het is tussen kandidaat
   en klant) en telt dus niet mee in stap 1/2 hierboven — wel komt er een korte
   reminder (`config.followUpCallDurationMinutes`, 15 min) achteraan, zodat het
   terugbellen zelf niet vergeten wordt.

Alles is idempotent (bijgehouden in `data/companions.json`, nooit in git): een
afspraak die al een blok opgeleverd heeft, krijgt er nooit een tweede bij, ook
niet over herstarts heen. Zelf aangemaakte blokken worden ook nooit per
ongeluk als nieuwe trigger gezien (anders zou bv. "Uitwerken interview" zichzelf
elke ronde als extra interview meetellen, want de titel bevat het woord
"interview").

**Belangrijke uitzoekbevinding**: Fantastical's eigen datumherkenning leest een
gewone naam als "Jan" soms als de maand januari, en verknoeit dan niet alleen
de datum maar ook de titel (bv. "interview met Jan" wordt "interview met" —
"Jan" verdwijnt stilzwijgend). Zowel hier als bij de "+"-knop wordt daarom na
het aanmaken altijd expliciet de titel opnieuw meegegeven aan
`modifyCalendarItem`, niet alleen de tijd — anders kan een kandidaatnaam die
toevallig op een maand lijkt (Jan, Mei, Juni, Aug, ...) verloren gaan.

**Conflictcheck aangepast**: gewone belletjes (15 min, `config.callKeywords`)
blokkeren elkaar niet meer — die mogen overlappen. Alleen interview/acq/bezoek/
teams-gesprek blijven "bezet": een nieuwe afspraak (ook een call) die daar
overheen gepland zou worden, wordt geweigerd (409, zie `isBusyBlockingEvent`
in `classify.js`).

## Notities en "verzet deze afspraak"

Klik een afspraak aan voor een notitieveld en verzet-knoppen (+30 min, +1 t/m
+5 uur, of een andere dag en tijd via dezelfde kalender en "van – tot"-tijdbalk
als bij toevoegen; daar kun je ook de duur aanpassen). De knoppen verzetten altijd t.o.v. de
**huidige geplande tijd van de afspraak zelf** — "+2 uur" betekent dus altijd
"2 uur later dan nu gepland staat", ongeacht op welk moment je op de knop
drukt.

**Verzetten wijzigt de afspraak écht in Fantastical** (zie "Schrijftoegang"
hieronder) — dit is dus geen lokale weergave-truc meer. Het detailpaneel
toont wel altijd "oorspronkelijk gepland op ..." zodra iets verzet is, met een
knop om het ongedaan te maken (die ook weer een echte wijziging in Fantastical
doet). Een afspraak die naar een andere dag is verzet, verdwijnt uit de
tijdlijn van vandaag en verschijnt in plaats daarvan onderaan in "Nog te
bellen" totdat die dag aanbreekt. Notities en verzette tijden zijn ook direct
zichtbaar in de tijdlijn en het dagoverzicht zelf, niet pas na een klik.

Notities zelf blijven wél puur lokaal (`data/annotations.json`) — Fantastical
heeft geen schrijfbaar notitieveld (`modifyCalendarItem` accepteert alleen
title/location/when), dus die kunnen niet meegestuurd worden.

### Verzetten via de notitie zelf

Typ je in de notitie iets als "30 minuten vertraagd", "over 2 uur" of "naar
15:00" en druk op **Enter** (of klik "Pas verzet toe uit notitie"), dan
herkent `web/src/rescheduleParser.ts` dat en verzet de afspraak — écht, in
Fantastical. Dit gebeurt bewust **niet** meer automatisch terwijl je typt
(zoals in een eerdere versie): omdat een herkende zin nu een echte
agendawijziging veroorzaakt, is een expliciete actie (Enter of de knop)
vereist. Dit is een kleine, voorspelbare patroonherkenning, geen echte
taalherkenning — een ongebruikelijke formulering wordt gewoon niet herkend en
je krijgt een duidelijke melding; gebruik dan de knoppen.

### Hoe betrouwbaar is dit?

Elke verzet-actie is een echte, synchrone `modifyCalendarItem`-aanroep: lukt
die niet (Fantastical niet bereikbaar, item niet gevonden, etc.), dan blijft
het paneel open met de foutmelding en verandert er niets — er wordt nooit
stilzwijgend gedaan alsof het gelukt is. Na een geslaagde wijziging wordt de
agenda meteen vers opgehaald (niet pas bij de volgende cyclus), zodat je
altijd de bevestigde, echte tijd ziet. De lokale `originalStart`/reden-
geschiedenis (voor de "ongedaan maken"-knop) staat in `data/annotations.json`,
**synchroon en atomisch** weggeschreven (eerst naar een tijdelijk bestand, dan
pas hernoemd) — een crash midden in het schrijven kan dat bestand dus nooit
half-geschreven achterlaten. Die geschiedenis wordt ~30 dagen na de
oorspronkelijke tijd automatisch opgeruimd.

## Starten

Eenmalig, of na wijzigingen aan de frontend:

```bash
./start.sh
```

Dit bouwt (indien nodig) de frontend en start de dienst op
<http://localhost:4173>. Laat het terminalvenster open, of zet de dienst op
autostart (zie hieronder) — de webpagina zelf kan de hele dag open blijven
staan en ververst zichzelf.

De dienst weigert bewust een tweede keer te starten zolang er al een actief
proces is (`data/server.pid`) — met een duidelijke melding erbij. Dat is geen
storing: twee exemplaren tegelijk zouden allebei naar dezelfde
`data/*.json`-bestanden schrijven en elkaars wijzigingen willekeurig kunnen
overschrijven. Zie je die melding, sluit dan eerst het genoemde proces af
voordat je opnieuw start.

### Als de agenda een tijd lang niet ververste

Wanneer de Mac in slaapstand gaat (dichte deksel, schermslaap), lopen alle
timers in Node — ook de ververs-timer — gewoon stil totdat de Mac wakker
wordt. Zonder extra maatregel zou de eerstvolgende verversing dan pas bij het
toevallige volgende interval-tikje gebeuren, wat soms tientallen minuten kon
duren. `server/src/index.js` gebruikt daarom een korte "hartslag" (elke 15s)
die controleert of een verversing inmiddels nodig is, in plaats van blind op
een enkele `setInterval` te vertrouwen — na wakker worden ververst de agenda
zo binnen hooguit een paar tellen, niet pas na een willekeurige wachttijd.
Dit lost geen structureel probleem op, alleen de vertraging door slaapstand;
als de agenda ooit wél structureel niet ververst, check dan `logs/`
(`lastError` in `/api/state` toont de laatste fout) of herstart de dienst.

### Altijd actief houden (ook na herstart / uitloggen)

Er staat een kant-en-klaar LaunchAgent-bestand klaar:
`com.vankogelenberg.planningcockpit.plist`. Dit is *niet* automatisch
geïnstalleerd. Om de dienst bij inloggen automatisch te laten starten:

```bash
cp com.vankogelenberg.planningcockpit.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.vankogelenberg.planningcockpit.plist
```

Uitzetten:

```bash
launchctl unload ~/Library/LaunchAgents/com.vankogelenberg.planningcockpit.plist
rm ~/Library/LaunchAgents/com.vankogelenberg.planningcockpit.plist
```

Logs komen dan in `logs/out.log` en `logs/err.log` terecht.

## Configuratie (omgevingsvariabelen, optioneel)

Zet deze in `.env.local` in de projectroot (nooit in git, zie `.env.local.example`
voor een kant-en-klaar sjabloon) — `start.sh` leest dat bestand automatisch in.

| Variabele | Standaard | Betekenis |
|---|---|---|
| `PORT` | `4173` | Poort van de webserver |
| `POLL_INTERVAL_MS` | `180000` (3 min) | Ververssnelheid |
| `FANTASTICAL_MCP_PATH` | pad naar de geïnstalleerde extensie | Alleen nodig als die ergens anders staat |
| `ICS_FEED_URL` | (leeg) | Activeert de ICS-fallback met deze feed-URL |
| `ALLOWED_CALENDAR_NAMES` | `Privé,School,Hogeschool Utrecht` | De allowlist (komma-gescheiden) — zie hieronder |
| `WORK_CALENDAR_NAMES` / `PERSONAL_CALENDAR_NAMES` | `School,Hogeschool Utrecht` / `Privé` | Niet meer gebruikt door het scherm (de filterknop is weg) |
| `DEFAULT_NEW_EVENT_CALENDAR_NAME` | `Privé` | Agenda waarin de "+"-knop nieuwe afspraken maakt |
| `AUTO_MOVE_HOUR` | `18` | Uur (24-uurs) vanaf wanneer niet-afgevinkte afspraken naar de volgende werkdag gaan |
| `AUTO_MOVE_ENABLED` | `true` | Zet op `false` om automatisch verplaatsen uit te zetten |
| `FREE_SLOT_WINDOW_START_HOUR` / `_END_HOUR` | `8` / `18` | Venster waarbinnen een vrije plek gezocht wordt |

## Op een andere Mac zetten (eigen Fantastical-koppeling)

Dit is één codebase die op meerdere Macs kan draaien, elk met hun eigen
Fantastical-account en eigen agenda-namen — via `.env.local` hoeft daarvoor
niets in de code aangepast te worden.

1. **Fantastical MCP-extensie op die Mac**: Fantastical moet daar al
   geïnstalleerd en ingelogd zijn. Installeer daarnaast Claude Desktop en zet
   via Instellingen → Extensions de "Fantastical"-extensie aan. Dat zet de
   MCP-server-binary neer op het pad dat `config.js` standaard verwacht
   (`~/Library/Application Support/Claude/Claude Extensions/...`) — Claude
   hoeft daarna niet open te staan, Planning Cockpit spawnt die binary zelf.
2. **Code overzetten**: kloon de (private) GitHub-repo op die Mac — daarvoor
   moet dat account óf inloggen met jouw GitHub-account, óf als
   "Collaborator" toegevoegd worden via GitHub.com → repo → Settings →
   Collaborators. Zonder GitHub kan de map ook gewoon gekopieerd worden
   (AirDrop/USB), dan mis je alleen versiebeheer.
3. **Dependencies**: `.runtime/`, `node_modules/`, `web/dist/` en `data/*.json`
   staan bewust niet in git. Heeft die Mac al Node.js (v20+)? Dan volstaat
   `npm install && npm run build && npm run start` in de projectroot. Anders
   kan `.runtime/node` net zo gevuld worden als hier: een portable
   Node.js-build (van nodejs.org, tar.gz voor macOS arm64/x64) uitpakken naar
   `.runtime/node` — of gewoon Node.js normaal installeren, dat werkt net zo
   goed, `start.sh` gebruikt de portable versie alleen om een
   systeeminstallatie op dít toestel te vermijden.
4. **Agenda-namen instellen — dé belangrijke stap**: kopieer
   `.env.local.example` naar `.env.local` en vul de exacte agendanamen van
   *haar* Fantastical in (zichtbaar in Fantastical's zijbalk zelf, of via één
   `queryCalendars`-aanroep in Claude). Zonder deze stap toont de app niets:
   agenda's die niet exact matchen worden bewust hard geweerd (fail-closed,
   zie "Welke agenda's zijn zichtbaar" hieronder) — geen bug, maar de bedoelde
   veilige default.
5. **Starten**: `./start.sh`, en optioneel de LaunchAgent installeren (zie
   "Altijd actief houden" hierboven — hernoem het `.plist`-bestand en het
   label erin naar iets unieks voor dat toestel).

## Schrijftoegang

Oorspronkelijk was deze app strikt read-only. Op expliciet verzoek roept ze nu
ook `modifyCalendarItem` aan — om een afspraak te verzetten (tijdstip) via de
knoppen/notitie/kalender in het detailpaneel, om de ✓ voor de titel te zetten
bij afvinken, en bij het automatisch verplaatsen — en `createCalendarItem` — om
via de "+"-knop (en de automatische hulp-afspraken) een nieuwe afspraak aan te
maken (zie "Afspraak toevoegen" hierboven). Alle Fantastical-aanroepen lopen
door één wachtrij (`server/src/mcpClient.js`), want Fantastical's MCP-server
verdraagt geen gelijktijdige aanvragen over één verbinding. `deleteCalendarItem` wordt nergens gebruikt: de app kan dus geen
items verwijderen, alleen aanmaken en bestaande items verzetten in de tijd.
`queryCalendars`/`queryCalendarItems` blijven het hoofdpad voor het inlezen
van de agenda.

**Belangrijke beperking van `modifyCalendarItem`**: Fantastical accepteert
geen exacte start/eind-tijd, maar een vrije-tekst `when`-veld dat het zelf
interpreteert. Getest (zie `server/src/whenFormat.js`): het Nederlandse "tot"
wordt niet als bereik herkend en valt stilzwijgend terug op 1 uur duur; het
Engelse "to" met volledige datum aan beide kanten (`"2026-09-15 14:00 to
2026-09-15 15:30"`) werkt wel betrouwbaar en is wat deze app gebruikt.
Onbekend/ongetest: het gedrag bij het verzetten van één losse instantie van
een terugkerende afspraak — behandel dat met extra voorzichtigheid.

## Projectstructuur

```
server/                 Node.js-dienst (MCP-client, classificatie, HTTP + SSE)
web/                    React/TypeScript-frontend (Vite), gebouwd naar web/dist
data/cache.json         Laatst bekende agenda-stand (overleeft een herstart)
data/annotations.json   Lokale notities/verzet-acties — nooit in Fantastical zelf
.runtime/node/          Portable Node.js-runtime (niet systeemgebreed geïnstalleerd)
```
