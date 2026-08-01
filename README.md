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

Den viste pris beregnes og afrundes pr. plade efter basisrabatten på 15 %. Kurvens subtotal er summen af de samme viste priser. Mængderabatten beregnes derefter på subtotalen:

- 5–9 plader: 10 %
- 10–19 plader: 15 %
- 20+ plader: 22,5 %

## Bestillinger

Køberen udfylder kontaktoplysninger og får genereret en bestillingstekst til email. Teksten indeholder pladens ID, katalognummer, land, år og hylde, så dubletter kan skelnes. Kurven ryddes først, når køberen vælger **Jeg har sendt – ryd kurven**.

## Test

Kræver Node.js og Playwrights Chromium-browser:

```sh
npm install
npx playwright install chromium
npm test
```

Testene kontrollerer indlæsning uden browserfejl, desktop- og mobillayout, søgning, sortering, pagination, kurv, checkout, validering og oprydning af utilgængelige plader. Kør dem lokalt med `npm test`.
