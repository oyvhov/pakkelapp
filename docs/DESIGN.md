# Pakkelapp: designforslag

Gåver for heile storfamilien, til jul og resten av året. Namnet kjem frå den vesle lappen på kvar pakke, og den lappen er òg det visuelle kjerneelementet i appen.

## Idé

To ting skal aldri skje: at nokon kjøper det same, og at nokon får avslørt overraskinga. Alt anna i appen byggjer på det.

| Konsept | Forklaring |
| --- | --- |
| **Ønskeliste** | «Dette ønskjer eg meg.» Synleg for familien som standard. |
| **Gåveplan** | «Dette skal eg gje.» Privat som standard, kan delast med utvalde som medredaktørar. |
| **Person** | Alle som gjev eller får. Treng ikkje konto (bestemor, småbarn), og kan knytast til ein konto seinare. |
| **Reservasjon** | «Eg tek denne» på eit ønske. Fleire kan bli med og spleise. |

## Vern mot spoilarar

Reglane ligg i databasen (`internal/app/schema.go`), ikkje berre i grensesnittet:

- Den som ønskjer seg noko ser aldri reservasjonar eller kommentarar på sine eigne ønske.
- Ei gåve i ein delt gåveplan er usynleg for den ho er meint til, sjølv om vedkomande er medredaktør på lista.
- Sanntidsoppdateringar følgjer dei same reglane.
- Nissen (AI) får berre det brukaren sjølv har lov til å sjå.
- Gåvebilete er verna og krev ein kortliva nøkkel, så ei kjend adresse avslører ingenting.
- Varsel på telefonen nemner aldri kva gåva er. Takkelista er stengd på serveren fram til julaften.

## Visuell retning

Sjå òg [merkevara](brand/BRAND.md).

Nordisk vinterkveld, ikkje julekitsch: mørk furu, varmt papir, tyttebær og messing. Inga raud/grøn-blinking, ingen nisseklipart.

| Token | Lys | Mørk («Julenatt») |
| --- | --- | --- |
| Bakgrunn | `#f6f1e7` | `#0e1a17` |
| Flate | `#fffdf8` | `#15251f` |
| Tekst | `#1c2a25` | `#f3ecdf` |
| Furu (hovudflater) | `#17372f` | `#1d3a32` |
| Tyttebær (handling) | `#a8233b` | `#e0566e` |
| Messing (detaljar) | `#b88a35` | `#dcb468` |

- **Typografi:** Fraunces til overskrifter og tal, Inter til alt anna. Sjølvhosta.
- **Signatur:** Pakkelappen med hol og lett skeiv vinkel, «Til Mamma / Frå Pappa», ligg over biletet på kvart gåvekort.
- **Rørsle:** Korte overgangar, og `prefers-reduced-motion` blir respektert.
- **Ikon:** Lucide, ingen emoji i grensesnittet.

## Skjermar

| Skjerm | Innhald |
| --- | --- |
| **Oversikt** | Nedteljing til julaften, pengar brukt, kven som manglar gåve, neste kjøp, ledige ønske. |
| **Folk** | Privat liste over kven som skal få gåve, utan at gåva må vere bestemt. Rask «legg til person». Personside med ønske, plan og interesser. |
| **Lister** | Mine, delte med meg, familien sine, og tidlegare år. |
| **Oppgjer** | Kven som skal betale kven, med stadfesting, ettergjeving og forklaring. |
| **Nissen** | AI-rådgjevar med valfrie spørsmål. Forslag blir til gåvekort med eitt trykk. |
| **Innstillingar** | Profil, Vipps, tema, varsel, bokmerke for PC, invitasjon, passord, og Administrasjon for administrator. |
| **Takkelista** | Opnar klokka 18 på julaften og står ut februar. Viser kven som gav deg kva, med avkryssing og rydding av ønskelista. |
| **Delt ønskeliste** | Offentleg side på `/delt/...` for dei utan konto. Ein gjest kan reservere og angre, utan å sjå kven andre er. |

Lister kan òg gjelde bursdag, konfirmasjon, bryllup eller anna høve. Dei har dato og nedteljing og blir haldne utanfor julesummane. Nye ønske får eit merke til du har opna personen, og ønske kan arkiverast utan å bli sletta.

Mobil først med botnmeny og sentral «+». Frå 900 px blir menyen ei sidestolpe, og ark blir sentrerte dialogar.

## Legg til ei gåve

1. Lim inn lenka, eller del frå nettlesaren på mobilen via PWA-delemenyen.
2. Serveren hentar tittel, pris, bilete og butikk (JSON-LD, Open Graph, og Nissen som reserve).
3. Vel Til og Frå med chips. Ny person kan leggjast til utan å forlate skjemaet.
4. Bilete kan òg limast inn, dragast inn eller takast med kamera.

## AI: Nissen

- Stiller enkle, valfrie spørsmål om alder, kjønn, relasjon, budsjett og type gåve, og hoppar over det han alt veit.
- Foreslår gåver ut frå det, saman med ønske og kva personen fekk i fjor.
- Veit at familien bur på Vestlandet: opplevingar og butikkar der ein må møte opp, skal vere der. Nettbutikkar som sender heim er alltid med. Området kan endrast under Administrasjon.
- Finn beste pris: søkjer i butikkar og les prisen frå sjølve butikksida der det går. Lenker modellen ikkje faktisk har funne, blir fjerna. Sjekken er innbygd i skjemaet for ny gåve og køyrer automatisk etter lagring, og funna blir lagra på gåva. Kan slåast av under Administrasjon.
- Stenger ein butikk for lenkehenting, blir produktet slått opp med nettsøk i staden.
- Skriv pakkerim som hintar utan å avsløre gåva.

Modellen er frå OpenAI og blir vald under Administrasjon. Utan API-nøkkel fungerer alt anna som normalt.

## Oppgjer

| Situasjon | Slik blir det handtert |
| --- | --- |
| Spleis likt | Summen stemmer alltid på øret, og den ekstra øren går på omgang |
| Ulike delar, prosent, faste beløp | Faste beløp fyrst, resten etter vekt. Vekt 0 slepp å betale |
| Fleire betalarar, eller betalar utanfor spleisen | Skulda blir fordelt nøyaktig på dei som la ut |
| Barn og hushald | «Kostnader går via» samlar skulda hos éin. Innanfor hushaldet er det inga skuld |
| Motsett skuld og kjeder | Blir nulla ut og samla i færre overføringar, om dei det gjeld vil |
| Retur og prisavslag | «Pengar tilbake» reverserer heilt eller delvis |
| Delbetaling, overbetaling, ettergjeving | Mottakar stadfestar. For mykje betalt snur skulda |
| Stemmer ikkje | Den som er med kan varsle om det. Summane står til den som la inn utlegget har retta det |
| Anna valuta, tidlegare år | Beløp med kurs. Skuld følgjer med til neste år |
| Slettar gåve eller person | Utlegget blir ståande, og personar med utlegg kan ikkje fjernast |
| Spoilarar | Mottakaren ser berre «Hemmeleg gåve», aldri namnet |

## Rolle som administrator

Administrasjon handlar berre om drift. Det finst ingen veg derifrå til ønske, kjøp eller lister.

## Teknikk

Éin container: Go + PocketBase (SQLite) med innebygd React-PWA. Sanntid over SSE, automatisk nattleg backup i datavolumet. Invitasjon med lenke, ingen e-postteneste trengst.
