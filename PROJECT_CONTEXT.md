# TRÆNINGSSJOV — PROJECT_CONTEXT.md

## Formål

TRÆNINGSSJOV er en mobilvenlig webapp til registrering af fremmøde, gæster, betalinger og klippekort for Randi Lynggaards træningshold i Hillerød.

Appen erstatter den nuværende papirbog og skal være ekstremt enkel at bruge under undervisning.

## Brugere

Primær bruger:

- Randi Lynggaard
- Ingen login i V1
- Ca. 60 deltagere

## Grundmodel

- Medlemmer køber 10 klip for 375 kr.
- Et normalt fremmøde bruger 1 klip.
- Første fremmøde som gæst er gratis prøvetime.
- Gæster har `balance = null`.
- Medlemmer har saldo 0–10.
- Ingen negativ saldo.
- Ingen kreditfunktion.

## Hold

Faste mandagshold:

- Mandag 17:00–18:00
- Mandag 18:00–19:00

Fælles hold:

- Torsdag 17:30
- Søndag

Torsdag og søndag viser medlemmer fra begge mandagsgrupper.

En persons saldo er fælles på tværs af alle hold.

## Navigation

Session-siden har:

`← Forrige | dato + hold | Næste →`

Randi navigerer mellem konkrete træningssessioner.

Fremmøde må ALDRIG lække mellem sessioner.

Når en ny session åbnes, skal UI-state altid nulstilles og data hentes ud fra den aktuelle `session_id`.

## Deltagerliste

Sortering:

1. Gæster der mangler betaling
2. Medlemmer med saldo 0
3. Aktive medlemmer med saldo > 0

Regler:

- Aktivt medlem kan trykkes fremmødt.
- Saldo 0 kan ikke registreres fremmødt.
- Gæst der mangler betaling kan ikke registreres som normalt medlem.
- Saldo 1 markeres tydeligt/rødt.
- Maksimumsaldo er 10.

## Fremmøde

Alt fremmøde håndteres gennem database-RPC:

`toggle_attendance(p_person_id, p_session_id)`

Operationen skal være atomisk.

Ved registrering:

1. Lås relevante data.
2. Kontroller at personen må registreres.
3. Opret attendance.
4. Træk 1 klip for medlem.
5. Gem `balance_after`.

Ved fortrydelse:

1. Slet attendance.
2. Læg klippet tilbage.
3. Opdater saldo atomisk.

Frontend må IKKE selv implementere saldo-logikken.

Klikknappen låses mens request kører for at forhindre dobbeltklik.

Efter succes genindlæses sessionens data.

## Gæster

Ny gæst:

- Tilføjes med navn.
- Første fremmøde er gratis prøvetime.
- `balance = null`.
- Navnet trimmes og valideres.
- Gæsten må ikke kunne oprettes flere gange i samme session.

Efter prøvetime:

- Gæsten føres videre til næste relevante træningsdag.
- Vis som "gæst mangler betaling".
- Kan ikke registreres fremmødt igen før konvertering/betaling.

## Gæst → medlem

Konvertering kræver eksplicit bekræftelse.

Ved betaling:

- Gæst konverteres til medlem.
- Der registreres betaling.
- Saldo sættes korrekt ud fra købet.
- Historik bevares.

Tilbageførsel af gæstekonvertering må kun ske, hvis gæsten ikke har brugt klip efter konverteringen.

Historikken må aldrig slettes vilkårligt.

## Betaling

Standard:

- 375 kr.
- 10 klip

Betaling registreres i `payments`.

Betaling gemmer:

- `person_id`
- `clips`
- `paid_at`
- `balance_after`

Historiske saldi skal læses fra gemte `balance_after`-værdier.

Systemet må IKKE rekonstruere gamle saldi ved runtime replay af alle transaktioner.

## Historiske rettelser

Tidligere fremmøde kan rettes gennem dedikeret RPC.

Rettelsen skal:

- Gemme før/efter.
- Gemme tidspunkt.
- Gemme session.
- Bevare audit trail.

Historiske ændringer må ikke automatisk ændre saldo gennem en efterfølgende betaling.

En betaling fungerer som kaskade-stop.

## Aflysning

En session kan aflyses og fortrydes igen.

Dato-logik skal beregnes i timezone:

`Europe/Copenhagen`

Frontend/browserens lokale tidszone må ikke være autoritativ.

## Datamodel

### people

Centrale felter:

- `id`
- `name`
- `type`
- `balance`
- `payment_status`

Typer:

- `medlem`
- `gæst`

Saldo:

- medlem: 0–10
- gæst: null

### attendance

Centrale felter:

- `id`
- `person_id`
- `session_id`
- `session_key`
- `attended_at`
- `type`
- `balance_after`

Attendance type:

- `normal`
- `prøvetime`

Der skal være unik constraint/index for person + session.

### payments

Centrale felter:

- `id`
- `person_id`
- `clips`
- `paid_at`
- `balance_after`

### classes

Centrale felter:

- `id`
- `name`
- `weekday`
- `start_time`
- `end_time`
- `active`
- `sort_order`

### class_memberships

Centrale felter:

- `class_id`
- `person_id`
- `active`

## Kritiske regler — MÅ IKKE BRYDES

1. Fremmøde skal være atomisk.
2. Ingen negativ saldo.
3. Gæster har `balance = null`.
4. Saldo må aldrig beregnes kun i frontend.
5. Fremmøde må aldrig lække mellem sessioner.
6. Historiske saldi skal baseres på `balance_after`.
7. Historik må ikke slettes som shortcut.
8. Dobbeltklik må ikke kunne give dobbelt registrering.
9. Betaling fungerer som stop for historiske saldo-kaskader.
10. Test/reset-funktioner må aldrig kunne bruges utilsigtet i produktion.
11. Eksisterende fungerende funktionalitet må ikke ændres uden regressionstest.

## Reset

Test-reset:

- Kræver `TEST_MODE`.
- Kræver service-role.
- Kræver eksplicit bekræftelse.
- Testvariabler fjernes før produktion.

Reset-regler:

- Faste medlemmer nulstilles til 10 klip.
- Gæstekonverteringer kan rulles tilbage efter gældende sikkerhedsregler.
- Test-oprettede/aflyste sessions kan nulstilles.

## Kendte tidligere regressioner

Disse fejl må ikke genintroduceres:

- Fremmøde lækkede mellem sessioner.
- Alle deltagere blev markeret ved navigation.
- Gæster blev ikke ført videre til næste træning.
- Tomt gæstenavn gav valideringsfejl.
- Gæst→medlem-konvertering manglede bekræftelse.
- Fremmøde kunne tidligere risikere race conditions/dobbeltklik.

## Obligatoriske regressionstests

Efter ændringer i attendance, sessions, payments eller guests skal mindst disse testes:

1. Medlem med 10 klip → fremmøde → 9.
2. Fortryd fremmøde → tilbage til 10.
3. Saldo 0 → fremmøde afvises.
4. Dobbeltklik giver kun én registrering.
5. Fremmøde i session A må ikke vises i session B.
6. Gæst får gratis prøvetime.
7. Gæst føres videre til næste træningsdag.
8. Gæst kan ikke bruge normalt klip før betaling.
9. Betaling giver korrekt saldo.
10. Historisk rettelse stopper ved næste betaling.
11. Aflyst session vises korrekt.
12. Fortryd aflysning fungerer korrekt.
13. Alle datoberegninger fungerer i `Europe/Copenhagen`.

## Arbejdsregel for AI

Før kode ændres:

1. Læs hele denne fil.
2. Identificér hvilke eksisterende regler ændringen påvirker.
3. Undersøg eksisterende implementation før ny kode skrives.
4. Undgå parallel forretningslogik i frontend og backend.
5. Find root cause frem for at lægge patches ovenpå patches.
6. Bevar eksisterende databasekontrakter medmindre ændringen er bevidst.
7. Kør relevante regressionstests efter ændringen.
8. Stop hvis løsningen kræver at en kritisk regel brydes.
9. Beskriv eksplicit hvis en ændring kan påvirke eksisterende funktionalitet.

## Aktuel produktstatus

Appen er funktionelt langt fremme, men må ikke betragtes som klar til produktion med rigtige medlemsdata før alle kritiske auditpunkter er lukket og produktionstilstanden er gennemgået.

Senest kendte auditstatus:

- Atomisk fremmøde: løst.
- Sikker test-reset: løst.
- Tilbageførsel af gæstekonvertering: løst.
- Audit-logning af historiske rettelser: delvist løst.
- Identifikation af den person, der foretager administrative rettelser, mangler fortsat fordi V1 ikke har login.

## Princip

TRÆNINGSSJOV skal prioriteres sådan:

**Dataintegritet → stabilitet → enkel brugeroplevelse → nye funktioner.**

En ny feature er ikke en forbedring, hvis den gør eksisterende data eller arbejdsgange mindre sikre.
