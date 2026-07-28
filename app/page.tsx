"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const supabase = getSupabaseBrowserClient();

type TrainingClass = {
  id: string;
  name: string;
  weekday: number;
  start_time: string;
  end_time: string;
};

type TrainingSession = { id: string; status: string };

type SnapshotPerson = {
  person_id: string;
  name: string;
  person_type: "medlem" | "gæst";
  clip_count_on_date: number | null;
  transaction_type: "check_in" | "payment" | "manual_adjustment" | null;
  transaction_note: string | null;
  attended: boolean;
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

function weekday(value: string) {
  const text = new Intl.DateTimeFormat("da-DK", { weekday: "long" }).format(
    new Date(`${value}T12:00:00`),
  );
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function compactTime(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(":");
  return minutes === "00" ? String(Number(hours)) : `${Number(hours)}.${minutes}`;
}

function isoWeek(value: string) {
  const date = new Date(`${value}T12:00:00`);
  const target = new Date(date);
  target.setDate(target.getDate() + 4 - (target.getDay() || 7));
  const yearStart = new Date(target.getFullYear(), 0, 1);
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function clipLabel(person: SnapshotPerson) {
  if (person.person_type === "gæst") return "Gæst";
  const clips = person.clip_count_on_date ?? 0;
  if (clips <= 0) return "0 klip · betaling";
  return `${clips} klip`;
}

function clipTone(person: SnapshotPerson) {
  if (person.person_type === "gæst") return "text-[#526960]";
  const clips = person.clip_count_on_date ?? 0;
  if (clips <= 0) return "text-[#b42318]";
  if (clips === 1) return "text-[#a15c00]";
  return "text-[#28755d]";
}

export default function Home() {
  const [classes, setClasses] = useState<TrainingClass[]>([]);
  const [classIndex, setClassIndex] = useState(0);
  const [selectedDate, setSelectedDate] = useState(localDate(new Date()));
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [people, setPeople] = useState<SnapshotPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [addingGuest, setAddingGuest] = useState(false);

  const selectedClass = classes[classIndex] ?? null;
  const today = localDate(new Date());
  const readOnly = selectedDate !== today;

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
    setPageLoading(true);
    setError("");

    const [snapshotResult, sessionResult] = await Promise.all([
      supabase.rpc("get_clip_snapshot", {
        p_snapshot_date: selectedDate,
        p_class_id: selectedClass.id,
      }),
      supabase
        .from("sessions")
        .select("id,status")
        .eq("class_id", selectedClass.id)
        .eq("session_date", selectedDate)
        .maybeSingle(),
    ]);

    if (snapshotResult.error) setError(snapshotResult.error.message);
    else setPeople((snapshotResult.data ?? []) as SnapshotPerson[]);

    if (sessionResult.error) setError(sessionResult.error.message);
    else setSession((sessionResult.data ?? null) as TrainingSession | null);

    setPageLoading(false);
  }, [selectedClass, selectedDate]);

  useEffect(() => { void loadClasses(); }, [loadClasses]);
  useEffect(() => { void loadPage(); }, [loadPage]);

  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => {
      if (a.person_type !== b.person_type) return a.person_type === "gæst" ? -1 : 1;
      return a.name.localeCompare(b.name, "da");
    }),
    [people],
  );

  async function ensureSession() {
    if (session) return session;
    if (!selectedClass) return null;

    const result = await supabase.rpc("get_or_create_session", {
      p_class_id: selectedClass.id,
      p_session_date: selectedDate,
    });

    if (result.error) {
      setError(result.error.message);
      return null;
    }

    const created = result.data as TrainingSession;
    setSession(created);
    return created;
  }

  async function checkIn(person: SnapshotPerson) {
    if (readOnly || busyId || person.attended) return;
    if (person.person_type === "medlem" && (person.clip_count_on_date ?? 0) <= 0) return;

    setBusyId(person.person_id);
    setError("");
    const activeSession = await ensureSession();

    if (!activeSession) {
      setBusyId(null);
      return;
    }

    const result = await supabase.rpc("register_clip_checkin", {
      p_person_id: person.person_id,
      p_session_id: activeSession.id,
    });

    setBusyId(null);
    if (result.error) setError(result.error.message);
    else await loadPage();
  }

  async function buyClips(person: SnapshotPerson) {
    if (readOnly || busyId) return;
    setBusyId(person.person_id);
    setError("");

    const result = await supabase.rpc("purchase_clips", {
      p_person_id: person.person_id,
      p_clips: 10,
      p_note: "Købte 10 klip",
    });

    setBusyId(null);
    if (result.error) setError(result.error.message);
    else await loadPage();
  }

  function changeClass(direction: -1 | 1) {
    if (!selectedClass || classes.length === 0) return;
    setClassIndex((classIndex + direction + classes.length) % classes.length);
    setSession(null);
    setError("");
  }

  async function addGuest(name: string) {
    if (readOnly) return "Gæster kan kun tilføjes på dags dato.";
    const clean = name.trim();
    if (!clean) return "Navn mangler";

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

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-[#f4f5f1]">Indlæser…</main>;
  if (!selectedClass) return <main className="min-h-screen bg-[#f4f5f1] p-6">Ingen træningshold fundet.</main>;

  return (
    <main className="min-h-screen bg-[#f4f5f1] px-3 py-5 text-[#18322b] sm:px-5 sm:py-8">
      <div className="mx-auto max-w-xl">
        <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <button onClick={() => changeClass(-1)} className="min-h-12 justify-self-start text-sm font-bold text-[#28755d]">← Forrige hold</button>
          <h1 className="whitespace-nowrap text-center text-xl font-black">
            {weekday(selectedDate)} {compactTime(selectedClass.start_time)}–{compactTime(selectedClass.end_time)}
          </h1>
          <button onClick={() => changeClass(1)} className="min-h-12 justify-self-end text-sm font-bold text-[#28755d]">Næste hold →</button>
        </nav>

        <div className="mt-4 grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-[#d9e0da] bg-white p-3 shadow-sm">
          <button onClick={() => setSelectedDate(moveDate(selectedDate, -1))} className="h-11 w-11 rounded-xl text-2xl font-black text-[#28755d]">←</button>
          <div className="text-center">
            <div className="font-black">{weekday(selectedDate)} {displayDate(selectedDate)}</div>
            <div className="text-sm font-semibold text-[#60756d]">Uge {isoWeek(selectedDate)}</div>
          </div>
          <button onClick={() => setSelectedDate(moveDate(selectedDate, 1))} className="h-11 w-11 rounded-xl text-2xl font-black text-[#28755d]">→</button>
        </div>

        {readOnly && (
          <div className="mt-3 rounded-xl bg-[#eef1ee] p-3 text-sm font-bold text-[#526960]">
            Historisk visning · kan ikke ændres
          </div>
        )}

        {error && <div className="mt-4 rounded-xl bg-[#fee9e5] p-4 text-sm font-semibold text-[#8d342d]">{error}</div>}

        {!readOnly && (
          <button onClick={() => setAddingGuest(true)} className="mt-5 min-h-12 px-2 text-base font-black text-[#28755d]">+ Gæst</button>
        )}

        <section className={`mt-2 overflow-hidden rounded-2xl border border-[#d9e0da] bg-white shadow-sm ${pageLoading ? "opacity-55" : ""}`}>
          {sortedPeople.map((person) => {
            const clips = person.clip_count_on_date ?? 0;
            const canBuy = !readOnly && person.person_type === "medlem" && clips <= 0;
            return (
              <div key={person.person_id} className={`grid min-h-20 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#e8ece8] px-4 py-3 ${person.attended ? "bg-[#eef1ee] opacity-55" : "bg-white"}`}>
                <button
                  onClick={() => void checkIn(person)}
                  disabled={readOnly || Boolean(busyId) || person.attended || canBuy}
                  className={`flex h-7 w-7 items-center justify-center rounded-md border-2 text-base font-black ${person.attended ? "border-[#28755d] bg-[#28755d] text-white" : canBuy ? "border-[#d0a155] bg-[#fff4df] text-[#8b5605]" : "border-[#aebdb5] text-transparent"}`}
                >
                  {canBuy ? "!" : "✓"}
                </button>

                <div className="min-w-0">
                  <div className="truncate text-lg font-bold">{person.name}</div>
                  {person.transaction_type === "payment" && person.transaction_note && (
                    <div className="text-sm font-semibold text-[#28755d]">{person.transaction_note}</div>
                  )}
                </div>

                <div className="text-right">
                  <div className={`whitespace-nowrap text-base font-black ${clipTone(person)}`}>
                    {busyId === person.person_id ? "…" : clipLabel(person)}
                  </div>
                  {canBuy && (
                    <button onClick={() => void buyClips(person)} className="mt-1 rounded-lg bg-[#28755d] px-3 py-2 text-sm font-black text-white">
                      Køb 10 klip
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      </div>

      {addingGuest && <GuestDialog onClose={() => setAddingGuest(false)} onSave={addGuest} />}
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
