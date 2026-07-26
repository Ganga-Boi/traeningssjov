"use client";

import type { Session } from "@supabase/supabase-js";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Person = {
  id: string;
  name: string;
  type: "gæst" | "medlem";
  balance: number | null;
  payment_status: "ok" | "skal_betale" | "blokeret";
};

type Attendance = {
  person_id: string;
};

const supabase = getSupabaseBrowserClient();

function sessionKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}-soendag-formiddag`;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<Person[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [addingPerson, setAddingPerson] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) void loadData();
  }, [session]);

  async function loadData() {
    setError("");
    const key = sessionKey();
    const [peopleResult, attendanceResult] = await Promise.all([
      supabase.from("people").select("id,name,type,balance,payment_status").order("name"),
      supabase.from("attendance").select("person_id").eq("session_key", key),
    ]);

    if (peopleResult.error) {
      setError(peopleResult.error.message);
      return;
    }
    if (attendanceResult.error) {
      setError(attendanceResult.error.message);
      return;
    }

    setPeople((peopleResult.data ?? []) as Person[]);
    setCheckedIds(new Set(((attendanceResult.data ?? []) as Attendance[]).map((row) => row.person_id)));
  }

  const sortedPeople = useMemo(
    () =>
      [...people].sort((a, b) => {
        const priority = (person: Person) => {
          if (person.balance === null) return 0;
          if (person.balance === 0) return 1;
          if (person.balance === -1) return 2;
          return 3;
        };
        return priority(a) - priority(b) || a.name.localeCompare(b.name, "da");
      }),
    [people],
  );

  async function checkIn(person: Person) {
    if (checkedIds.has(person.id) || savingId) return;
    setSavingId(person.id);
    setError("");

    const attendanceType = person.type === "gæst" ? "prøvetime" : (person.balance ?? 0) > 0 ? "normal" : "kredit";
    const { error: rpcError } = await supabase.rpc("register_attendance", {
      p_person_id: person.id,
      p_session_key: sessionKey(),
      p_type: attendanceType,
    });

    setSavingId(null);
    if (rpcError) {
      setError(rpcError.message.includes("duplicate") ? `${person.name} er allerede krydset af.` : rpcError.message);
      return;
    }

    await loadData();
  }

  if (loading) return <LoadingScreen />;
  if (!session) return <Login />;

  return (
    <main className="min-h-screen bg-[#f3f5f0] text-[#17342b]">
      <header className="sticky top-0 z-10 border-b border-[#dce2da] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-[#6b837a]">Træningssjov</p>
            <h1 className="text-xl font-extrabold">Dagens fremmøde</h1>
          </div>
          <button onClick={() => supabase.auth.signOut()} className="rounded-xl px-3 py-2 text-sm font-bold text-[#587067]">
            Log ud
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-xl px-4 pb-28 pt-5">
        <section className="grid grid-cols-2 gap-3">
          <Stat label="Mødt op" value={checkedIds.size.toString()} />
          <Stat label="På listen" value={people.length.toString()} />
        </section>

        {error && <div className="mt-4 rounded-2xl bg-[#fee9e5] p-4 text-sm font-semibold text-[#8d342d]">{error}</div>}

        <section className="mt-5 overflow-hidden rounded-3xl border border-[#dce2da] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#e8ece7] px-4 py-4">
            <div>
              <h2 className="text-lg font-extrabold">Deltagere</h2>
              <p className="text-sm text-[#6b837a]">Tryk én gang for at krydse af</p>
            </div>
            <button onClick={() => setAddingPerson(true)} className="rounded-2xl bg-[#17342b] px-4 py-3 text-sm font-extrabold text-white">
              + Ny
            </button>
          </div>

          {sortedPeople.length === 0 ? (
            <div className="px-5 py-10 text-center text-[#6b837a]">Ingen deltagere endnu.</div>
          ) : (
            <div className="divide-y divide-[#edf0ec]">
              {sortedPeople.map((person) => {
                const checked = checkedIds.has(person.id);
                return (
                  <button
                    key={person.id}
                    onClick={() => checkIn(person)}
                    disabled={checked || savingId === person.id}
                    className="flex min-h-20 w-full items-center gap-4 px-4 py-3 text-left disabled:cursor-default"
                  >
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-xl font-black ${checked ? "border-[#28755d] bg-[#28755d] text-white" : "border-[#bdc9c2] bg-white text-transparent"}`}>
                      ✓
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg font-extrabold">{person.name}</span>
                      <span className="mt-0.5 block text-sm text-[#6b837a]">
                        {checked ? "Mødt op" : person.type === "gæst" ? "Gæst" : `${person.balance} klip tilbage`}
                      </span>
                    </span>
                    {!checked && <span className="text-sm font-bold text-[#28755d]">Kryds af</span>}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <a href="/privatliv" className="mt-5 block text-center text-sm font-semibold text-[#6b837a] underline underline-offset-4">
          Sådan behandler vi personoplysninger
        </a>
      </div>

      {addingPerson && <AddPerson onClose={() => setAddingPerson(false)} onCreated={loadData} />}
    </main>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMessage("E-mail eller adgangskode er forkert.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f5f0] p-5 text-[#17342b]">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-xs font-extrabold uppercase tracking-[0.24em] text-[#6b837a]">Træningssjov</p>
        <h1 className="mt-2 text-3xl font-black">Log ind</h1>
        <p className="mt-2 text-[#6b837a]">Kun for den, der administrerer fremmødet.</p>
        <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" className="mt-6 w-full rounded-2xl border border-[#ccd6d0] px-4 py-4 text-base outline-none focus:border-[#28755d]" />
        <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Adgangskode" className="mt-3 w-full rounded-2xl border border-[#ccd6d0] px-4 py-4 text-base outline-none focus:border-[#28755d]" />
        {message && <p className="mt-3 text-sm font-semibold text-[#9a3b32]">{message}</p>}
        <button disabled={busy} className="mt-5 w-full rounded-2xl bg-[#17342b] px-4 py-4 text-base font-extrabold text-white disabled:opacity-60">
          {busy ? "Logger ind…" : "Log ind"}
        </button>
      </form>
    </main>
  );
}

function AddPerson({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [informed, setInformed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!informed) return;
    setBusy(true);
    const { error: insertError } = await supabase.from("people").insert({
      name: name.trim(),
      type: "gæst",
      balance: null,
      payment_status: "skal_betale",
    });
    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    await onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40 p-3 sm:items-center sm:justify-center">
      <form onSubmit={submit} className="w-full rounded-3xl bg-white p-5 text-[#17342b] shadow-xl sm:max-w-md">
        <div className="flex items-start justify-between">
          <div><p className="text-sm text-[#6b837a]">Ny deltager</p><h2 className="text-2xl font-black">Tilføj navn</h2></div>
          <button type="button" onClick={onClose} className="px-2 text-3xl">×</button>
        </div>
        <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Navn" className="mt-5 w-full rounded-2xl border border-[#ccd6d0] px-4 py-4 text-lg outline-none focus:border-[#28755d]" />
        <label className="mt-4 flex gap-3 rounded-2xl bg-[#f3f5f0] p-4 text-sm leading-5">
          <input type="checkbox" checked={informed} onChange={(e) => setInformed(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
          <span>Personen er informeret om, at navn og fremmøde gemmes for at administrere holdet.</span>
        </label>
        {error && <p className="mt-3 text-sm font-semibold text-[#9a3b32]">{error}</p>}
        <button disabled={!informed || busy} className="mt-4 w-full rounded-2xl bg-[#28755d] px-4 py-4 font-extrabold text-white disabled:opacity-40">
          {busy ? "Gemmer…" : "Gem deltager"}
        </button>
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-3xl border border-[#dce2da] bg-white p-4 shadow-sm"><p className="text-sm text-[#6b837a]">{label}</p><p className="mt-1 text-3xl font-black">{value}</p></div>;
}

function LoadingScreen() {
  return <main className="flex min-h-screen items-center justify-center bg-[#f3f5f0] font-bold text-[#6b837a]">Indlæser…</main>;
}
