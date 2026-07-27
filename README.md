# Træningssjov

Mobil webapp til fremmøde, 10-klippekort og manuel registrering af MobilePay-betalinger.

## Det færdige flow

- Vælg søndags-, mandags- eller torsdagshold.
- Alle deltagere vises med deres aktuelle klipsaldo.
- Ét tryk registrerer fremmøde og trækker ét klip atomisk.
- Den fremmødte nedtones, men den nye saldo er stadig synlig.
- Fejlregistreret fremmøde kan fortrydes, så klippet sættes tilbage.
- En gæst kan oprettes direkte fra fremmødelisten.
- Gæstens første fremmøde er en gratis prøvetime.
- På næste træningsgang står gæsten som `Skal betale`.
- En godkendt betaling på 375 kr. gør gæsten til medlem og sætter saldoen til 10 klip.
- En ny dato eller et andet hold får en ny fremmødeliste, mens deltagere og saldo følger med.
- Medlemmer kan ikke registreres ved 0 klip, før MobilePay er bekræftet.
- Gæster har `NULL` som saldo, så de ikke kan forveksles med medlemmer på 0 klip.

## Supabase

Ved en tom database køres filerne i denne rækkefølge i SQL Editor:

1. `supabase/schema.sql`
2. `supabase/classes-sessions-migration.sql`
3. `supabase/complete-v1.sql`

Ved den eksisterende database køres kun `supabase/stabilize-v1.sql`. Den er
ikke-slettende, kan køres flere gange og håndhæver blandt andet:

- saldo `NULL` for gæster og 0–10 for medlemmer
- ingen fremmøde på kredit
- atomisk gæsteoprettelse uden navnedubletter
- ét fremmøde pr. person og træningsgang
- serverbeskyttelse af betalende medlemmer ved gæstesletning

Vercel skal have:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

## Lokal kontrol

```bash
npm ci
npm run lint
npm run build
```
