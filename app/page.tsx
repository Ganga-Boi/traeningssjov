"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const supabase = getSupabaseBrowserClient();

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

type TrainingSession = { id: string; status: string };

const c = {
  bg: "#f4f6f2",
  card: "#ffffff",
  text: "#17342b",
  muted: "#6b837a",
  green: "#28755d",
  border: "#dce2da",
};

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
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addingGuest, setAddingGuest] = useState(false);
  const [selectedGuest, setSelectedGuest] = useState<Person | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { void loadClasses(); }, []);
  useEffect(() => { if (selectedClass) void loadPage(); }, [selectedClass, sessionDate]);

  async function loadClasses() {
    const { data, error } = await supabase
      .from("classes")
      .select("id,name,weekday,start_time,end_time")
      .eq("active", true)
      .order("weekday")
      .order("start_time");
    if (error) setError(error.message);
    else setClasses((data ?? []) as TrainingClass[]);
    setLoading(false);
  }

  async function loadPage() {
    if (!selectedClass) return;
    setError("");
    const [peopleResult, sessionResult] = await Promise.all([
      supabase.from("people").select("id,name,type,balance,created_at").order("created_at", { ascending: false }),
      supabase.from("sessions").select("id,status").eq("class_id", selectedClass.id).eq("session_date", sessionDate).maybeSingle(),
    ]);
    if (peopleResult.error) return setError(peopleResult.error.message);
    if (sessionResult.error) return setError(sessionResult.error.message);
    setPeople((peopleResult.data ?? []) as Person[]);
    const found = (sessionResult.data ?? null) as TrainingSession | null;
    setTrainingSession(found);
    if (!found) return setChecked(new Set());
    const attendance = await supabase.from("attendance").select("person_id").eq("session_id", found.id);
    if (attendance.error) return setError(attendance.error.message);
    setChecked(new Set((attendance.data ?? []).map((r) => r.person_id)));
  }

  async function ensureSession() {
    if (!selectedClass) return null;
    if (trainingSession) return trainingSession;
    const { data, error } = await supabase.rpc("get_or_create_session", {
      p_class_id: selectedClass.id,
      p_session_date: sessionDate,
    });
    if (error) { setError(error.message); return null; }
    const created = data as TrainingSession;
    setTrainingSession(created);
    return created;
  }

  async function checkIn(person: Person) {
    if (checked.has(person.id) || busyId) return;
    setBusyId(person.id);
    const session = await ensureSession();
    if (!session) return setBusyId(null);
    const type = person.type === "gæst" ? "prøvetime" : (person.balance ?? 0) > 0 ? "normal" : "kredit";
    const { error } = await supabase.rpc("register_attendance_for_session", {
      p_person_id: person.id,
      p_session_id: session.id,
      p_type: type,
    });
    setBusyId(null);
    if (error) return setError(error.message);
    await loadPage();
  }

  async function convertGuest(person: Person) {
    setBusyId(person.id);
    const { error } = await supabase.from("people").update({ type: "medlem", balance: 10, payment_status: "ok" }).eq("id", person.id);
    setBusyId(null);
    if (error) return setError(error.message);
    setSelectedGuest(null);
    await loadPage();
  }

  const sortedPeople = useMemo(() => [...people].sort((a, b) => {
    if (a.type !== b.type) return a.type === "gæst" ? -1 : 1;
    return a.name.localeCompare(b.name, "da");
  }), [people]);

  if (loading) return <main style={styles.center}>Indlæser…</main>;

  if (!selectedClass) {
    return (
      <main style={styles.page}>
        <div style={styles.shell}>
          <p style={styles.brand}>TRÆNINGSSJOV</p>
          <h1 style={styles.title}>Vælg hold</h1>
          {error && <div style={styles.error}>{error}</div>}
          <div style={{ display: "grid", gap: 12, marginTop: 24 }}>
            {classes.map((item) => (
              <button key={item.id} onClick={() => { setSelectedClass(item); setSessionDate(nearestDate(item.weekday)); }} style={styles.classCard}>
                <span><strong style={{ fontSize: 20 }}>{item.name}</strong><span style={styles.sub}>{time(item.start_time)}–{time(item.end_time)}</span></span>
                <span style={{ fontSize: 28, color: c.green }}>›</span>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <button onClick={() => setSelectedClass(null)} style={styles.back}>‹ Hold</button>
        <p style={styles.brand}>{selectedClass.name}</p>
        <h1 style={{ ...styles.title, marginBottom: 4 }}>{time(selectedClass.start_time)}–{time(selectedClass.end_time)}</h1>
        <input type="date" value={sessionDate} onChange={(e) => setSessionDate(e.target.value)} style={styles.dateInput} />
        {error && <div style={styles.error}>{error}</div>}

        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <strong style={{ fontSize: 20 }}>Deltagere</strong>
            <button onClick={() => setAddingGuest(true)} style={styles.primary}>+ Gæst</button>
          </div>
          {sortedPeople.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: c.muted }}>Ingen deltagere endnu.</div>
          ) : sortedPeople.map((person) => {
            const isChecked = checked.has(person.id);
            return (
              <div key={person.id} style={styles.personRow}>
                <button onClick={() => checkIn(person)} disabled={isChecked || busyId === person.id} style={{ ...styles.check, ...(isChecked ? styles.checked : {}) }}>✓</button>
                <button onClick={() => person.type === "gæst" && setSelectedGuest(person)} style={styles.personButton}>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <strong style={{ fontSize: 18 }}>{person.name}</strong>
                    {person.type === "gæst" && <span style={styles.badge}>Gæst</span>}
                  </span>
                  <span style={styles.sub}>{isChecked ? "Mødt op" : person.type === "gæst" ? "Tryk på navnet for at gøre til medlem" : `${person.balance} klip tilbage`}</span>
                </button>
              </div>
            );
          })}
        </section>
      </div>

      {addingGuest && <GuestModal onClose={() => setAddingGuest(false)} onCreated={loadPage} />}
      {selectedGuest && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <h2 style={{ marginTop: 0 }}>{selectedGuest.name}</h2>
            <p style={{ color: c.muted }}>Personen bliver medlem og får 10 klip.</p>
            <button onClick={() => convertGuest(selectedGuest)} style={{ ...styles.primary, width: "100%", padding: 14 }}>Gør til medlem</button>
            <button onClick={() => setSelectedGuest(null)} style={styles.cancel}>Annuller</button>
          </div>
        </div>
      )}
    </main>
  );
}

function GuestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const result = await supabase.from("people").insert({ name: name.trim(), type: "gæst", balance: null, payment_status: "skal_betale", privacy_notice_given_at: new Date().toISOString() });
    setBusy(false);
    if (result.error) return setError(result.error.message);
    await onCreated(); onClose();
  }
  return <div style={styles.overlay}><form onSubmit={submit} style={styles.modal}><h2 style={{ marginTop: 0 }}>Tilføj gæst</h2><input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Navn" style={styles.input} />{error && <div style={styles.error}>{error}</div>}<button disabled={busy} style={{ ...styles.primary, width: "100%", padding: 14 }}>{busy ? "Gemmer…" : "Gem gæst"}</button><button type="button" onClick={onClose} style={styles.cancel}>Annuller</button></form></div>;
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: c.bg, color: c.text, fontFamily: "Arial, sans-serif", padding: "24px 16px" },
  shell: { width: "100%", maxWidth: 620, margin: "0 auto" },
  center: { minHeight: "100vh", display: "grid", placeItems: "center", background: c.bg, color: c.muted, fontFamily: "Arial" },
  brand: { fontSize: 12, letterSpacing: 3, fontWeight: 800, color: c.muted, margin: 0 },
  title: { fontSize: 34, lineHeight: 1.1, margin: "8px 0 0", fontWeight: 800 },
  classCard: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: 20, borderRadius: 22, border: `1px solid ${c.border}`, background: c.card, color: c.text, textAlign: "left", boxShadow: "0 2px 5px rgba(0,0,0,.05)", cursor: "pointer" },
  sub: { display: "block", marginTop: 4, color: c.muted, fontSize: 14 },
  back: { border: 0, background: "transparent", color: c.green, fontWeight: 700, padding: "8px 0", cursor: "pointer" },
  dateInput: { width: "100%", marginTop: 16, padding: 14, borderRadius: 16, border: `1px solid ${c.border}`, background: c.card, fontSize: 16, boxSizing: "border-box" },
  card: { marginTop: 16, background: c.card, border: `1px solid ${c.border}`, borderRadius: 22, overflow: "hidden", boxShadow: "0 2px 5px rgba(0,0,0,.05)" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottom: `1px solid ${c.border}` },
  primary: { border: 0, borderRadius: 14, background: c.text, color: "white", fontWeight: 800, padding: "11px 16px", cursor: "pointer" },
  personRow: { display: "flex", alignItems: "center", gap: 12, minHeight: 76, padding: "10px 16px", borderBottom: `1px solid #edf0ec` },
  check: { width: 46, height: 46, borderRadius: "50%", border: `2px solid #bdc9c2`, background: "white", color: "transparent", fontSize: 20, fontWeight: 900, flexShrink: 0, cursor: "pointer" },
  checked: { background: c.green, borderColor: c.green, color: "white" },
  personButton: { border: 0, background: "transparent", color: c.text, textAlign: "left", flex: 1, padding: 0, cursor: "pointer" },
  badge: { background: "#fff0d8", color: "#8b5605", borderRadius: 999, padding: "4px 8px", fontSize: 12, fontWeight: 800 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 12, zIndex: 20 },
  modal: { width: "100%", maxWidth: 430, background: "white", borderRadius: 22, padding: 20, color: c.text, boxSizing: "border-box" },
  input: { width: "100%", boxSizing: "border-box", padding: 14, borderRadius: 14, border: `1px solid ${c.border}`, fontSize: 18, marginBottom: 14 },
  cancel: { width: "100%", border: 0, background: "transparent", color: c.muted, fontWeight: 700, padding: 14, cursor: "pointer" },
  error: { marginTop: 16, padding: 14, borderRadius: 14, background: "#fee9e5", color: "#8d342d", fontWeight: 700 },
};