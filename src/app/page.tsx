"use client";

import { useMemo, useState } from "react";

type Person = {
  id: number;
  name: string;
  type: "gæst" | "medlem";
  clips: number | null;
  checkedIn: boolean;
};

const initialPeople: Person[] = [
  { id: 1, name: "Pia Hansen", type: "gæst", clips: null, checkedIn: true },
  { id: 2, name: "Lene Madsen", type: "medlem", clips: 0, checkedIn: true },
  { id: 3, name: "Mette Sørensen", type: "medlem", clips: 2, checkedIn: false },
  { id: 4, name: "Anne Larsen", type: "medlem", clips: 7, checkedIn: true },
  { id: 5, name: "Birgit Nielsen", type: "medlem", clips: 10, checkedIn: false },
];

export default function Home() {
  const [people, setPeople] = useState(initialPeople);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const sortedPeople = useMemo(
    () =>
      [...people].sort((a, b) => {
        const priority = (person: Person) => {
          if (person.type === "gæst") return 0;
          if (person.clips === 0) return 1;
          if ((person.clips ?? 0) <= 2) return 2;
          return 3;
        };
        return priority(a) - priority(b) || a.name.localeCompare(b.name, "da");
      }),
    [people],
  );

  const selected = people.find((person) => person.id === selectedId) ?? null;
  const checkedInCount = people.filter((person) => person.checkedIn).length;
  const paymentNeeded = people.filter(
    (person) => person.type === "gæst" || person.clips === 0,
  ).length;

  function toggleCheckIn(id: number) {
    setPeople((current) =>
      current.map((person) =>
        person.id === id
          ? { ...person, checkedIn: !person.checkedIn }
          : person,
      ),
    );
  }

  function registerPayment() {
    if (!selected) return;
    setPeople((current) =>
      current.map((person) =>
        person.id === selected.id
          ? { ...person, type: "medlem", clips: (person.clips ?? 0) + 10 }
          : person,
      ),
    );
    setSelectedId(null);
  }

  return (
    <main className="min-h-screen bg-[#f4f5f1] text-[#18322b]">
      <header className="border-b border-[#d9ded6] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#678177]">
              Træningssjov
            </p>
            <h1 className="text-xl font-bold">Søndagens træning</h1>
          </div>
          <div className="rounded-full bg-[#e8f0eb] px-3 py-1.5 text-sm font-semibold">
            10.00–11.30
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 py-6">
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Deltagere" value={checkedInCount.toString()} />
          <Stat label="Kræver handling" value={paymentNeeded.toString()} />
          <Stat label="Pris for 10 klip" value="375 kr." wide />
        </section>

        <section className="mt-6 overflow-hidden rounded-2xl border border-[#d9ded6] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#e4e7e2] px-4 py-4 md:px-6">
            <div>
              <h2 className="text-lg font-bold">Deltagerliste</h2>
              <p className="text-sm text-[#678177]">Betaling og lave saldi vises øverst.</p>
            </div>
            <button className="rounded-xl bg-[#18322b] px-4 py-2 text-sm font-bold text-white">
              + Tilføj person
            </button>
          </div>

          <div className="divide-y divide-[#e7e9e5]">
            {sortedPeople.map((person) => {
              const needsPayment = person.type === "gæst" || person.clips === 0;
              const lowBalance = person.type === "medlem" && (person.clips ?? 0) > 0 && (person.clips ?? 0) <= 2;

              return (
                <div key={person.id} className="flex items-center gap-3 px-4 py-4 md:px-6">
                  <button
                    onClick={() => toggleCheckIn(person.id)}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 font-bold transition ${
                      person.checkedIn
                        ? "border-[#2f765f] bg-[#2f765f] text-white"
                        : "border-[#b8c2bc] text-transparent"
                    }`}
                    aria-label={`Skift fremmøde for ${person.name}`}
                  >
                    ✓
                  </button>

                  <button
                    onClick={() => setSelectedId(person.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold">{person.name}</span>
                      {needsPayment && (
                        <span className="rounded-full bg-[#fff0d8] px-2 py-1 text-xs font-bold text-[#925a05]">
                          Skal betale 375 kr.
                        </span>
                      )}
                      {lowBalance && (
                        <span className="rounded-full bg-[#fce5e2] px-2 py-1 text-xs font-bold text-[#9a3b32]">
                          Kun {person.clips} klip tilbage
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[#678177]">
                      {person.type === "gæst" ? "Gæst" : `${person.clips} klip tilbage`}
                    </p>
                  </button>

                  <button
                    onClick={() => setSelectedId(person.id)}
                    className="rounded-lg border border-[#cfd6d1] px-3 py-2 text-sm font-semibold"
                  >
                    Åbn
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {selected && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/35 p-3 md:items-center md:justify-center">
          <div className="w-full rounded-2xl bg-white p-5 shadow-xl md:max-w-md">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-[#678177]">Registrer handling</p>
                <h3 className="text-xl font-bold">{selected.name}</h3>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-2xl leading-none">×</button>
            </div>

            <div className="mt-5 rounded-xl bg-[#f4f5f1] p-4">
              <div className="flex justify-between text-sm">
                <span>Betaling</span>
                <strong>375 kr.</strong>
              </div>
              <div className="mt-2 flex justify-between text-sm">
                <span>Tilføjes</span>
                <strong>10 klip</strong>
              </div>
              {selected.type === "gæst" && (
                <p className="mt-3 text-sm text-[#678177]">Personen ændres samtidig fra gæst til medlem.</p>
              )}
            </div>

            <button
              onClick={registerPayment}
              className="mt-4 w-full rounded-xl bg-[#2f765f] px-4 py-3 font-bold text-white"
            >
              Bekræft betaling modtaget
            </button>
            <button
              onClick={() => setSelectedId(null)}
              className="mt-2 w-full rounded-xl px-4 py-3 font-semibold text-[#52675f]"
            >
              Annuller
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-2xl border border-[#d9ded6] bg-white p-4 shadow-sm ${wide ? "col-span-2 md:col-span-1" : ""}`}>
      <p className="text-sm text-[#678177]">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
