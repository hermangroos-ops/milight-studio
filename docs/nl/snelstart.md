# Snelstart

Deze gids brengt je van "doos met MiBoxer-lampen" naar "lampen bedienen met de app en met
Alexa". Reken op een avond, waarvan het meeste wachten op soldeertin.

## 1. De gateway bouwen

De WL-Box1 die bij je lampen zat praat alleen met de Chinese cloud van Futlight. Er is geen
lokale API, dus daar valt niets tegenaan te bouwen. Je vervangt hem door een ESP8266 met een
NRF24L01+-radio, die het Mi-Light-protocol rechtstreeks spreekt.

Onderdelen (± €20) en het complete stappenplan staan in [hardware.md](../hardware.md). De
korte versie:

1. Sluit de radio aan op de ESP8266 (7 draadjes) en soldeer een condensator van 100 µF over
   VCC en GND van de radio. Die condensator lost negen van de tien "doet het soms" problemen op.
2. Flash de firmware van `esp8266_milight_hub` via de web-installer in Chrome of Edge.
3. Zet hem op je wifi (2,4 GHz) en geef hem een vast IP-adres in je router.
4. Controleer dat `http://<ip-van-de-hub>/about` antwoordt.

Je bestaande fysieke afstandsbedieningen blijven gewoon werken.

## 2. Milight Studio starten

Met Docker, bijvoorbeeld op een Raspberry Pi of een NAS:

```bash
docker run -d --name milight-studio \
  -p 8080:8080 \
  -v milight-studio-data:/data \
  -e MILIGHT_HUB_URL=http://192.168.1.42 \
  --restart unless-stopped \
  ghcr.io/OWNER/milight-studio:latest
```

Vervang `192.168.1.42` door het adres van je hub. Open daarna `http://<ip>:8080`. Op je telefoon
kun je de app via het browsermenu op je beginscherm zetten; hij gedraagt zich dan als een echte
app.

## 3. Lampen toevoegen

Elke MiBoxer-lamp luistert naar een combinatie van **afstandsbedieningstype + apparaat-id +
zone**. Je hebt twee routes.

**Route A — je bestaande koppeling overnemen (geen opnieuw koppelen nodig)**

1. Open de webinterface van de hub en ga naar de **Sniff**-weergave.
2. Druk op een knop van je fysieke afstandsbediening, dicht bij de hub.
3. Je ziet het apparaat-id (bijvoorbeeld `0x1f2a`), het type (`rgb_cct`, `cct`, `fut089`, …) en
   de zone voorbijkomen.
4. Vul die drie waarden in bij **Instellingen → Lamp toevoegen** in Milight Studio.

**Route B — opnieuw koppelen**

1. Voeg de lamp toe met een zelfgekozen apparaat-id (bijvoorbeeld `0x1234`) en zone 1.
2. Haal de lamp van de stroom en zet hem er weer op. Druk **binnen drie seconden** op
   **Koppelen**. De lamp knippert ter bevestiging.
3. Gebruik per lamp een andere zone (of een ander apparaat-id) als je ze los wilt bedienen.

Test aan/uit, helderheid en kleur voordat je verdergaat.

## 4. Groepen en scènes

- Een **groep** in deze app is niet hetzelfde als een MiLight-zone: hij mag lampen van
  verschillende types en verschillende apparaat-id's bevatten. Maak er een per kamer.
- Een **scène** legt de huidige stand van een aantal lampen en groepen vast. "Filmavond",
  "Opstaan", "Alles uit". Eén tik, of één zin tegen Alexa.

## 5. Alexa koppelen

De volledige afweging staat in [alexa.md](../alexa.md). Samengevat:

**Matter-bridge — dit is wat je wilt.** Gratis, volledig lokaal, en Alexa kan er kleur én
kleurtemperatuur mee bedienen. Je hebt wel een Matter-geschikte Echo nodig: een Echo (Dot) van
de 4e generatie of nieuwer, een Echo Hub, of een recente Echo Show. Je netwerk moet IPv6 aan
hebben staan.

```bash
docker run -d --name milight-studio \
  --network host \
  -v milight-studio-data:/data \
  -e MILIGHT_HUB_URL=http://192.168.1.42 \
  -e MATTER_BRIDGE_ENABLED=true \
  ghcr.io/OWNER/milight-studio:latest
```

De koppelcode staat in het log en op de pagina **Instellingen** in de app. In de Alexa-app:
**Apparaten → + → Apparaat toevoegen → Overig → Matter → Ik heb geen QR-code**, en typ de code
over.

**Hue-emulatie — alleen als je geen Matter-Echo hebt.** Werkt zonder account en zonder cloud,
maar Alexa stuurt via deze weg alleen aan/uit en dimmen; **geen kleur**. Amazon bouwt deze route
bovendien af. Zet `HUE_BRIDGE_ENABLED=true`, gebruik `--network host` (poort 80 is verplicht) en
zeg _"Alexa, ontdek apparaten"_.

Wat je daarna kunt zeggen:

- _"Alexa, zet de keuken aan"_
- _"Alexa, dim de woonkamer naar 30 procent"_
- _"Alexa, maak de eettafel warm wit"_
- _"Alexa, zet filmavond aan"_

## Als er iets niet werkt

| Probleem                                      | Wat te doen                                                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| De app zegt dat de hub onbereikbaar is        | Klopt `MILIGHT_HUB_URL`? Antwoordt `http://<hub>/about` vanaf de machine waar de app draait?                                |
| Lampen reageren niet, hub-interface werkt wel | Bijna altijd een slechte NRF24-kloon. Wissel hem om. Daarna: bedrading, daarna de condensator                               |
| Werkt soms wel, soms niet                     | Condensator erbij, radio verder van de ESP-antenne, gesoldeerd in plaats van losse draadjes                                 |
| Commando's vallen weg als je snel schuift     | Zet `MILIGHT_HUB_MIN_GAP_MS` hoger, bijvoorbeeld 80 of 120                                                                  |
| Alexa vindt niets                             | Container op `--network host`? Minder dan ±49 apparaten zichtbaar? Zet `exposeToVoice` uit op wat je niet met je stem hoeft |
| Een lamp negeert één specifiek commando       | Kijk naar het type: een `cct`-lamp heeft geen kleur, een `rgb`-lamp geen kleurtemperatuur. De app verbergt wat niet kan     |

Meer diepgang: [hardware.md](../hardware.md) voor de bouw, [alexa.md](../alexa.md) voor de
spraakkoppeling, [api.md](../api.md) als je zelf iets tegen de API wilt bouwen.
