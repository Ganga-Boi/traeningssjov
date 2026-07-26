import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f4f5f1] px-5 py-10 text-[#18322b]">
      <article className="mx-auto max-w-2xl rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#678177]">Træningssjov</p>
        <h1 className="mt-2 text-3xl font-bold">Privatliv</h1>

        <div className="mt-6 space-y-5 leading-7 text-[#40574f]">
          <p>
            Træningssjov registrerer navn, fremmøde og eventuel klipsaldo for at administrere holdets deltagere.
          </p>
          <p>
            Oplysningerne bruges kun internt til administration og deles ikke med uvedkommende.
          </p>
          <p>
            Du kan bede om indsigt i dine oplysninger eller få dem slettet, når de ikke længere er nødvendige for administrationen.
          </p>
          <p>
            Der registreres ikke CPR-nummer, helbredsoplysninger eller andre unødvendige personoplysninger.
          </p>
          <p className="rounded-2xl bg-[#fff2d7] p-4 font-semibold text-[#80580c]">
            Denne testversion er uden login og må derfor kun bruges med fiktive navne. Rigtige deltageroplysninger kræver adgangsbeskyttelse.
          </p>
        </div>

        <Link href="/" className="mt-8 inline-flex rounded-xl bg-[#18322b] px-4 py-3 font-bold text-white">
          Tilbage
        </Link>
      </article>
    </main>
  );
}
