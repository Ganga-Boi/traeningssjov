"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

type Person = {
  id: string;
  name: string;
  type: "gæst" | "medlem";
  balance: number | null;
  created_at: string;
};

type TrainingClass = {
  id: string;
  name: string;
  weekday: number;
  start_time: string;
  end_time: string;
};

type TrainingSession = { id: string; status: "planlagt" | "afholdt" | "aflyst" };
type Attendance = { person_id: string };

const supabase = getSupabaseBrowserClient();

function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nearestDate(weekday: number) {
  const today = new Date();
  const current = today.getDay() === 0 ? 7 : today.getDay();
  const result = new Date(today);
  result.setDate(today.getDate() + weekday - current);
  return dateValue(result);
}

function time(value: string) {
  return value.slice(0, 5).replace(":", ".");
}

export default function Home() {
  const [classes, setClasses] = useState<TrainingClass[]>([]);
  const [selectedClass, setSelectedClass] = useState<TrainingClass | null>(null);
  const [sessionDate, setSessionDate] = useState(dateValue(new Date()));
  const [trainingSession, setTrainingSession] = useState<TrainingSession | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [addingGuest, setAddingGuest] = useState(false);
  const [selectedGuest, setSelectedGuest] = useState<Person | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadClasses = useCallback(async () => {
    const { data, error: dbError } = await supabase
      .from("classes")
      .select("id,name,weekday,start_time,end_time")
      .eq("active", true)
      .order("weekday")
      .order("start_time");

    if (dbError) setError(dbError.message);
    else setClasses((data ?? []) as TrainingClass[]);
    setLoading(false);
  }, []);

  const loadList = useCallback(async () => {
    if (!selectedClass) return;
    setError("");

    const [peopleResult, sessionResult] = await Promise.all([
      supabase.from("people").select("id,name,type,balance,created_at"),
      supabase
        .from("sessions")
        .select("id,status")
        .eq("class_id", selectedClass.id)
        .eq("session_date", sessionDate)
        .maybeSingle(),
    ]);

    if (peopleResult.error) return setError(peopleResult.error.message);
    if (sessionResult.error) return setError(sessionResult.error.message);

    setPeople((peopleResult.data ?? []) as Person[]);
    const found = (sessionResult.data ?? null) as TrainingSession | null;
    setTrainingSession(found);

    if (!found) return setCheckedIds(new Set());

    const attendanceResult = await supabase
      .from("attendance")
      .select("person_id")
      .eq("session_id", found.id);

    if (attendanceResult.error) return setError(attendanceResult.error.message);
    setCheckedIds(new Set(((attendanceResult.data ?? []) as Attendance[]).map((row) => row.person_id)));
  }, [selectedClass, sessionDate]);

  useEffect(() => {
    void loadClasses();
  }, [loadClasses]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const sortedPeople = useMemo(
    () =>
      [...people].sort((a, b) => {
        if (a.type !== b.type) return a.type === "gæst" ? -1 : 1;
        return a.name.localeCompare(b.name, "da");
      }),
    [people],
  );

  async function ensureSession() {
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

  async function checkIn(person: Person) {
    if (checkedIds.has(person.id) || busyId) return;
    setBusyId(person.id);

    const activeSession = await ensureSession();
    if (!activeSession) return setBusyId(null);

    const type = person.type === "gæst" ? "prøvetime" : (person.balance ?? 0) > 0 ? "normal" : "kredit";
    const { error: rpcError } = await supabase.rpc("register_attendance_for_session", {
      p_person_id: person.id,
      p_session_id: activeSession.id,
      p_type: type,
    });

    setBusyId(null);
    if (rpcError) return setError(rpcError.message);
    await loadList();
  }

  async function convertGuest() {
    if (!selectedGuest) return;
    setBusyId(selectedGuest.id);

    const { error: updateError } = await supabase
      .from("people")
      .update({ type: "medlem", balance: 10, payment_status: "ok" })
      .eq("id", selectedGuest.id);

    setBusyId(null);
    if (updateError) return setError(updateError.message);
    setSelectedGuest(null);
    await loadList();
  }

  if (loading) return <main className="app-shell"><div className="empty-state">Indlæser…</div></main>;

  if (!selectedClass) {
    return (
      <main className="app-shell">
        <section className="app-card">
          <p className="eyebrow">Træningssjov</p>
          <h1>Vælg hold</h1>
          {error && <div className="error-box">{error}</div>}
          <div className="class-list">
            {classes.map((item) => (
              <button
                key={item.id}
                className="class-button"
                onClick={() => {
                  setSelectedClass(item);
                  setSessionDate(nearestDate(item.weekday));
                }}
              >
                <span><strong>{item.name}</strong><small>{time(item.start_time)}–{time(item.end_time)}</small></span>
                <span className="chevron">›</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="app-card">
        <div className="top-row">
          <button className="back-button" onClick={() => setSelectedClass(null)}>‹ Hold</button>
          <span className="count-pill">{checkedIds.size} mødt</span>
        </div>

        <p className="eyebrow">{selectedClass.name}</p>
        <h1>{time(selectedClass.start_time)}–{time(selectedClass.end_time)}</h1>

        <input className="date-input" type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} />
        {error && <div className="error-box">{error}</div>}

        <div className="list-header">
          <h2>Deltagere</h2>
          <button className="primary-button" onClick={() => setAddingGuest(true)}>+ Gæst</button>
        </div>

        <div className="people-list">
          {sortedPeople.length === 0 ? (
            <div className="empty-state">Ingen deltagere endnu.</div>
          ) : (
            sortedPeople.map((person) => {
              const checked = checkedIds.has(person.id);
              return (
                <div className="person-row" key={person.id}>
                  <button className={`check-button ${checked ? "checked" : ""}`} onClick={() => checkIn(person)} disabled={checked || busyId === person.id}>✓</button>
                  <button className="person-main" onClick={() => person.type === "gæst" && setSelectedGuest(person)}>
                    <strong>{person.name}</strong>
                    <small>{person.type === "gæst" ? "Gæstedeltager" : `${person.balance ?? 0} klip tilbage`}</small>
                  </button>
                  {person.type === "gæst" && <span className="guest-badge">Gæst</span>}
                </div>
              );
            })
          )}
        </div>
      </section>

      {addingGuest && <GuestDialog onClose={() => setAddingGuest(false)} onCreated={loadList} />}

      {selectedGuest && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h2>{selectedGuest.name}</h2>
            <p>Gør gæsten til almindelig deltager med 10 klip.</p>
            <button className="primary-button full" onClick={convertGuest} disabled={busyId === selectedGuest.id}>Gør til deltager</button>
            <button className="secondary-button full" onClick={() => setSelectedGuest(null)}>Annuller</button>
          </div>
        </div>
      )}
    </main>
  );
}

function GuestDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error: insertError } = await supabase.from("people").insert({
      name: name.trim(),
      type: "gæst",
      balance: null,
      payment_status: "skal_betale",
      privacy_notice_given_at: new Date().toISOString(),
    });
    setBusy(false);
    if (insertError) return setError(insertError.message);
    await onCreated();
    onClose();
  }

  return (
    <div className="modal-backdrop">
      <form className="modal-card" onSubmit={submit}>
        <h2>Tilføj gæst</h2>
        <input className="text-input" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Navn" />
        {error && <div className="error-box">{error}</div>}
        <button className="primary-button full" disabled={busy}>{busy ? "Gemmer…" : "Gem gæst"}</button>
        <button className="secondary-button full" type="button" onClick={onClose}>Annuller</button>
      </form>
    </div>
  );
}
