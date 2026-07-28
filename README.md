# Kasboek Willemsen

Een persoonlijk kasboek voor twee — gebouwd op Google Sheets als database, Google Apps Script als API en GitHub Pages als hosting.

---

## Wat doet de app?

- Transacties bijhouden (uitgaven en ontvangsten) per categorie
- Budgetten per maand beheren, met maandelijkse overschrijvingen
- Dashboard met donut-grafiek, top-categorieën en recente transacties
- CSV-import vanuit Regiobank
- Volledig Nederlandstalig, mobiel-first ontwerp

---

## Installatie stap voor stap

### 1. Google Sheets aanmaken

Maak een nieuw Google Spreadsheet aan en voeg **vier werkbladen** toe met exact deze namen (hoofdlettergevoelig):

| Bladnaam | Kolommen (rij 1, exact deze namen) |
|---|---|
| `transactions` | `id` \| `date` \| `amount` \| `category_id` \| `description` \| `created_at` \| `updated_at` |
| `categories` | `id` \| `name` \| `color` \| `budget_id` \| `created_at` |
| `budgets` | `id` \| `name` \| `default_amount` \| `created_at` |
| `budget_overrides` | `id` \| `budget_id` \| `month` \| `amount` \| `created_at` |

Kopieer voor elk blad de kolomnamen precies zoals hierboven in rij 1.

---

### 2. Apps Script instellen

1. Open in je Google Spreadsheet: **Extensies → Apps Script**
2. Verwijder de bestaande code in `Code.gs`
3. Plak de volledige inhoud van `apps-script/Code.gs` uit deze repository
4. Sla op (Ctrl+S)

#### API-sleutel instellen

1. Ga in de Apps Script editor naar **Project-instellingen** (tandwiel-icoon links)
2. Scroll naar **Scripteigenschappen**
3. Klik **Eigenschap toevoegen**
4. Naam: `API_KEY`
5. Waarde: een zelfgekozen geheime sleutel (bijv. `MijnGeheimeSleutel123!`)
6. Klik **Opslaan**

#### Standaarddata invoegen (eenmalig)

1. Ga terug naar de editor
2. Selecteer bovenaan de functie `seedData` uit de dropdown
3. Klik **▶ Uitvoeren**
4. Geef toestemming als dat gevraagd wordt
5. Controleer het logboek: je ziet "✓ 13 budgets aangemaakt" en "✓ 26 categorieën aangemaakt"

#### Implementeren als web-app

1. Klik op **Implementeren → Nieuwe implementatie**
2. Kies als type: **Web-app**
3. Instellingen:
   - **Uitvoeren als**: Ik (jouw Google-account)
   - **Wie heeft toegang**: Iedereen
4. Klik **Implementeren**
5. **Kopieer de web-app URL** — je hebt deze straks nodig

> ⚠️ Als je de Apps Script code later aanpast, moet je opnieuw implementeren via **Implementeren → Implementaties beheren → Bewerken** en een nieuwe versie kiezen.

---

### 3. GitHub Pages instellen

1. Maak een nieuw repository aan op GitHub (of gebruik een bestaand)
2. Kopieer alle bestanden uit deze repository naar je GitHub repo
3. Ga naar **Settings → Pages**
4. Stel in:
   - **Source**: Deploy from a branch
   - **Branch**: `main` (of `master`), folder `/root`
5. Wacht 1-2 minuten; GitHub geeft je een URL zoals `https://jouwgebruikersnaam.github.io/jouw-repo/`

---

### 4. App eerste keer openen

1. Open de GitHub Pages URL in je browser (bij voorkeur op telefoon)
2. Je wordt automatisch doorgestuurd naar **Instellingen → App**
3. Vul in:
   - **Script URL**: de web-app URL uit stap 2
   - **API Sleutel**: de sleutel die je in Script Properties hebt ingesteld
4. Klik **Opslaan**
5. Klik **Test verbinding** — je ziet "✓ Verbinding gelukt!"
6. Ga naar het **Dashboard** — je bent klaar!

---

### 5. Regiobank CSV importeren

1. Log in op **Regiobank Online**
2. Ga naar **Betaalrekening → Transacties**
3. Klik op **Exporteren** of **Download**
4. Kies als formaat: **CSV**
5. Sla het bestand op
6. Open de app → **Import**
7. Sleep het CSV-bestand naar de dropzone of klik om te bladeren
8. Bekijk de voorbeeldtabel:
   - **Af** = uitgave (positief bedrag, rood)
   - **Bij** = ontvangst (negatief bedrag, groen)
   - Pas per rij de **categorie** aan
   - Zet vinkje weg voor rijen die je niet wilt importeren
9. Klik **Importeer X transacties**

> Het CSV-formaat van Regiobank heeft kolommen: `Datum; Naam; Rekeningnummer; Tegenrekening; Code; Af Bij; Bedrag; Mutatiesoort; Mededelingen`

---

## Bestandsstructuur

```
kasboek-willemsen/
├── index.html                  # Hoofdpagina (SPA shell)
├── css/
│   └── style.css               # Volledig stylesheet (CSS-variabelen, componenten)
├── js/
│   ├── config.js               # Configuratie + globale hulpfuncties
│   ├── api.js                  # API-wrapper voor alle Apps Script aanroepen
│   ├── router.js               # Hash-gebaseerde SPA-router
│   ├── app.js                  # Bootstrap: router init, FAB, toast
│   ├── dashboard.js            # Dashboard-weergave met Chart.js grafiek
│   ├── transactions.js         # Transactielijst met filters
│   ├── transaction-form.js     # Modal: transactie toevoegen/bewerken
│   ├── import.js               # CSV-import (Regiobank formaat)
│   ├── budgets.js              # Budgettenweergave met voortgangsbalk
│   ├── budget-override-form.js # Modal: maandelijks budget overschrijven
│   └── settings.js             # Instellingen (categorieën, budgetten, app)
├── apps-script/
│   └── Code.gs                 # Google Apps Script backend (volledig)
└── README.md                   # Deze handleiding
```

---

## Technische details

| Onderdeel | Technologie |
|---|---|
| Frontend | Vanilla HTML5, CSS3, JavaScript ES2020+ |
| Hosting | GitHub Pages (statisch, geen buildstap) |
| Backend/API | Google Apps Script Web App |
| Database | Google Sheets |
| Grafiek | Chart.js (CDN) |
| Fonts | Inter via Google Fonts |

### CORS-aanpak

Apps Script Web Apps sturen een 302-redirect. Om CORS-problemen te vermijden worden POST-verzoeken **zonder** `Content-Type`-header verstuurd (plain text body). Dit is een "simple CORS request" dat geen preflight vereist. Apps Script voegt automatisch `Access-Control-Allow-Origin: *` toe.

---

## Veelgestelde vragen

**Q: Moet ik de API-sleutel geheim houden?**  
A: Ja. Deel de script URL en API-sleutel niet publiek. Ze staan opgeslagen in `localStorage` van de browser en worden niet naar derden verstuurd.

**Q: Kan ik de app ook op desktop gebruiken?**  
A: Ja, de app werkt op zowel mobiel als desktop. De lay-out is geoptimaliseerd voor 480px breedte maar werkt prima op grotere schermen.

**Q: Hoe voeg ik een maandelijks budget toe voor een specifieke maand?**  
A: Ga naar **Budgetten**, navigeer naar de gewenste maand en klik op het potlood-icoon naast een budget. Vul het overschrijvingsbedrag in.

**Q: Kan ik meerdere mensen toegang geven?**  
A: Ja. Deel de GitHub Pages URL en de API-sleutel met je partner. Iedereen met de juiste instellingen kan de app gebruiken.

---

*Kasboek Willemsen — versie 1.0*
