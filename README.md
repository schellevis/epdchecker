# EPD Status Monitor

Een automatische beschikbaarheidsmonitor voor patiëntenportalen van Nederlandse ziekenhuizen.

🔗 **Live dashboard: https://schellevis.github.io/epdchecker**

---

## Wat doet het?

De tool controleert regelmatig of de EPD-portalen (Elektronisch Patiënten Dossier) van Nederlandse ziekenhuizen bereikbaar zijn. Per ziekenhuis wordt het volgende gecontroleerd:

- **HTTP-status** – is het portaal bereikbaar en geeft het een 200 OK terug?
- **DNS-lookup** – naar welke IP-adressen wijst het domein?
- **HIX365-detectie** – portalen gehost op het HIX365-platform worden apart gemarkeerd.
- **Screenshot** – er wordt een schermafbeelding gemaakt van de startpagina.

De resultaten worden gepubliceerd als een statische HTML-pagina op GitHub Pages. Offline portalen verschijnen bovenaan; de pagina ververst automatisch elke 10 minuten.

---

## Ziekenhuizen

Het bestand [`hospitals.json`](hospitals.json) bevat de lijst met gecontroleerde ziekenhuizen. Momenteel staan er ~65 portalen in. Wil je een ziekenhuis toevoegen of verwijderen, pas dan dit bestand aan:

```json
{ "domain": "mijn.voorbeeldziekenhuis.nl", "name": "Voorbeeldziekenhuis" }
```

---

## Installatie

Node.js 18 of hoger is vereist.

```bash
npm install
```

Playwright (voor screenshots) wordt meegeïnstalleerd. Installeer daarna de Chromium-browser:

```bash
npx playwright install chromium
```

> Zonder Playwright werkt de tool ook – screenshots worden dan overgeslagen.

---

## Gebruik

### Alleen controleren (geen publiceren)

```bash
npm run check
# of
node check.js
```

De output wordt weggeschreven naar de map `dist/`:

| Bestand | Inhoud |
|---|---|
| `dist/index.html` | Dashboard-pagina |
| `dist/status.json` | Machine-leesbaar JSON-overzicht |
| `dist/screenshots/` | JPEG-schermafbeeldingen per ziekenhuis |

### Controleren én publiceren naar GitHub Pages

```bash
./deploy.sh
```

Het script draait `check.js` en pusht de `dist/`-map vervolgens als de `gh-pages`-branch naar GitHub, waarna de live pagina op https://schellevis.github.io/epdchecker bijgewerkt is.

### Dry-run (controleren zonder publiceren)

```bash
./deploy.sh --dry-run
```

---

## Technische details

- **Runtime**: Node.js, geen externe webserver nodig.
- **Gelijktijdigheid**: 5 ziekenhuizen worden parallel gecontroleerd.
- **Timeouts**: HTTP-fetch 12 s, Playwright-navigatie 20 s.
- **Weergave**: dark mode standaard, light mode via `prefers-color-scheme`.
- **Afhankelijkheid**: alleen [`playwright`](https://playwright.dev/) (optioneel voor screenshots).

---

## Licentie

MIT
