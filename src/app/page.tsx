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
  created_at: string;
};

type TrainingClass = {
  id: string;
  name: string;
  weekday: number;
  start_time: string;
  end_time: string;
  sort_order: number;
};

type TrainingSession = {
  id: string;
  status: "planlagt" | "afholdt" | "aflyst";
};

type Attendance = { person_id: string };

const supabase = getSupabaseBrowserClient();

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nearestDateForWeekday(weekday: number) {
  const today = new Date();
  const current = today.getDay() === 0 ? 7 : today.getDay();
  const difference = weekday - current;
  const result = new Date(today);
  result.setDate(today.getDate() + difference);
  return localDateValue(result);
}

function displayTime(value: string) {
  return value.slice(0, 5).replace(":", ".");
}

function displayDate(value: string) {
  return new Intl.DateTimeFormat("da-DK", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

export default function Home() {
  const [authSession, setAuthSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [classes, setClasses] = useState<TrainingClass[]>([]);
  const [selectedClass, setSelectedClass] = useState<TrainingClass | null>(null);
  const [sessionDate, setSessionDate] = useState(localDateValue(new Date()));
  const [trainingSession, setTrainingSession] = useState<TrainingSession | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [addingPerson, setAddingPerson] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAuthSession(data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setAuthSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (authSession) void loadClasses();
  }, [authSession]);

  useEffect(() => {
    if (authSession && selectedClass) void loadAttendancePage();
  }, [authSession, selectedClass, sessionDate]);

  async function loadClasses() {
    setError("");
    const { data, error: classError } = await supabase
      .from("classes")
      .select("id,name,weekday,start_time,end_time,sort_order")
      .eq("active", true)
      .order("sort_order");

    if (classError) {
      setError(classError.message);
      return;
    }

    setClasses((data ?? []) as TrainingClass[]);
  }

  async function loadAttendancePage() {
    if (!selectedClass) return;
    setError("");

    const [peopleResult, sessionResult] = await Promise.all([
      supabase
        .from("people")
        .select("id,name,type,balance,payment_status,created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("sessions")
        .select("id,status")
        .eq("class_id", selectedClass.id)
        .eq("session_date", sessionDate)
        .maybeSingle(),
    ]);

    if (peopleResult.error) {
      setError(peopleResult.error.message);
      return;
    }
    if (sessionResult.error) {
      setError(sessionResult.error.message);
      return;
    }

    const foundSession = (sessionResult.data ?? null) as TrainingSession | null;
    setTrainingSession(foundSession);
    setPeople((peopleResult.data ?? []) as Person[]);

    if (!foundSession) {
      setCheckedIds(new Set());
      return;
    }

    const attendanceResult = await supabase
      .from("attendance")
      .select("person_id")
      .eq("session_id", foundSession.id);

    if (attendanceResult.error) {
      setError(attendanceResult.error.message);
      return;
    }

    setCheckedIds(new Set(((attendanceResult.data ?? []) as Attendance[]).map((row) => row.person_id)));
  }

  function chooseClass(item: TrainingClass) {
    setSelectedClass(item);
    setSessionDate(nearestDateForWeekday(item.weekday));
    setTrainingSession(null);
    setCheckedIds(new Set());
  }

  async function ensureTrainingSession() {
    if (!selectedClass) return null;
    if (trainingSession) return trainingSession;

    const { data, error: rpcError } = await supabase.rpc("get_or_create_session", {
      p_class_id: selectedClass.id,
      p_session_date: sessionDate,
    });

    if (rpcError) {
      setError(rpcError.message);
      return null;
    }

    const created = data as TrainingSession;
    setTrainingSession(created);
    return created;
  }

  const sortedPeople = useMemo(
    () =>
      [...people].sort((a, b) => {
        const priority = (person: Person) => {
          if (person.balance === null) return 0;
          if (person.balance === 0) return 1;
          if (person.balance < 0) return 2;
          return 3;
        };
        return (
          priority(a) - priority(b) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
          a.name.localeCompare(b.name, "da")
        );
      }),
    [people],
  );

  async function checkIn(person: Person) {
    if (checkedIds.has(person.id) || savingId || trainingSession?.status === "aflyst") return;
    setSavingId(person.id);
    setError("");

    const activeSession = await ensureTrainingSession();
    if (!activeSession) {
      setSavingId(null);
      return;
    }

    const attendanceType =
      person.type === "gæst" ? "prøvetime" : (person.balance ?? 0) > 0 ? "normal" : "kredit";

    const { error: rpcError } = await supabase.rpc("register_attendance_for_session", {
      p_person_id: person.id,
      p_session_id: activeSession.id,
      p_type: attendanceType,
    });

    setSavingId(null);
    if (rpcError) {
      setError(rpcError.message.includes("duplicate") ? `${person.name} er allerede krydset af.` : rpcError.message);
      return;
    }

    await loadAttendancePage();
  }

  if (loading) return <LoadingScreen />;
  if (!authSession) return <Login />;

  if (!selectedClass) {
    return (
      <main className="min-h-screen bg-[#f3f5f0] px-4 py-7 text-[#17342b]">
        <div className="mx-auto max-w-xl">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-[#6b837a]">Træningssjov</p>
              <h1 className="mt-1 text-3xl font-black">Vælg hold</h1>
              <p className="mt-2 text-[#6b837a]">Tryk på det hold, du vil registrere fremmøde på.</p>
            </div>
            <button onClick={() => supabase.auth.signOut()} className="rounded-xl px-3 py-2 text-sm font-bold text-[#587067]">Log ud</button>
          </div>

          {error && <ErrorBox message={error} />}

          <div className="mt-6 space-y-3">
            {classes.map((item) => (
              <button
                key={item.id}
                onClick={() => chooseClass(item)}
                className="flex w-full items-center justify-between rounded-3xl border border-[#dce2da] bg-white p-5 text-left shadow-sm active:scale-[0.99]"
              >
                <span>
                  <span className="block text-xl font-black">{item.name}</span>
                  <span className="mt-1 block text-[#6b837a]">{displayTime(item.start_time)}–{displayTime(item.end_time)}</span>
                </span>
                <span className="text-2xl text-[#28755d]">›</span>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f3f5f0] text-[#17342b]">
      <header className="sticky top-0 z-10 border-b border-[#dce2da] bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <button onClick={() => setSelectedClass(null)} className="rounded-xl py-2 pr-3 text-sm font-extrabold text-[#28755d]">‹ Hold</button>
            <button onClick={() => supabase.auth.signOut()} className="rounded-xl px-3 py-2 text-sm font-bold text-[#587067]">Log ud</button>
          </div>
          <div className="mt-1 flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#6b837a]">{selectedClass.name}</p>
              <h1 className="text-xl font-black">{displayTime(selectedClass.start_time)}–{displayTime(selectedClass.end_time)}</h1>
            </div>
            <span className="rounded-full bg-[#e8f1ec] px-3 py-1.5 text-xs font-extrabold text-[#28755d]">{checkedIds.size} mødt</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-xl px-4 pb-28 pt-4">
        <section className="rounded-3xl border border-[#dce2da] bg-white p-4 shadow-sm">
          <label className="text-sm font-bold text-[#6b837a]">Træningsdato</label>
          <input
            type="date"
            value={sessionDate}
            onChange={(event) => setSessionDate(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-[#ccd6d0] bg-white px-4 py-3 text-base font-extrabold outline-none focus:border-[#28755d]"
          />
          <p className="mt-2 capitalize text-sm text-[#6b837a]">{displayDate(sessionDate)}</p>
        </section>

        {error && <ErrorBox message={error} />}
        {trainingSession?.status === "aflyst" && <ErrorBox message="Denne træning er markeret som aflyst." />}

        <section className="mt-4 overflow-hidden rounded-3xl border border-[#dce2da] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#e8ece7] px-4 py-4">
            <div>
              <h2 className="text-lg font-black">Deltagere</h2>
              <p className="text-sm text-[#6b837a]">Tryk én gang for at krydse af</p>
            </div>
            <button onClick={() => setAddingPerson(true)} className="rounded-2xl bg-[#17342b] px-4 py-3 text-sm font-extrabold text-white">+ Ny</button>
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
                    disabled={checked || savingId === person.id || trainingSession?.status === "aflyst"}
                    className="flex min-h-20 w-full items-center gap-4 px-4 py-3 text-left disabled:cursor-default"
                  >
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-xl font-black ${checked ? "border-[#28755d] bg-[#28755d] text-white" : "border-[#bdc9c2] bg-white text-transparent"}`}>✓</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg font-black">{person.name}</span>
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

        <a href="/privatliv" className="mt-5 block text-center text-sm font-semibold text-[#6b837a] underline underline-offset-4">Sådan behandler vi personoplysninger</a>
      </div>

      {addingPerson && <AddPerson onClose={() => setAddingPerson(false)} onCreated={loadAttendancePage} />}
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
        <button disabled={busy} className="mt-5 w-full rounded-2xl bg-[#17342b] px-4 py-4 text-base font-extrabold text-white disabled:opacity-60">{busy ? "Logger ind…" : "Log ind"}</button>
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
      privacy_notice_given_at: new Date().toISOString(),
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
        <button disabled={!informed || busy} className="mt-4 w-full rounded-2xl bg-[#28755d] px-4 py-4 font-extrabold text-white disabled:opacity-40">{busy ? "Gemmer…" : "Gem deltager"}</button>
      </form>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <div className="mt-4 rounded-2xl bg-[#fee9e5] p-4 text-sm font-semibold text-[#8d342d]">{message}</div>;
}

function LoadingScreen() {
  return <main className="flex min-h-screen items-center justify-center bg-[#f3f5f0] font-bold text-[#6b837a]">Indlæser…</main>;
}
