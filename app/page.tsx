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
  payment_status: "ok" | "skal_betale";
};

type TrainingClass = {
  id: string;
  name: string;
  weekday: number;
  start_time: string;
  end_time: string;
};

type TrainingSession = { id: string; status: string };

type InactiveMember = {
  person_id: string;
  name: string;
  balance: number;
};

type GuestConversion = {
  payment_id: string;
  person_id: string;
  name: string;
  paid_at: string;
};

type SnapshotRow = {
  person_id: string;
  name: string;
  person_type: "gæst" | "medlem";
  payment_status: "ok" | "skal_betale";
  clip_count: number | null;
  attended: boolean;
};

type AttendanceRow = {
  person_id: string;
  session_id: string;
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
  if (person.balance === null) return "—";
  if ((person.balance ?? 0) === 0) return "0 klip · betal";
  return `${person.balance} klip`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [addingGuest, setAddingGuest] = useState(false);
  const [paymentPerson, setPaymentPerson] = useState<Person | null>(null);
  const [showMemberAdmin, setShowMemberAdmin] = useState(false);
  const [inactiveMembers, setInactiveMembers] = useState<InactiveMember[]>([]);
  const [guestConversions, setGuestConversions] = useState<GuestConversion[]>([]);
  const [deactivatePerson, setDeactivatePerson] = useState<Person | null>(null);
  const [conversionToUndo, setConversionToUndo] = useState<GuestConversion | null>(null);
  const [resetWarningOpen, setResetWarningOpen] = useState(false);
  const [cancellationAction, setCancellationAction] = useState<"cancel" | "restore" | null>(null);
  const [correctionWarningOpen, setCorrectionWarningOpen] = useState(false);
  const [correctionMode, setCorrectionMode] = useState(false);
  const [correctionPerson, setCorrectionPerson] = useState<Person | null>(null);
  const loadRequest = useRef(0);
  const attendanceToggleInFlight = useRef(false);

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
    if (!selectedClass) return false;
    const requestId = ++loadRequest.current;
    setError("");
    setPageLoading(true);

    try {
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

      if (requestId !== loadRequest.current) return false;
      if (snapshotResult.error) throw snapshotResult.error;
      if (sessionResult.error) throw sessionResult.error;
      if (balancesResult.error) throw balancesResult.error;

      const loadedSession = (sessionResult.data ?? null) as TrainingSession | null;
      const attendanceResult = loadedSession
        ? await supabase
            .from("attendance")
            .select("person_id,session_id")
            .eq("session_id", loadedSession.id)
        : { data: [], error: null };

      if (requestId !== loadRequest.current) return false;
      if (attendanceResult.error) throw attendanceResult.error;

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
      setAttendance(
        loadedSession
          ? ((attendanceResult.data ?? []) as AttendanceRow[]).filter(
              (row) => row.session_id === loadedSession.id,
            )
          : [],
      );
      setSession(loadedSession);
      return true;
    } catch (loadError) {
      if (requestId === loadRequest.current) {
        setError(errorMessage(loadError));
      }
      return false;
    } finally {
      if (requestId === loadRequest.current) {
        setPageLoading(false);
      }
    }
  }, [isPast, selectedClass, sessionDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadClasses(), 0);
    return () => window.clearTimeout(timer);
  }, [loadClasses]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPage(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPage]);

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void loadPage();
      }
    }

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadPage]);

  const sortedPeople = useMemo(() => [...people].sort((a, b) => {
    if (a.type !== b.type) return a.type === "gæst" ? -1 : 1;
    if (a.type === "medlem" && b.type === "medlem" && a.balance !== b.balance) {
      return (b.balance ?? 0) - (a.balance ?? 0);
    }
    return a.name.localeCompare(b.name, "da");
  }), [people]);

  function isAttending(personId: string) {
    if (!session) return false;
    return attendance.some(
      (row) => row.session_id === session.id && row.person_id === personId,
    );
  }

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
    if (attendanceToggleInFlight.current || busyId || !isEditable) return;

    if (person.type === "medlem" && (person.balance ?? 0) <= 0) {
      setPaymentPerson(person);
      return;
    }

    attendanceToggleInFlight.current = true;
    setBusyId(person.id);
    setError("");

    try {
      const activeSession = await ensureSession();
      if (!activeSession) return;

      const result = await supabase.rpc("toggle_attendance", {
        p_person_id: person.id,
        p_session_id: activeSession.id,
      });

      if (result.error) {
        if (result.error.message.includes("PAYMENT_REQUIRED")) {
          setPaymentPerson(person);
          return;
        }
        setError(result.error.message);
        return;
      }

      await loadPage();

      if (result.data?.attended && person.type === "medlem" && person.balance === 1) {
        setPaymentPerson({ ...person, balance: 0, payment_status: "skal_betale" });
      }
    } catch (toggleError) {
      setError(errorMessage(toggleError));
    } finally {
      attendanceToggleInFlight.current = false;
      setBusyId(null);
    }
  }

  async function registerPayment(person: Person) {
    setBusyId(person.id);
    setError("");

    const result = person.type === "gæst"
      ? await supabase.rpc("convert_guest_to_member", {
          p_person_id: person.id,
        })
      : await supabase.rpc("register_payment", {
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
    await Promise.all([loadPage(), loadGuestConversions()]);
    return true;
  }

  async function loadInactiveMembers() {
    if (!selectedClass) return;

    const result = await supabase.rpc("get_inactive_members", {
      p_class_id: selectedClass.id,
    });

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setInactiveMembers((result.data ?? []) as InactiveMember[]);
  }

  async function loadGuestConversions() {
    const result = await supabase.rpc("get_reversible_guest_conversions");

    if (result.error) {
      setError(result.error.message);
      return;
    }

    setGuestConversions((result.data ?? []) as GuestConversion[]);
  }

  async function undoGuestConversion(conversion: GuestConversion) {
    setBusyId(conversion.payment_id);
    setError("");

    const result = await supabase.rpc("undo_guest_conversion", {
      p_payment_id: conversion.payment_id,
    });

    setBusyId(null);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    setConversionToUndo(null);
    await Promise.all([loadPage(), loadGuestConversions()]);
  }

  async function handleReset() {
    setBusyId("reset");
    setError("");

    try {
      const result = await supabase.rpc("reset_all_test_data", {
        p_confirmation: "NULSTIL ALLE TESTDATA",
      });

      if (result.error) throw result.error;

      loadRequest.current += 1;
      setResetWarningOpen(false);
      setSession(null);
      setAttendance([]);
      setPeople([]);
      setInactiveMembers([]);
      setGuestConversions([]);
      setPaymentPerson(null);
      setDeactivatePerson(null);
      setConversionToUndo(null);
      setPageLoading(true);

      await Promise.all([loadPage(), loadInactiveMembers(), loadGuestConversions()]);
    } catch (resetError) {
      const message = errorMessage(resetError);
      setError(message);
      window.alert(`Nulstilling mislykkedes: ${message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDeactivateMember(person: Person) {
    setBusyId(person.id);
    setError("");

    const result = await supabase.rpc("deactivate_member", {
      p_person_id: person.id,
    });

    setBusyId(null);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    setDeactivatePerson(null);
    await Promise.all([loadPage(), loadInactiveMembers()]);
  }

  async function reactivateMember(personId: string) {
    setBusyId(personId);
    setError("");

    const result = await supabase.rpc("reactivate_member", {
      p_person_id: personId,
    });

    setBusyId(null);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    await Promise.all([loadPage(), loadInactiveMembers()]);
  }

  async function updateCancellation(cancelled: boolean) {
    if (!selectedClass) return;
    setBusyId("session");
    setError("");

    const result = await supabase.rpc("set_session_cancelled", {
      p_class_id: selectedClass.id,
      p_session_date: sessionDate,
      p_cancelled: cancelled,
    });

    setBusyId(null);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    setCancellationAction(null);
    setAttendance([]);
    setSession(result.data as TrainingSession);
    await loadPage();
  }

  async function correctHistoricalAttendance(person: Person) {
    if (!session) {
      setError("Den historiske session findes ikke.");
      return;
    }

    setBusyId(person.id);
    setError("");

    const result = await supabase.rpc("correct_historical_attendance", {
      p_person_id: person.id,
      p_session_id: session.id,
      p_should_attend: !isAttending(person.id),
    });

    setBusyId(null);
    if (result.error) {
      setError(result.error.message);
      return;
    }

    setCorrectionPerson(null);
    await loadPage();
  }

  function changeTraining(direction: -1 | 1) {
    if (!selectedClass || classes.length === 0) return;

    // Ugyldiggør straks en igangværende indlæsning fra det gamle hold.
    loadRequest.current += 1;
    setCorrectionMode(false);
    setCorrectionPerson(null);
    setCorrectionWarningOpen(false);
    setCancellationAction(null);
    setShowMemberAdmin(false);
    setInactiveMembers([]);
    setGuestConversions([]);

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
    setPeople([]);
    setAttendance([]);
    setPageLoading(true);
    setError("");
  }

  async function addGuest(name: string) {
    if (!selectedClass) return "Intet hold valgt";
    const clean = name.trim();
    if (!clean) return "Navn mangler";

    const activeSession = await ensureSession();
    if (!activeSession) return "Træningen kunne ikke oprettes";

    const personResult = await supabase.rpc("create_guest_for_session", {
      p_name: clean,
      p_session_id: activeSession.id,
    });

    if (personResult.error) {
      if (personResult.error.message.includes("PERSON_ALREADY_EXISTS")) {
        return `${clean} findes allerede på listen. Brug den eksisterende person i stedet for at oprette en ny.`;
      }
      return personResult.error.message;
    }

    if (!personResult.data?.id) {
      return "Gæsten blev oprettet uden et gyldigt person-id.";
    }

    const membershipResult = await supabase.from("class_memberships").upsert({
      class_id: selectedClass.id,
      person_id: personResult.data.id,
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
          <button disabled={pageLoading || Boolean(busyId)} onClick={() => changeTraining(-1)} className="min-h-12 justify-self-start text-sm font-bold text-[#28755d] disabled:opacity-50">← Forrige</button>
          <div className="text-center">
            <h1 className="whitespace-nowrap text-xl font-black">{weekday(sessionDate)} {time(selectedClass.start_time)}–{time(selectedClass.end_time)}</h1>
            <p className="mt-1 text-sm font-semibold text-[#60756d]">{displayDate(sessionDate)}</p>
          </div>
          <button disabled={pageLoading || Boolean(busyId)} onClick={() => changeTraining(1)} className="min-h-12 justify-self-end text-sm font-bold text-[#28755d] disabled:opacity-50">Næste →</button>
        </nav>

        {isPast && (
          <div className="mt-3 text-center">
            <p className="text-sm font-semibold text-[#60756d]">
              {correctionMode ? "Historik · rettelsestilstand" : "Historik · kun visning"}
            </p>
            <button
              type="button"
              onClick={() => correctionMode ? setCorrectionMode(false) : setCorrectionWarningOpen(true)}
              className="mt-1 min-h-10 text-sm font-bold text-[#28755d]"
            >
              {correctionMode ? "Afslut rettelse" : "Ret registrering"}
            </button>
          </div>
        )}
        {error && <div className="mt-4 rounded-xl bg-[#fee9e5] p-4 text-sm font-semibold text-[#8d342d]">{error}</div>}

        {session?.status === "aflyst" && (
          <div className="mt-5 rounded-2xl border border-[#e1b4ae] bg-[#fff1ef] p-5 text-center">
            <p className="text-lg font-black text-[#9b3028]">Denne træning er aflyst</p>
            {sessionDate === todayDate && (
              <button
                type="button"
                onClick={() => setCancellationAction("restore")}
                className="mt-3 min-h-11 font-bold text-[#28755d]"
              >
                Fortryd aflysning
              </button>
            )}
          </div>
        )}

        {isEditable && !pageLoading && session?.status !== "aflyst" && (
          <button
            onClick={() => setAddingGuest(true)}
            className="mt-5 inline-flex min-h-12 items-center rounded-xl border border-[#b8cec4] bg-white px-4 text-base font-black text-[#28755d] shadow-sm transition hover:bg-[#eef6f2] active:scale-[0.98]"
          >
            <span className="mr-2 text-xl leading-none">+</span>
            Tilføj gæst
          </button>
        )}

        {isEditable && !pageLoading && (!session || session.status === "planlagt") && (
          <button
            type="button"
            onClick={() => setCancellationAction("cancel")}
            className="ml-3 min-h-12 text-sm font-bold text-[#9b3028]"
          >
            Aflys denne træning
          </button>
        )}

        {pageLoading && (
          <div className="mt-5 rounded-2xl border border-[#d9e0da] bg-white p-6 text-center text-sm font-semibold text-[#60756d] shadow-sm">
            Indlæser træning…
          </div>
        )}

        {!pageLoading && session?.status !== "aflyst" && (
        <section className="mt-2 overflow-hidden rounded-2xl border border-[#d9e0da] bg-white shadow-sm">
          {sortedPeople.map((person) => {
            const isChecked = isAttending(person.id);
            const blocked = person.type === "medlem" && (person.balance ?? 0) <= 0;

            return (
              <div key={person.id}>
              <button
                onClick={() => correctionMode ? setCorrectionPerson(person) : void toggle(person)}
                disabled={Boolean(busyId) || (!isEditable && !correctionMode)}
                className={`grid min-h-16 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#e8ece8] px-4 py-3 text-left ${blocked ? "bg-[#fff1ef]" : isChecked ? "bg-[#eef1ee]" : "bg-white"}`}
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-md border-2 text-base font-black ${isChecked ? "border-[#28755d] bg-[#28755d] text-white" : blocked ? "border-[#d0a155] bg-[#fff4df] text-[#8b5605]" : "border-[#aebdb5] text-transparent"}`}>{blocked ? "!" : "✓"}</span>
                <span className="truncate text-lg font-bold">{person.name}</span>
                <span className={`whitespace-nowrap text-base font-bold ${blocked ? "text-[#b42318]" : person.balance === 1 ? "text-[#c27600]" : "text-[#28755d]"}`}>{busyId === person.id ? "…" : status(person)}</span>
              </button>
              {isEditable && person.type === "gæst" && (
                <button
                  type="button"
                  disabled={Boolean(busyId)}
                  onClick={() => setPaymentPerson(person)}
                  className="min-h-11 w-full border-b border-[#e8ece8] bg-[#f7fbf9] px-4 text-right text-sm font-bold text-[#28755d] disabled:opacity-50"
                >
                  Konvertér til medlem · 10 klip for 375 kr.
                </button>
              )}
              </div>
            );
          })}
          {sortedPeople.length === 0 && <p className="p-6 text-center text-sm font-semibold text-[#60756d]">Ingen deltagere på dette hold endnu.</p>}
        </section>
        )}

        {isEditable && !pageLoading && (
          <section className="mt-5">
            <button
              type="button"
              onClick={() => {
                const next = !showMemberAdmin;
                setShowMemberAdmin(next);
                if (next) void Promise.all([loadInactiveMembers(), loadGuestConversions()]);
              }}
              className="min-h-11 text-sm font-bold text-[#60756d]"
            >
              {showMemberAdmin ? "Skjul medlemsadministration" : "Administrér medlemmer"}
            </button>

            {showMemberAdmin && (
              <div className="rounded-2xl border border-[#d9e0da] bg-white p-4 shadow-sm">
                <h2 className="font-black">Aktive medlemmer</h2>
                {sortedPeople.filter((person) => person.type === "medlem").map((person) => (
                  <div key={person.id} className="mt-3 flex items-center justify-between gap-3">
                    <span className="font-bold">{person.name}</span>
                    <button
                      type="button"
                      onClick={() => setDeactivatePerson(person)}
                      className="min-h-10 rounded-lg border border-[#d6a7a2] px-3 text-sm font-bold text-[#9b3028]"
                    >
                      Fjern
                    </button>
                  </div>
                ))}

                <h2 className="mt-6 font-black">Inaktive medlemmer</h2>
                {inactiveMembers.map((person) => (
                  <div key={person.person_id} className="mt-3 flex items-center justify-between gap-3">
                    <span className="font-bold">{person.name}</span>
                    <button
                      type="button"
                      disabled={busyId === person.person_id}
                      onClick={() => void reactivateMember(person.person_id)}
                      className="min-h-10 rounded-lg border border-[#b8cec4] px-3 text-sm font-bold text-[#28755d]"
                    >
                      Genaktivér
                    </button>
                  </div>
                ))}
                {inactiveMembers.length === 0 && (
                  <p className="mt-2 text-sm text-[#60756d]">Ingen inaktive medlemmer.</p>
                )}

                <h2 className="mt-6 font-black">Gæstekonverteringer</h2>
                {guestConversions.map((conversion) => (
                  <div key={conversion.payment_id} className="mt-3 flex items-center justify-between gap-3">
                    <span className="font-bold">{conversion.name}</span>
                    <button
                      type="button"
                      disabled={busyId === conversion.payment_id}
                      onClick={() => setConversionToUndo(conversion)}
                      className="min-h-10 rounded-lg border border-[#d6a7a2] px-3 text-sm font-bold text-[#9b3028]"
                    >
                      Fortryd konvertering
                    </button>
                  </div>
                ))}
                {guestConversions.length === 0 && (
                  <p className="mt-2 text-sm text-[#60756d]">Ingen konverteringer kan fortrydes.</p>
                )}

                <button
                  type="button"
                  onClick={() => setResetWarningOpen(true)}
                  className="mt-8 min-h-11 w-full rounded-lg border border-[#d6a7a2] px-3 text-sm font-black text-[#9b3028]"
                >
                  Nulstil alle testdata
                </button>
              </div>
            )}
          </section>
        )}
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
      {deactivatePerson && (
        <ConfirmDialog
          title="Fjern medlem"
          message={`Er du sikker på, at du vil fjerne ${deactivatePerson.name} fra den aktive liste? Historikken bevares.`}
          confirmLabel="Fjern fra aktiv liste"
          busy={busyId === deactivatePerson.id}
          onClose={() => setDeactivatePerson(null)}
          onConfirm={() => void confirmDeactivateMember(deactivatePerson)}
        />
      )}
      {cancellationAction && (
        <ConfirmDialog
          title={cancellationAction === "cancel" ? "Aflys træning" : "Fortryd aflysning"}
          message={
            cancellationAction === "cancel"
              ? `Er du sikker på, at træningen den ${displayDate(sessionDate)} skal aflyses?`
              : `Vil du sætte træningen den ${displayDate(sessionDate)} tilbage til planlagt?`
          }
          confirmLabel={cancellationAction === "cancel" ? "Aflys træning" : "Fortryd aflysning"}
          busy={busyId === "session"}
          tone={cancellationAction === "cancel" ? "danger" : "primary"}
          onClose={() => setCancellationAction(null)}
          onConfirm={() => void updateCancellation(cancellationAction === "cancel")}
        />
      )}
      {correctionWarningOpen && (
        <ConfirmDialog
          title="Ret tidligere registrering"
          message={`Du er ved at ændre en tidligere registrering for ${displayDate(sessionDate)}. Dette påvirker personens kliphistorik permanent. Fortsæt?`}
          confirmLabel="Fortsæt"
          busy={false}
          tone="primary"
          onClose={() => setCorrectionWarningOpen(false)}
          onConfirm={() => {
            setCorrectionWarningOpen(false);
            setCorrectionMode(true);
          }}
        />
      )}
      {correctionPerson && (
        <ConfirmDialog
          title="Bekræft rettelse"
          message={
            isAttending(correctionPerson.id)
              ? `Fjern det historiske fremmøde for ${correctionPerson.name} den ${displayDate(sessionDate)}?`
              : `Tilføj historisk fremmøde for ${correctionPerson.name} den ${displayDate(sessionDate)}?`
          }
          confirmLabel={isAttending(correctionPerson.id) ? "Fjern fremmøde" : "Tilføj fremmøde"}
          busy={busyId === correctionPerson.id}
          tone={isAttending(correctionPerson.id) ? "danger" : "primary"}
          onClose={() => setCorrectionPerson(null)}
          onConfirm={() => void correctHistoricalAttendance(correctionPerson)}
        />
      )}
      {conversionToUndo && (
        <ConfirmDialog
          title="Fortryd gæstekonvertering"
          message={`Vil du tilbageføre betalingen for ${conversionToUndo.name} og ændre personen tilbage til gæst?`}
          confirmLabel="Fortryd konvertering"
          busy={busyId === conversionToUndo.payment_id}
          onClose={() => setConversionToUndo(null)}
          onConfirm={() => void undoGuestConversion(conversionToUndo)}
        />
      )}
      {resetWarningOpen && (
        <ConfirmDialog
          title="Nulstil testdata"
          message="Er du sikker på, at du vil nulstille alle testdata?"
          confirmLabel="Nulstil alt"
          busy={busyId === "reset"}
          onClose={() => setResetWarningOpen(false)}
          onConfirm={() => void handleReset()}
        />
      )}
    </main>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy,
  onClose,
  onConfirm,
  tone = "danger",
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  tone?: "danger" | "primary";
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/35 p-3 sm:items-center sm:justify-center">
      <div className="w-full rounded-2xl bg-white p-5 text-[#18322b] shadow-xl sm:max-w-sm">
        <h2 className="text-xl font-black">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-[#60756d]">{message}</p>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`mt-4 min-h-14 w-full rounded-xl px-4 font-black text-white disabled:opacity-50 ${tone === "danger" ? "bg-[#9b3028]" : "bg-[#28755d]"}`}
        >
          {busy ? "Gemmer…" : confirmLabel}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className="mt-2 min-h-12 w-full font-bold text-[#60756d]">
          Annuller
        </button>
      </div>
    </div>
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
        <p className="mt-3 text-base font-bold text-[#b42318]">
          {person.type === "gæst" ? "Konvertér gæst til medlem" : "0 klip · betaling mangler"}
        </p>
        <p className="mt-2 text-sm text-[#60756d]">
          {person.type === "gæst"
            ? `Vil du konvertere ${person.name} til medlem og registrere betaling på 375 kr. (10 klip)?`
            : "Har personen betalt 375 kr. for 10 klip?"}
        </p>
        <button type="button" disabled={busy} onClick={() => void onConfirm(person)} className="mt-4 min-h-14 w-full rounded-xl bg-[#28755d] px-4 font-black text-white disabled:opacity-50">
          {busy ? "Gemmer…" : person.type === "gæst" ? "Konvertér og registrér betaling" : "Registrér betaling"}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className="mt-2 min-h-12 w-full font-bold text-[#60756d]">Luk</button>
      </div>
    </div>
  );
}
