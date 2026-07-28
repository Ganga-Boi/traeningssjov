"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const supabase = getSupabaseBrowserClient();

// Skrivehandlinger, der er beskyttet af RLS, køres gennem sikre databasefunktioner.
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

type SnapshotRow = {
  person_id: string;
  name: string;
  person_type: "gæst" | "medlem";
  payment_status: "ok" | "skal_betale" | "blokeret";
  clip_count: number | null;
  attended: boolean;
};

type NextTraining = {
  index: number;
  date: string;
  startsAt: number;
};

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function nextTraining(classes: TrainingClass[]): NextTraining | null {
  const now = new Date();
  let best: NextTraining | null = null;

  for (let index = 0; index < classes.length; index += 1) {
    const trainingClass = classes[index];
    const currentWeekday = now.getDay() === 0 ? 7 : now.getDay();
    let distance = (trainingClass.weekday - currentWeekday + 7) % 7;
    const [hours, minutes] = trainingClass.start_time.slice(0, 5).split(":").map(Number);
    const date = new Date(now);
    date.setDate(now.getDate() + distance);
    date.setHours(hours, minutes, 0, 0);

    if (date <= now) {
      distance += 7;
      date.setDate(date.getDate() + 7);
    }

    if (
      best === null ||
      date.getTime() < best.startsAt
    ) {
      best = { index, date: localDate(date), startsAt: date.getTime() };
    }
  }

  return best;
}

export default function Home() {
  const [classes, setClasses] = useState<TrainingClass[]>([]);
  const [classIndex, setClassIndex] = useState(0);
  const [sessionDate, setSessionDate] = useState(localDate(new Date()));
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [addingGuest, setAddingGuest] = useState(false);
  const [paymentPerson, setPaymentPerson] = useState<Person | null>(null);
  const loadRequest = useRef(0);

  const selectedClass = classes[classIndex] ?? null;
  const todayDate = localDate(new Date());
  const isPast = sessionDate < todayDate;
  const isEditable = !isPast;

  const loadClasses = useCallback(async () => {
    const result = await supabase
      .from("classes")
      .select("id,name,weekday,start_time,end_time")
      .eq("active", true)
      .order("weekday")
      .order("start_time");

    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }

    const loaded = (result.data ?? []) as TrainingClass[];
    setClasses(loaded);

    const start = nextTraining(loaded);
    if (start !== null) {
      setClassIndex(start.index);
      setSessionDate(start.date);
    }

    setLoading(false);
  }, []);

  const loadPage = useCallback(async () => {
    if (!selectedClass) return;
    const requestId = ++loadRequest.current;
    setError("");

    const [snapshotResult, sessionResult, balancesResult] = await Promise.all([
      supabase.rpc("get_class_roster_snapshot", {
        p_class_id: selectedClass.id,
        p_snapshot_date: sessionDate,
      }),
      supabase
        .from("sessions")
        .select("id,status")
        .eq("class_id", selectedClass.id)
        .eq("session_date", sessionDate)
        .maybeSingle(),
      supabase
        .from("people")
        .select("id,balance"),
    ]);

    if (snapshotResult.error) return setError(snapshotResult.error.message);
    if (sessionResult.error) return setError(sessionResult.error.message);
    if (balancesResult.error) return setError(balancesResult.error.message);

    const loadedSession = (sessionResult.data ?? null) as TrainingSession | null;
    const attendanceResult = loadedSession
      ? await supabase
          .from("attendance")
          .select("person_id")
          .eq("session_id", loadedSession.id)
      : { data: [], error: null };

    if (attendanceResult.error) return setError(attendanceResult.error.message);
    if (requestId !== loadRequest.current) return;

    const rows = (snapshotResult.data ?? []) as SnapshotRow[];
    const currentBalances = new Map(
      (balancesResult.data ?? []).map((person) => [person.id, person.balance as number | null]),
    );
    setPeople(rows.map((row) => ({
      id: row.person_id,
      name: row.name,
      type: row.person_type,
      balance: isPast
        ? row.clip_count
        : (currentBalances.get(row.person_id) ?? row.clip_count),
      payment_status: row.payment_status,
    })));
    setChecked(new Set((attendanceResult.data ?? []).map((row) => row.person_id)));
    setSession(loadedSession);
  }, [isPast, selectedClass, sessionDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadClasses(), 0);
    return () => window.clearTimeout(timer);
  }, [loadClasses]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPage(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPage]);

  const sortedPeople = useMemo(() => [...people].sort((a, b) => {
    if (a.type !== b.type) return a.type === "gæst" ? -1 : 1;
    return a.name.localeCompare(b.name, "da");
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
    if (busyId || !isEditable) return;

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
    if (result.error) {
      if (result.error.message.includes("PAYMENT_REQUIRED")) {
        setPaymentPerson(person);
        return;
      }
      return setError(result.error.message);
    }

    await loadPage();

    if (!wasChecked && person.type === "medlem" && person.balance === 1) {
      setPaymentPerson({ ...person, balance: 0, payment_status: "skal_betale" });
    }
  }

  async function registerPayment(person: Person) {
    setBusyId(person.id);
    setError("");

    const result = await supabase.rpc("register_payment", {
      p_person_id: person.id,
      p_amount_ore: 37500,
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
    setError("");
  }

  async function addGuest(name: string) {
    if (!selectedClass) return "Intet hold valgt";
    const clean = name.trim();
    if (!clean) return "Navn mangler";

    const existing = await supabase
      .from("people")
      .select("id")
      .ilike("name", clean)
      .maybeSingle();

    if (existing.error) return existing.error.message;

    let personId = existing.data?.id as string | undefined;
    if (!personId) {
      const activeSession = await ensureSession();
      if (!activeSession) return "Træningen kunne ikke oprettes";

      const personResult = await supabase.rpc("create_guest_for_session", {
        p_name: clean,
        p_session_id: activeSession.id,
      });

      if (personResult.error) return personResult.error.message;
      personId = personResult.data.id;
    }

    const membershipResult = await supabase.from("class_memberships").upsert({
      class_id: selectedClass.id,
      person_id: personId,
      active: true,
    });

    if (membershipResult.error) return membershipResult.error.message;
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
            <h1 className="whitespace-nowrap text-xl font-black">{weekday(sessionDate)} {time(selectedClass.start_time)}–{time(selectedClass.end_time)}</h1>
            <p className="mt-1 text-sm font-semibold text-[#60756d]">{displayDate(sessionDate)}</p>
          </div>
          <button onClick={() => changeTraining(1)} className="min-h-12 justify-self-end text-sm font-bold text-[#28755d]">Næste →</button>
        </nav>

        {isPast && <p className="mt-3 text-center text-sm font-semibold text-[#60756d]">Historik · kun visning</p>}
        {error && <div className="mt-4 rounded-xl bg-[#fee9e5] p-4 text-sm font-semibold text-[#8d342d]">{error}</div>}

        {isEditable && (
          <button
            onClick={() => setAddingGuest(true)}
            className="mt-5 inline-flex min-h-12 items-center rounded-xl border border-[#b8cec4] bg-white px-4 text-base font-black text-[#28755d] shadow-sm transition hover:bg-[#eef6f2] active:scale-[0.98]"
          >
            <span className="mr-2 text-xl leading-none">+</span>
            Tilføj gæst
          </button>
        )}

        <section className="mt-2 overflow-hidden rounded-2xl border border-[#d9e0da] bg-white shadow-sm">
          {sortedPeople.map((person) => {
            const isChecked = checked.has(person.id);
            const blocked = person.type === "medlem" && (person.balance ?? 0) <= 0;

            return (
              <button
                key={person.id}
                onClick={() => void toggle(person)}
                disabled={Boolean(busyId) || !isEditable}
                className={`grid min-h-16 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#e8ece8] px-4 py-3 text-left ${blocked ? "bg-[#fff1ef]" : isChecked ? "bg-[#eef1ee]" : "bg-white"}`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-md border-2 text-base font-black ${isChecked ? "border-[#28755d] bg-[#28755d] text-white" : blocked ? "border-[#d0a155] bg-[#fff4df] text-[#8b5605]" : "border-[#aebdb5] text-transparent"}`}>{blocked ? "!" : "✓"}</span>
                <span className="truncate text-lg font-bold">{person.name}</span>
                <span className={`whitespace-nowrap text-base font-bold ${blocked ? "text-[#b42318]" : person.balance === 1 ? "text-[#c27600]" : "text-[#28755d]"}`}>{busyId === person.id ? "…" : status(person)}</span>
              </button>
            );
          })}
          {sortedPeople.length === 0 && <p className="p-6 text-center text-sm font-semibold text-[#60756d]">Ingen deltagere på dette hold endnu.</p>}
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
