# Pladesamling

En enkel, statisk GitHub Pages-side til at gennemse og bestille LP'er fra en privat samling. Siden bruger almindelig HTML, CSS og JavaScript; der er ingen backend, brugerprofiler eller onlinebetaling.

## Reservér eller sælg en plade

Den eneste fil sælgeren skal redigere er `data/vinyls.json`. Bestillinger indeholder pladens unikke nummer som fx `#1581`.

1. Åbn `data/vinyls.json` på GitHub, og klik på blyanten for at redigere.
2. Søg med Ctrl+F efter den præcise linje `"id": 1581,`.
3. Find `status` i den samme pladepost, og skift værdien.
4. Gem ændringen med **Commit changes**.

```json
{
  "id": 1581,
  "artist": "Eksempel",
  "albumTitle": "Eksempelalbum",
  "status": "reserved"
}
```

- Brug `"available"`, når pladen kan bestilles.
- Brug `"reserved"`, når en bestilling afventer betaling eller afhentning.
- Brug `"sold"`, når salget er afsluttet.

Både reserverede og solgte plader skjules fra kataloget og fjernes automatisk fra gemte kurve. Antal plader, kunstnere, genrer og årsspænd beregnes automatisk ud fra de tilgængelige plader.

Kurve gemmes lokalt i køberens browser. Hvis en gemt plade senere markeres som solgt, fjernes den automatisk fra kurven næste gang siden åbnes.

GitHub Pages henter altid `vinyls.json`, så ændringer foretaget direkte på GitHub slår igennem uden andre trin.

På grund af browsernes sikkerhedsregler kan `index.html` ikke åbnes direkte fra disken. Lokal forhåndsvisning kræver en lille lokal webserver, fx `python -m http.server 8000`, hvorefter siden åbnes på `http://localhost:8000`.

## Priser

Den faste pris i `priceNow` kommer fra Excel-kolonnen **Pris nu**. Discogs-prisen vises overstreget og indgår ikke i beregningen. Mængderabatten trækkes fra summen af de faste priser, og resultatet afrundes til nærmeste hele krone:

- 10–24 plader: 10 %
- 25–49 plader: 15 %
- 50–99 plader: 20 %
- 100+ plader: 25 %

Afhentning er gratis. Forsendelse lægger 65 kr. til efter mængderabatten; levering vælges ved bestilling.

Kurven foreslår op til tre tilgængelige plader af samme kunstner eller med tæt matchende genrer. Udgivelsesår hjælper med rangeringen. Ved ét manglende eksemplar til næste rabattrin prioriteres billige plader inden for samme relevansgruppe. En besked om samme eller lavere pris beregnes altid med den konkrete foreslåede plade og gælder pladernes total før fragt.

Katalogopdateringen bevarer eksisterende plade-ID'er. `previousIds` bruges kun til at flytte gemte kurve fra to identiske dubletter til den tilbageværende kopi. Nye plader skal have ID'er over det hidtidige maksimum; Excel-kolonnen **No** er ikke et website-ID.

## Bestillinger

Køberen udfylder kontaktoplysninger og får genereret en bestillingstekst til email. Teksten indeholder pladens ID, katalognummer, land, år og hylde, så dubletter kan skelnes. Kurven ryddes først, når køberen vælger **Jeg har sendt – ryd kurven**. På mobil er knappen til en forudfyldt email tilgængelig uanset bestillingens længde. Kopiér-knappen er altid tilgængelig som alternativ. Computer bruger fortsat kopiér-knappen.

## Test

Kræver Node.js og Playwrights Chromium-browser:

```sh
npm install
npx playwright install chromium
npm test
```

Testene kontrollerer indlæsning uden browserfejl, desktop- og mobillayout, søgning, sortering, pagination, kurv, checkout, validering og oprydning af utilgængelige plader. Kør dem lokalt med `npm test`.
