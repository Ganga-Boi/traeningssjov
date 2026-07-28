"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const supabase = getSupabaseBrowserClient();

type Person = {
  id: string;
  name: string;
  type: "gæst" | "medlem";
  balance: number | null;
  payment_status: "ok" | "skal_betale" | "blokeret";
};

type TrainingClass = {
  id: string;
  name: string;
  weekday: number;
  start_time: string;
  end_time: string;
};

type TrainingSession = { id: string; status: string };

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function mondayDate() {
  const today = new Date();
  const day = today.getDay() === 0 ? 7 : today.getDay();
  const result = new Date(today);
  result.setDate(today.getDate() + 1 - day);
  return localDate(result);
}

function moveDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

function time(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(":");
  return minutes === "00" ? String(Number(hours)) : `${Number(hours)}.${minutes}`;
}

function weekday(value: string) {
  const text = new Intl.DateTimeFormat("da-DK", { weekday: "long" }).format(new Date(`${value}T12:00:00`));
  return text[0].toUpperCase() + text.slice(1);
}

function status(person: Person) {
  if (person.type === "gæst") return "Gæst";
  if (person.balance === -1 || person.payment_status === "blokeret") return "Kredit";
  if ((person.balance ?? 0) === 0) return "0 klip · betal";
  return `${person.balance} klip`;
}

function normalizedName(value: string) {
  return value.trim().toLocaleLowerCase("da-DK");
}

function preferredPerson(existing: Person, candidate: Person) {
  if (existing.type !== candidate.type) return existing.type === "medlem" ? existing : candidate;
  if (existing.payment_status !== candidate.payment_status) {
    if (existing.payment_status === "blokeret") return existing;
    if (candidate.payment_status === "blokeret") return candidate;
  }
  return (candidate.balance ?? -2) > (existing.balance ?? -2) ? candidate : existing;
}

function uniquePeople(items: Person[]) {
  const byName = new Map<string, Person>();
  for (const person of items) {
    const key = normalizedName(person.name);
    const existing = byName.get(key);
    byName.set(key, existing ? preferredPerson(existing, person) : person);
  }
  return [...byName.values()];
}

export default function Home() {
  const [classes, setClasses] = useState<TrainingClass[]>([]);
  const [classIndex, setClassIndex] = useState(0);
  const [sessionDate, setSessionDate] = useState(mondayDate());
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [addingGuest, setAddingGuest] = useState(false);
  const [paymentPerson, setPaymentPerson] = useState<Person | null>(null);

  const selectedClass = classes[classIndex] ?? null;

  const loadClasses = useCallback(async () => {
    const result = await supabase
      .from("classes")
      .select("id,name,weekday,start_time,end_time")
      .eq("active", true)
      .order("weekday")
      .order("start_time");

    if (result.error) setError(result.error.message);
    else setClasses((result.data ?? []) as TrainingClass[]);
    setLoading(false);
  }, []);

  const loadPage = useCallback(async () => {
    if (!selectedClass) return;
    setError("");

    const [peopleResult, sessionResult] = await Promise.all([
      supabase.from("people").select("id,name,type,balance,payment_status").order("name"),
      supabase
        .from("sessions")
        .select("id,status")
        .eq("class_id", selectedClass.id)
        .eq("session_date", sessionDate)
        .maybeSingle(),
    ]);

    if (peopleResult.error) return setError(peopleResult.error.message);
    if (sessionResult.error) return setError(sessionResult.error.message);

    setPeople(uniquePeople((peopleResult.data ?? []) as Person[]));
    const found = (sessionResult.data ?? null) as TrainingSession | null;
    setSession(found);

    if (!found) {
      setChecked(new Set());
      return;
    }

    const attendance = await supabase
      .from("attendance")
      .select("person_id")
      .eq("session_id", found.id);

    if (attendance.error) return setError(attendance.error.message);
    setChecked(new Set((attendance.data ?? []).map((row) => row.person_id)));
  }, [selectedClass, sessionDate]);

  useEffect(() => { void loadClasses(); }, [loadClasses]);
  useEffect(() => { void loadPage(); }, [loadPage]);

  const sortedPeople = useMemo(() => [...people].sort((a, b) => {
    if (a.type !== b.type) return a.type === "gæst" ? -1 : 1;
    const aBalance = a.balance ?? -2;
    const bBalance = b.balance ?? -2;
    return bBalance - aBalance || a.name.localeCompare(b.name, "da");
  }), [people]);

  async function ensureSession() {
    if (session) return session;
    if (!selectedClass) return null;

    const result = await supabase.rpc("get_or_create_session", {
      p_class_id: selectedClass.id,
      p_session_date: sessionDate,
    });

    if (result.error) {
      setError(result.error.message);
      return null;
    }

    const created = result.data as TrainingSession;
    setSession(created);
    return created;
  }

  async function toggle(person: Person) {
    if (busyId) return;

    if (person.type === "medlem" && (person.balance ?? 0) <= 0) {
      setPaymentPerson(person);
      return;
    }

    setBusyId(person.id);
    setError("");

    const activeSession = await ensureSession();
    if (!activeSession) {
      setBusyId(null);
      return;
    }

    const wasChecked = checked.has(person.id);
    const result = wasChecked
      ? await supabase.rpc("undo_attendance_for_session", {
          p_person_id: person.id,
          p_session_id: activeSession.id,
        })
      : await supabase.rpc("register_attendance_for_session", {
          p_person_id: person.id,
          p_session_id: activeSession.id,
          p_type: person.type === "gæst" ? "prøvetime" : "normal",
        });

    setBusyId(null);
    if (result.error) return setError(result.error.message);

    await loadPage();

    if (!wasChecked && person.type === "medlem" && person.balance === 1) {
      setPaymentPerson({ ...person, balance: 0, payment_status: "skal_betale" });
    }
  }

  async function registerPayment(person: Person) {
    setBusyId(person.id);
    setError("");

    const result = await supabase.rpc("purchase_clips", {
      p_person_id: person.id,
      p_clips: 10,
      p_note: "Betaling registreret af Randi",
    });

    setBusyId(null);
    if (result.error) {
      setError(result.error.message);
      return false;
    }

    setPaymentPerson(null);
    await loadPage();
    return true;
  }

  function changeTraining(direction: -1 | 1) {
    if (!selectedClass || classes.length === 0) return;

    const nextIndex = (classIndex + direction + classes.length) % classes.length;
    const nextClass = classes[nextIndex];

    let delta: number;
    if (direction === 1) {
      delta = (nextClass.weekday - selectedClass.weekday + 7) % 7;
      if (delta === 0 && nextIndex <= classIndex) delta = 7;
    } else {
      delta = -((selectedClass.weekday - nextClass.weekday + 7) % 7);
      if (delta === 0 && nextIndex >= classIndex) delta = -7;
    }

    setClassIndex(nextIndex);
    setSessionDate(moveDate(sessionDate, delta));
    setSession(null);
    setChecked(new Set());
    setError("");
  }

  async function addGuest(name: string) {
    const clean = name.trim();
    if (!clean) return "Navn mangler";
    if (people.some((person) => normalizedName(person.name) === normalizedName(clean))) {
      return "Personen står allerede på listen";
    }

    const result = await supabase.from("people").insert({
      name: clean,
      type: "gæst",
      balance: null,
      payment_status: "skal_betale",
      privacy_notice_given_at: new Date().toISOString(),
    });

    if (result.error) return result.error.message;
    await loadPage();
    return null;
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-[#f4f5f1]">Indlæser…</main>;
  }

  if (!selectedClass) {
    return <main className="min-h-screen bg-[#f4f5f1] p-6">Ingen træningshold fundet.</main>;
  }

  return (
    <main className="min-h-screen bg-[#f4f5f1] px-3 py-5 text-[#18322b] sm:px-5 sm:py-8">
      <div className="mx-auto max-w-xl">
        <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl border border-[#d9e0da] bg-white p-4 shadow-sm">
          <button onClick={() => changeTraining(-1)} className="min-h-12 justify-self-start text-sm font-bold text-[#28755d]">← Forrige</button>
          <div className="text-center">
            <h1 className="whitespace-nowrap text-xl font-black">
              {weekday(sessionDate)} {time(selectedClass.start_time)}–{time(selectedClass.end_time)}
            </h1>
            <p className="mt-1 text-sm font-semibold text-[#60756d]">{displayDate(sessionDate)}</p>
          </div>
          <button onClick={() => changeTraining(1)} className="min-h-12 justify-self-end text-sm font-bold text-[#28755d]">Næste →</button>
        </nav>

        {error && <div className="mt-4 rounded-xl bg-[#fee9e5] p-4 text-sm font-semibold text-[#8d342d]">{error}</div>}

        <button onClick={() => setAddingGuest(true)} className="mt-5 min-h-12 px-2 text-base font-black text-[#28755d]">+ Gæst</button>

        <section className="mt-2 overflow-hidden rounded-2xl border border-[#d9e0da] bg-white shadow-sm">
          {sortedPeople.map((person) => {
            const isChecked = checked.has(person.id);
            const blocked = person.type === "medlem" && (person.balance ?? 0) <= 0;

            return (
              <button
                key={person.id}
                onClick={() => void toggle(person)}
                disabled={Boolean(busyId)}
                className={`grid min-h-16 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#e8ece8] px-4 py-3 text-left ${blocked ? "bg-[#fff1ef]" : isChecked ? "bg-[#eef1ee]" : "bg-white"}`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-md border-2 text-base font-black ${isChecked ? "border-[#28755d] bg-[#28755d] text-white" : blocked ? "border-[#d0a155] bg-[#fff4df] text-[#8b5605]" : "border-[#aebdb5] text-transparent"}`}>{blocked ? "!" : "✓"}</span>
                <span className="truncate text-lg font-bold">{person.name}</span>
                <span className={`whitespace-nowrap text-base font-bold ${blocked ? "text-[#b42318]" : person.balance === 1 ? "text-[#c27600]" : "text-[#28755d]"}`}>{busyId === person.id ? "…" : status(person)}</span>
              </button>
            );
          })}
        </section>
      </div>

      {addingGuest && <GuestDialog onClose={() => setAddingGuest(false)} onSave={addGuest} />}
      {paymentPerson && (
        <PaymentDialog
          person={paymentPerson}
          busy={busyId === paymentPerson.id}
          onClose={() => setPaymentPerson(null)}
          onConfirm={registerPayment}
        />
      )}
    </main>
  );
}

function GuestDialog({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => Promise<string | null> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await onSave(name);
    setBusy(false);
    if (result) return setError(result);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/35 p-3 sm:items-center sm:justify-center">
      <form onSubmit={submit} className="w-full rounded-2xl bg-white p-5 text-[#18322b] shadow-xl sm:max-w-sm">
        <h2 className="text-xl font-black">Tilføj gæst</h2>
        <input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="Navn" className="mt-4 min-h-14 w-full rounded-xl border border-[#bcc9c2] px-4 text-lg" />
        {error && <p className="mt-3 text-sm font-semibold text-[#8d342d]">{error}</p>}
        <button disabled={busy} className="mt-4 min-h-14 w-full rounded-xl bg-[#28755d] font-black text-white">{busy ? "Gemmer…" : "Tilføj"}</button>
        <button type="button" onClick={onClose} className="mt-2 min-h-12 w-full font-bold text-[#60756d]">Annuller</button>
      </form>
    </div>
  );
}

function PaymentDialog({ person, busy, onClose, onConfirm }: { person: Person; busy: boolean; onClose: () => void; onConfirm: (person: Person) => Promise<boolean> }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/35 p-3 sm:items-center sm:justify-center">
      <div className="w-full rounded-2xl bg-white p-5 text-[#18322b] shadow-xl sm:max-w-sm">
        <h2 className="text-xl font-black">{person.name}</h2>
        <p className="mt-3 text-base font-bold text-[#b42318]">0 klip · betaling mangler</p>
        <p className="mt-2 text-sm text-[#60756d]">Har personen betalt 375 kr.?</p>
        <button type="button" disabled={busy} onClick={() => void onConfirm(person)} className="mt-4 min-h-14 w-full rounded-xl bg-[#28755d] px-4 font-black text-white disabled:opacity-50">{busy ? "Gemmer…" : "Registrér betaling"}</button>
        <button type="button" disabled={busy} onClick={onClose} className="mt-2 min-h-12 w-full font-bold text-[#60756d]">Luk</button>
      </div>
    </div>
  );
}
