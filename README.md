# Kasboek Willemsen — Firebase-versie

Dezelfde kasboek-app als de Google Sheets-versie, maar gebouwd op Firebase (Firestore + Authentication) en gehost op GitHub Pages. Veel sneller, met inloggen en meerdere huishoudens.

Dit is de standaardversie van de app. De oude Google Sheets-versie staat als archief in de map [`google-sheet-app/`](google-sheet-app/) en blijft bereikbaar op `/google-sheet-app/`.

---

## Wat doet de app?

- Transacties bijhouden (uitgaven en ontvangsten) per categorie
- Budgetten per maand beheren, met maandelijkse overschrijvingen
- Dashboard met donut-grafiek, top-categorieën en recente transacties
- CSV-import vanuit Regiobank
- Spaardoelen met spaarafspraken en maandelijkse stortingen; een uitgevoerde storting komt als afschrijving bij de transacties
- Zonnescherm bedienen (alleen voor huishoudens waarvoor een admin dit aanzet)
- Meerdere huishoudens: elk huishouden ziet alleen zijn eigen gegevens
- Inloggen met Google of met e-mail en wachtwoord
- Gegevens staan direct klaar uit de cache en synchroniseren op de achtergrond; wijzigingen zijn meteen zichtbaar
- Volledig Nederlandstalig, mobiel-first ontwerp

---

## Hoe werkt het?

### Inloggen en huishoudens

1. Je logt in met Google of e-mail en wachtwoord (e-mailadres moet geverifieerd zijn).
2. Daarna maak je een huishouden aan, of je sluit aan bij een huishouden waarvoor je bent uitgenodigd.
3. Alle leden van een huishouden hebben dezelfde rechten.

**Eén huishouden per e-mailadres.** Een e-mailadres kan maar bij één huishouden horen. Wisselen tussen huishoudens kan niet; wie weg wil, verlaat het huishouden eerst.

### Iemand uitnodigen

1. Ga naar **Instellingen → App → Huishouden** en vul het e-mailadres van de ander in.
2. De ander logt in met precies dat e-mailadres en kiest **Deelnemen**.

Er wordt geen e-mail verstuurd; laat het de ander zelf weten.

### Admins

Een admin ziet alle huishoudens (Instellingen → App → **Beheer (admin)**) en kan:

- **Meekijken** in de financiële gegevens, alleen lezen, bijvoorbeeld om te helpen bij een vraag
- **Leden verwijderen** uit een huishouden
- **Mensen uitnodigen** voor een huishouden (de ander sluit zelf aan via Deelnemen)
- **Features instellen**, zoals het zonnescherm (Script URL en API-sleutel van dat huishouden)

Wie admin is, bepaal je zelf in de Firebase Console (zie stap 4).

---

## Installatie stap voor stap

### 1. Firebase-project

1. Maak in de [Firebase Console](https://console.firebase.google.com) een project aan en voeg een **Web-app** toe.
2. Zet de configuratie (apiKey, projectId, enz.) in `js/firebase-init.js`.
3. **Authentication → Sign-in method**: zet **Google** en **E-mail/wachtwoord** aan.
4. **Authentication → Settings → Authorized domains**: voeg het domein van je GitHub Pages toe (bijvoorbeeld `willemsen27.github.io`). `localhost` staat er standaard bij.
5. **Firestore Database → Create database**, kies een regio (bijvoorbeeld Nederland / `europe-west4`) en production mode.

> De Firebase-configuratie in `firebase-init.js` is geen geheim; de beveiliging zit in de Firestore-regels hieronder.

### 2. Beveiligingsregels publiceren

1. Open **Firestore Database → Rules**.
2. Plak de volledige inhoud van `firestore.rules`.
3. Klik op **Publish**.

Publiceer opnieuw na elke wijziging in `firestore.rules`.

### 3. GitHub Pages

1. Zet de bestanden in de hoofdmap van je repository en push.
2. **Settings → Pages**: Source = Deploy from a branch, branch `main`, folder `/root`.
3. De app staat dan op `https://<gebruikersnaam>.github.io/<repo>/` (of zonder `<repo>` als de repo `<gebruikersnaam>.github.io` heet).

### 4. Eerste admin aanmaken

Een collectie in Firestore bestaat pas als er een document in staat, en admins kunnen niet vanuit de app worden aangemaakt (anders kan iedereen zichzelf admin maken).

1. **Firestore Database → Data → Start collection**
2. Collection ID: `admins`
3. Document ID: jouw e-mailadres, **in kleine letters**, exact zoals je inlogt
4. Voeg één veld toe, bijvoorbeeld `note` (string) met waarde `admin`
5. **Save**

Log daarna opnieuw in; **Beheer (admin)** verschijnt onder Instellingen → App. Nog een admin? Voeg een extra document toe. Document weghalen = geen admin meer.

### 5. Gegevens overzetten uit de oude app (optioneel)

1. Log in en ga naar **Instellingen → App → Migreren uit de oude app**.
2. Vul de Script URL en API-sleutel van de oude app in (te vinden in de Instellingen van de oude app).
3. Klik **Gegevens ophalen**, controleer het overzicht en klik **Nu importeren**.

De oude app wordt alleen gelezen. Opnieuw uitvoeren is veilig: bestaande items worden overschreven, niet verdubbeld. Niet meegenomen: inactieve spaardoelen, historie van spaarstortingen en de zonnescherminstellingen.

### 6. Regiobank CSV importeren

1. Exporteer in Regiobank Online je transacties als **CSV**.
2. Open de app → **Import** en sleep het bestand erheen.
3. Pas per rij de categorie aan en vink rijen uit die je niet wilt importeren.
4. Klik **Importeer X transacties**.

**Af** = uitgave (positief bedrag), **Bij** = ontvangst (negatief bedrag).

---

## Lokaal draaien

De app moet via een webserver draaien (niet door het bestand te openen). Vanuit de hoofdmap van de repository:

```
python -m http.server 8080 --bind 127.0.0.1
```

Open daarna `http://localhost:8080/`. `localhost` is al toegestaan voor inloggen.

---

## Bestandsstructuur

```
├── index.html                  # Hoofdpagina (SPA shell)
├── firestore.rules             # Beveiligingsregels (plakken in de Firebase Console)
├── manifest.json, favicon.svg
├── css/
│   └── style.css               # Stylesheet
├── js/
│   ├── firebase-init.js        # Firebase-configuratie en SDK (beschikbaar als window.FB)
│   ├── config.js               # Sessiestatus + globale hulpfuncties
│   ├── features.js             # Per huishouden in-/uitgeschakelde onderdelen (zonnescherm)
│   ├── api.js                  # Alle lees- en schrijfacties op Firestore, met cache en live updates
│   ├── mutations.js            # Wijzigingen met melding bij slagen of mislukken
│   ├── auth.js                 # Inloggen, huishouden aanmaken/deelnemen/uitnodigen, meekijken
│   ├── admin.js                # Adminbeheer: huishoudens, leden, uitnodigingen, features
│   ├── migrate.js              # Eenmalige overzetting uit de oude Google Sheet-app
│   ├── router.js               # Hash-gebaseerde SPA-router
│   ├── app.js                  # Bootstrap
│   ├── dashboard.js            # Dashboard met Chart.js grafiek
│   ├── transactions.js         # Transactielijst met filters
│   ├── transaction-form.js     # Modal: transactie toevoegen/bewerken
│   ├── import.js               # CSV-import (Regiobank)
│   ├── budgets.js              # Budgetten met voortgangsbalk
│   ├── budget-override-form.js # Modal: maandelijks budget overschrijven
│   ├── savings.js              # Spaardoelen, afspraken en stortingen
│   ├── sunscreen.js            # Zonnescherm bedienen
│   └── settings.js             # Instellingen (categorieën, budgetten, huishouden, admin, migratie)
├── README.md                   # Deze handleiding
└── google-sheet-app/           # Archief: de oude versie met Google Sheet als database
```

---

## Datamodel (Firestore)

| Pad | Inhoud |
|---|---|
| `households/{id}` | naam, `members` (uid's), `member_info` (naam + e-mail per uid), `pending_invites` (e-mails), `features` |
| `households/{id}/transactions` | transacties |
| `households/{id}/categories` | categorieën |
| `households/{id}/budgets` | budgetten (inclusief versies per ingangsmaand) |
| `households/{id}/budget_overrides` | overschrijvingen per budget en maand |
| `households/{id}/savings_goals` | spaardoelen |
| `households/{id}/savings_rules` | spaarafspraken |
| `households/{id}/savings_jobs` | stortingen (openstaand, uitgevoerd, overgeslagen) |
| `invites/{huishouden}__{e-mail}` | uitnodiging voor een e-mailadres |
| `memberships/{e-mail}` | bij welk huishouden dit e-mailadres hoort (maximaal één) |
| `admins/{e-mail}` | alleen via de Console aan te maken; zo'n adres is admin |

---

## Technische details

| Onderdeel | Technologie |
|---|---|
| Frontend | Vanilla HTML5, CSS3, JavaScript ES2020+ |
| Hosting | GitHub Pages (statisch, geen buildstap) |
| Database | Firebase Firestore (met lokale cache voor snel openen) |
| Inloggen | Firebase Authentication (Google en e-mail/wachtwoord) |
| Grafiek | Chart.js (CDN) |
| Fonts | Inter via Google Fonts |

### Beveiliging

De toegang wordt volledig afgedwongen door `firestore.rules`, niet door de app:

- Een gebruiker leest en schrijft alleen gegevens van het eigen huishouden.
- Een e-mailadres kan maar aan één huishouden gekoppeld zijn.
- Een admin leest alle huishoudens, maar kan de financiële gegevens alleen lezen.
- Meekijken als admin is in de app ook geblokkeerd voor wijzigingen en toont een banner.

### Spaarstortingen en transacties

Voer je een storting uit (of vul je een spaardoel handmatig aan), dan komt er ook een afschrijving bij de transacties:

- omschrijving = naam van het spaardoel
- categorie = de categorie "Sparen" (of een categorie met "spaar"/"sparen" in de naam); is die er niet, dan blijft de categorie leeg

Een transactie verwijderen of aanpassen draait het saldo van het spaardoel niet terug.

---

## Veelgestelde vragen

**Q: Ik zie "Beheer (admin)" niet.**
A: Controleer of het document in `admins` precies jouw e-mailadres (kleine letters) als id heeft, of de nieuwste regels zijn gepubliceerd en of je e-mailadres geverifieerd is. Log daarna opnieuw in.

**Q: Uitnodigen of deelnemen mislukt.**
A: Het e-mailadres hoort waarschijnlijk al bij een ander huishouden, of de regels zijn niet gepubliceerd. De uitgenodigde moet inloggen met exact het uitgenodigde e-mailadres.

**Q: Kan ik meerdere huishoudens hebben?**
A: Nee, een e-mailadres hoort bij maximaal één huishouden.

**Q: Werkt de app offline?**
A: Gegevens die eerder zijn geladen staan in de lokale cache en zijn ook zonder verbinding zichtbaar en aan te passen; wijzigingen worden gesynchroniseerd zodra er weer verbinding is.

**Q: Hoe voeg ik een maandelijks budget toe voor een specifieke maand?**
A: Ga naar **Budgetten**, navigeer naar de gewenste maand en klik op het potlood-icoon naast een budget.

---

*Kasboek Willemsen — Firebase-versie*
