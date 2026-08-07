# TRÆNINGSSJOV — STATUS

**Opdateret:** 7. august 2026  
**Fase:** Aktiv test  
**Produktionsstatus:** Ikke klar til rigtige medlemsdata

## Det virker nu

- Atomisk fremmøde via `toggle_attendance`.
- Ét fremmøde trækker præcis ét klip.
- Fortryd fremmøde giver ét klip tilbage.
- Knapper låses under databasekald.
- Sessionens data genhentes efter ændringer.
- Fremmøde er adskilt pr. `session_id`.
- Gæster kan oprettes og få gratis prøvetime.
- Gæster kan konverteres til medlemmer efter bekræftet betaling.
- Usikker tilbageførsel af gæstekonvertering blokeres.
- Betaling registrerer 10 klip for 375 kr.
- Sessioner kan aflyses og kontrolleret genåbnes.
- Historiske dage kan vises med gemt `balance_after`.
- Medlemmer kan deaktiveres uden at miste historik.
- Test-reset er beskyttet af testtilstand og serveradgang.
- Permanente handlinger registreres i aktivitetsloggen.
- Deltagerlisten har søgning og fremmødetæller.
- Projektets faste regler findes i `PROJECT_CONTEXT.md`.

## Må stadig kun bruges til test

Appen må ikke indeholde rigtige medlemsdata endnu.

Test-reset og testmiljø skal bevares, indtil de åbne punkter er lukket.

## Åbne blokeringer

### 1. Migrationskæden

En tom database kan ikke dokumenteret bygges korrekt fra repoet:

- `class_memberships` bruges før tabellen oprettes.
- `clip_transactions` findes i den aktive database, men mangler en fuld oprettelsesmigration.
- Testdata ligger i en migration og skal flyttes til et separat test-seed.

### 2. Automatisk regressionstest

Der mangler en rigtig testsuite, som automatisk kontrollerer reglerne i `PROJECT_CONTEXT.md`.

### 3. Personer med samme navn

Den nuværende globale navneblokering skal erstattes af en sikker måde at håndtere to forskellige personer med samme navn.

### 4. Gæstens mandagshold

Ved konvertering fra gæst til medlem skal det være entydigt, om personen tilhører mandag 17–18 eller mandag 18–19.

### 5. Produktionsadgang

V1 har ingen login. Før rigtige data anvendes, skal det besluttes og dokumenteres, hvordan skriveadgang beskyttes, uden at Randis arbejdsgang bliver unødigt besværlig.

## Næste prioritet

1. Reparér migrationsrækkefølgen.
2. Tilføj den manglende `clip_transactions`-migration.
3. Flyt testpersoner ud af produktionsmigrationerne.
4. Kør hele databasen op fra nul.
5. Byg automatiske regressionstests.
6. Luk navne-, hold- og adgangsbeslutningerne.
7. Kør fuld accepttest.
8. Fjern test-reset fra produktionsmiljøet.
9. Først derefter: rigtige medlemsdata.

## Arbejdsregel

Alle ændringer skal følge `PROJECT_CONTEXT.md`.

Prioritet:

**Dataintegritet → stabilitet → enkel brugeroplevelse → nye funktioner.**
