# Repo aanmaken en de pipeline aanzetten

Dit is het enige stukje dat ik niet voor je kon doen: ik heb geen toegang tot je GitHub-account.
Reken op tien minuten. Alles hieronder gaat via de website, je hoeft geen terminal open te doen
als je dat niet wilt.

---

## Stap 1 — Maak een lege repository

1. Ga naar <https://github.com/new>.
2. **Repository name:** `milight-studio`
3. **Description:** `Self-hosted control for MiBoxer / Mi-Light lights, with groups, scenes and Alexa.`
4. Kies **Private** of **Public** — beide werken. (Public is gratis voor Actions en het
   containerregister; bij private krijg je 2000 gratis Actions-minuten per maand, wat ruim
   genoeg is voor dit project.)
5. **Belangrijk:** vink **niets** aan bij "Initialize this repository with". Geen README, geen
   .gitignore, geen licentie — die staan al in de code die ik heb gemaakt en anders krijg je een
   conflict.
6. Klik **Create repository**.

Je ziet nu een pagina met instructies en bovenaan de URL, zoiets als
`https://github.com/nataliya/milight-studio.git`. Die heb ik nodig.

## Stap 2 — Geef Actions toestemming om te schrijven

Dit is nodig omdat de pipeline zelf releases aanmaakt en het container-image publiceert.

1. In je nieuwe repo: **Settings → Actions → General**.
2. Scroll naar **Workflow permissions**.
3. Kies **Read and write permissions**.
4. Vink **Allow GitHub Actions to create and approve pull requests** aan.
5. **Save**.

## Stap 3 — Zet CodeQL aan

1. **Settings → Code security**.
2. Zet **Dependabot alerts**, **Dependabot security updates** en **Secret scanning** aan.
3. Bij **Code scanning**: kies **Set up → Advanced** als hij daarom vraagt — er staat al een
   `codeql.yml` in de code, dus je hoeft geen nieuwe workflow te maken. Als hij "Default" wil
   opdringen, kies dan alsnog Advanced, anders draaien er twee scanners langs elkaar.

## Stap 4 — Laat het mij pushen

Twee opties. **A** is het snelst.

### Optie A — geef mij een tijdelijke token (aanbevolen)

1. Ga naar <https://github.com/settings/personal-access-tokens/new> (Fine-grained token).
2. **Token name:** `milight-studio-init`
3. **Expiration:** 7 dagen. Korter mag ook.
4. **Repository access:** _Only select repositories_ → kies `milight-studio`.
5. **Permissions → Repository permissions**, zet deze op de genoemde waarde:
   - **Contents:** Read and write
   - **Workflows:** Read and write ← zonder deze weigert GitHub de push, omdat er
     `.github/workflows/`-bestanden in zitten
   - **Metadata:** Read-only (staat automatisch aan)
6. **Generate token** en kopieer hem.
7. Plak hem hier in de chat samen met de repo-URL. Ik push de volledige geschiedenis en
   bevestig wat er is gebeurd.
8. **Trek de token daarna weer in** op <https://github.com/settings/personal-access-tokens>.
   Hij heeft zijn werk dan gedaan.

Een fine-grained token met alleen deze repo en een vervaldatum van een week is echt beperkt —
hij kan niets buiten `milight-studio`, en hij verloopt vanzelf.

### Optie B — je doet de push zelf

Ik lever je het project als zip-bestand. Pak het uit en draai:

```bash
cd milight-studio
git init -b main
git add -A
git commit -m "feat: initial release of Milight Studio"
git remote add origin https://github.com/<jouw-naam>/milight-studio.git
git push -u origin main
```

Git vraagt om een gebruikersnaam en wachtwoord: vul je GitHub-naam in, en als wachtwoord een
Personal Access Token (niet je echte wachtwoord — dat accepteert GitHub niet meer).

---

## Stap 5 — Kijken of het werkt

Zodra de code binnen is, gebeurt dit vanzelf:

1. **CI** start meteen. Vier taken parallel: lint/format/types, alle tests met dekking,
   Playwright in twee schermformaten, en de container-build met een Trivy-scan.
   Duur: ongeveer 6–10 minuten. Zie het tabblad **Actions**.
2. **CodeQL** scant de code op beveiligingsproblemen.
3. **release-please** opent een pull request met de titel `chore(main): release 0.1.0`. Die PR
   bevat een gegenereerde changelog. **Merge hem** — dat is het releaseproces. Er wordt dan
   automatisch een tag `v0.1.0` gemaakt en een multi-arch container-image gepubliceerd naar
   `ghcr.io/<jouw-naam>/milight-studio:0.1.0` en `:latest`, voor zowel amd64 als arm64 (Pi).
4. **Nachtelijk** (02:17 Nederlandse tijd) draaien de zware controles: mutatietesten, een
   k6-loadtest, `pnpm audit`, gitleaks en Semgrep.

Daarna is dit je hele werkwijze: commit met een `feat:` of `fix:`-bericht, merge de release-PR
die vanzelf verschijnt, en `docker pull` de nieuwe versie. Je hoeft nooit handmatig een
versienummer te typen.

## Nog twee kleine dingen

- In `README.md`, `docker-compose.yml` en `docs/nl/snelstart.md` staat `OWNER` als
  plaatshouder in de image-URL's en de badges. Vervang dat door je GitHub-gebruikersnaam. Zeg
  het maar, dan doe ik het meteen goed als je me de naam geeft.
- Het gepubliceerde image staat standaard op private. Wil je hem publiek: **je profiel →
  Packages → milight-studio → Package settings → Change visibility**.

## Als er iets misgaat

| Foutmelding                                                              | Oorzaak                                                                     |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `refusing to allow a Personal Access Token to create or update workflow` | De token mist de **Workflows: Read and write**-permissie                    |
| `Resource not accessible by integration` in Actions                      | Stap 2 is overgeslagen — zet Workflow permissions op read/write             |
| release-please opent geen PR                                             | Er staat nog geen commit met een `feat:`- of `fix:`-prefix op `main`        |
| De Docker-publicatie faalt met `denied`                                  | Stap 2, én controleer dat de repo Actions mag laten schrijven naar Packages |
