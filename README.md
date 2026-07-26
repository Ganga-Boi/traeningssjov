# Træningssjov

Mobil webapp til fremmøde, 10-klippekort og manuel registrering af MobilePay-betalinger.

## Det færdige flow

- Vælg søndags-, mandags- eller torsdagshold.
- Alle deltagere vises med deres aktuelle klipsaldo.
- Ét tryk registrerer fremmøde og trækker ét klip atomisk.
- Den fremmødte nedtones, men den nye saldo er stadig synlig.
- Fejlregistreret fremmøde kan fortrydes, så klippet sættes tilbage.
- En gæst kan oprettes direkte fra fremmødelisten.
- En godkendt betaling på 375 kr. gør gæsten til medlem og tilføjer 10 klip.
- En ny dato eller et andet hold får en ny fremmødeliste, mens deltagere og saldo følger med.

## Supabase

Ved en tom database køres filerne i denne rækkefølge i SQL Editor:

1. `supabase/schema.sql`
2. `supabase/classes-sessions-migration.sql`
3. `supabase/complete-v1.sql`

Ved den eksisterende database skal kun `supabase/complete-v1.sql` køres. Den kan køres flere gange og retter blandt andet den tidligere `permission denied for table classes`-fejl.

Vercel skal have:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

## Lokal kontrol

```bash
npm install
npm run lint
npm run build
```

V1 er uden login og indeholder derfor kun fiktive testnavne. Adgangsbeskyttelse skal aktiveres, før rigtige deltageroplysninger anvendes.
