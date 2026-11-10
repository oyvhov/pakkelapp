<img src="docs/brand/logo-jul.svg" width="72" alt=""> <img src="docs/brand/logo-fest.svg" width="72" alt="">

# Pakkelapp

Gåver for heile storfamilien, til jul og alle andre feiringar: ønskelister, delte gåveplanar, ingen dobbeltkjøp og ingen avslørte overraskingar. Designforslaget står i [docs/DESIGN.md](docs/DESIGN.md), og merkevara i [docs/brand/BRAND.md](docs/brand/BRAND.md).

Éin Docker-container med Go og PocketBase (SQLite) og ein innebygd React-PWA.

## Start

```powershell
Copy-Item .env.example .env
docker compose up -d --build
docker compose logs pakkelapp
```

Appen svarar på `http://127.0.0.1:8430`. Fyrste oppstart skriv invitasjonslenka i loggen. Den fyrste som registrerer seg, blir eigar.

Lenka finst òg under **Meg** i appen, eller med:

```powershell
docker compose exec pakkelapp cat /data/invite.txt
```

## Cloudflare Tunnel

Legg til eit *Public Hostname* i tunnelen din i Cloudflare Zero Trust:

| Felt | Verdi |
| --- | --- |
| Subdomain | `jul` |
| Domain | `example.com` |
| Service | `http://localhost:8430` |

## Nissen og prissjekk (OpenAI)

Set `OPENAI_API_KEY` i `.env` og køyr `docker compose up -d`. Modell, av/på og dagleg grense per person blir styrt under **Innstillingar → Administrasjon** i appen.

## Administrasjon

Den fyrste som registrerer seg blir administrator. Administrator kan styre medlemer, invitasjon, Nissen og backup, men får ikkje meir innsyn i ønske, kjøp eller lister enn andre. PocketBase sitt eige adminpanel på `/_/` er stengt som standard, fordi det gjev full tilgang til databasen.

## Oppgjer

Reknestykka ligg i [internal/app/settle.go](internal/app/settle.go), alle beløp er heile øre, og unntaka er testa i `settle_test.go`.

## Varsel og deling

Varsel på telefonen krev ikkje oppsett. Serveren lagar nøklane sine ved fyrste start og legg dei i `vapid.json` i datavolumet. Kvar brukar slår på varsel og vel typar under Innstillingar, og på iPhone må appen liggje på heimskjermen først.

Ei ønskeliste kan delast med ei lenke på `/delt/...`, slik at folk utan konto kan reservere. Eigaren slår det på under innstillingane til lista, og lenka sluttar å verke når delinga blir slått av.

## Backup

PocketBase tek backup kvar natt klokka 04:15 og held på 14 stykke i volumet `pakkelapp-data`, under `/data/backups`. Dei ligg på same disk som databasen, så kopier dei òg ut av maskina om du vil vere trygg:

```powershell
docker cp pakkelapp:/data/backups ./backups
```

## Utvikling

Krev Node 22 og Docker. Go treng ikkje vere installert.

```powershell
docker run -d --name jul-dev -p 127.0.0.1:8431:8080 -v ${PWD}:/src -v pakkelapp-gocache:/go -w /src -e JUL_INVITE_CODE=testkode -e JUL_DATA_DIR=/tmp/pb golang:1.27-bookworm go run .
cd web; npm install; npm run dev
```

Tilgangsreglane blir testa mot ein tom database med:

```powershell
node scripts/test-access.mjs http://127.0.0.1:8431 testkode
```
