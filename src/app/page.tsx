"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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

const DEMO_PEOPLE = [
  {
    name: "Allan Maharaj",
    type: "medlem" as const,
    balance: 7,
    payment_status: "ok" as const,
  },
  {
    name: "Camilla Friis",
    type: "medlem" as const,
    balance: 4,
    payment_status: "ok" as const,
  },
  {
    name: "Benny Hansen",
    type: "gæst" as const,
    balance: null,
    payment_status: "skal_betale" as const,
  },
  {
    name: "Pia Nielsen",
    type: "medlem" as const,
    balance: -1,
    payment_status: "blokeret" as const,
  },
  {
    name: "Anna Madsen",
    type: "medlem" as const,
    balance: 8,
    payment_status: "ok" as const,
  },
  {
    name: "Dorte Larsen",
    type: "medlem" as const,
    balance: 10,
    payment_status: "ok" as const,
  },
];

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function upcomingMonday() {
  const today = new Date();
  const monday = new Date(today);
  const daysUntilMonday = (8 - today.getDay()) % 7;
  monday.setDate(today.getDate() + daysUntilMonday);
  return localDateValue(monday);
}

function moveDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateValue(date);
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

function weekdayName(value: string) {
  const name = new Intl.DateTimeFormat("da-DK", { weekday: "long" }).format(
    new Date(`${value}T12:00:00`),
  );
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function compactTime(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(":");
  return minutes === "00" ? String(Number(hours)) : `${Number(hours)}.${minutes}`;
}

function classTitle(trainingClass: TrainingClass, sessionDate: string) {
  return `${weekdayName(sessionDate)} ${compactTime(trainingClass.start_time)}–${compactTime(trainingClass.end_time)}`;
}

function sortTrainingClasses(items: TrainingClass[]) {
  return [...items].sort(
    (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
  );
}

function statusText(person: Person) {
  if (person.type === "gæst") return "Gæst";
  if ((person.balance ?? 0) <= 0) return "Kredit";
  return `${person.balance} klip`;
}

function friendlyError(message: string) {
  if (/permission denied|row-level security/i.test(message)) {
    return "Databasen er ikke færdigopsat endnu.";
  }
  if (/failed to fetch|network/i.test(message)) {
    return "Forbindelsen til databasen fejlede. Prøv igen.";
  }
  return message;
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [classes, setClasses] = useState<TrainingClass[]>([]);
  const [selectedClass, setSelectedClass] = useState<TrainingClass | null>(null);
  const [sessionDate, setSessionDate] = useState(localDateValue(new Date()));
  const [trainingSession, setTrainingSession] = useState<TrainingSession | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [addingGuest, setAddingGuest] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadClasses = useCallback(async () => {
    const { data, error: classError } = await supabase
      .from("classes")
      .select("id,name,weekday,start_time,end_time,sort_order")
      .eq("active", true)
      .order("weekday")
      .order("start_time");

    if (classError) {
      setError(friendlyError(classError.message));
    } else {
      const loadedClasses = sortTrainingClasses((data ?? []) as TrainingClass[]);
      setClasses(loadedClasses);

      if (loadedClasses[0]) {
        setPageLoading(true);
        setSelectedClass(loadedClasses[0]);
        setSessionDate(upcomingMonday());
      }
    }

    setLoading(false);
  }, []);

  const loadAttendancePage = useCallback(async () => {
    if (!selectedClass) return;

    const [peopleResult, sessionResult] = await Promise.all([
      supabase
        .from("people")
        .select("id,name,type,balance,payment_status,created_at")
        .order("created_at"),
      supabase
        .from("sessions")
        .select("id,status")
        .eq("class_id", selectedClass.id)
        .eq("session_date", sessionDate)
        .maybeSingle(),
    ]);

    if (peopleResult.error) {
      setError(friendlyError(peopleResult.error.message));
      setPageLoading(false);
      return;
    }

    if (sessionResult.error) {
      setError(friendlyError(sessionResult.error.message));
      setPageLoading(false);
      return;
    }

    let loadedPeople = (peopleResult.data ?? []) as Person[];

    if (loadedPeople.length === 0) {
      const { data: demoPeople, error: demoError } = await supabase
        .from("people")
        .insert(
          DEMO_PEOPLE.map((person) => ({
            ...person,
            privacy_notice_given_at: new Date().toISOString(),
          })),
        )
        .select("id,name,type,balance,payment_status,created_at");

      if (demoError) {
        setError(friendlyError(demoError.message));
        setPageLoading(false);
        return;
      }

      loadedPeople = (demoPeople ?? []) as Person[];
    }

    const foundSession = (sessionResult.data ?? null) as TrainingSession | null;
    setPeople(loadedPeople);
    setTrainingSession(foundSession);

    if (!foundSession) {
      setCheckedIds(new Set());
      setPageLoading(false);
      return;
    }

    const attendanceResult = await supabase
      .from("attendance")
      .select("person_id")
      .eq("session_id", foundSession.id);

    if (attendanceResult.error) {
      setError(friendlyError(attendanceResult.error.message));
    } else {
      setCheckedIds(
        new Set(((attendanceResult.data ?? []) as Attendance[]).map((row) => row.person_id)),
      );
    }

    setPageLoading(false);
  }, [selectedClass, sessionDate]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadClasses(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadClasses]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadAttendancePage(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadAttendancePage]);

  function changeTraining(direction: -1 | 1) {
    if (!selectedClass || classes.length === 0) return;

    const currentIndex = classes.findIndex((item) => item.id === selectedClass.id);
    if (currentIndex < 0) return;

    const targetIndex = (currentIndex + direction + classes.length) % classes.length;
    const targetClass = classes[targetIndex];
    const dayDifference =
      direction === 1
        ? (targetClass.weekday - selectedClass.weekday + 7) % 7
        : -((selectedClass.weekday - targetClass.weekday + 7) % 7);

    setPageLoading(true);
    setError("");
    setSelectedClass(targetClass);
    setSessionDate(moveDate(sessionDate, dayDifference));
    setTrainingSession(null);
    setCheckedIds(new Set());
  }

  async function ensureTrainingSession() {
    if (!selectedClass) return null;
    if (trainingSession) return trainingSession;

    const { data, error: sessionError } = await supabase.rpc("get_or_create_session", {
      p_class_id: selectedClass.id,
      p_session_date: sessionDate,
    });

    if (sessionError) {
      setError(friendlyError(sessionError.message));
      return null;
    }

    const createdSession = data as TrainingSession;
    setTrainingSession(createdSession);
    return createdSession;
  }

  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => a.name.localeCompare(b.name, "da")),
    [people],
  );

  async function toggleAttendance(person: Person) {
    if (savingId || trainingSession?.status === "aflyst") return;

    setSavingId(person.id);
    setError("");

    if (checkedIds.has(person.id)) {
      if (!trainingSession) {
        setSavingId(null);
        return;
      }

      const { error: undoError } = await supabase.rpc("undo_attendance_for_session", {
        p_person_id: person.id,
        p_session_id: trainingSession.id,
      });

      setSavingId(null);

      if (undoError) {
        setError(friendlyError(undoError.message));
        return;
      }

      await loadAttendancePage();
      return;
    }

    const activeSession = await ensureTrainingSession();

    if (!activeSession) {
      setSavingId(null);
      return;
    }

    const attendanceType =
      person.type === "gæst" ? "prøvetime" : (person.balance ?? 0) > 0 ? "normal" : "kredit";

    const { error: attendanceError } = await supabase.rpc(
      "register_attendance_for_session",
      {
        p_person_id: person.id,
        p_session_id: activeSession.id,
        p_type: attendanceType,
      },
    );

    setSavingId(null);

    if (attendanceError) {
      setError(friendlyError(attendanceError.message));
      return;
    }

    await loadAttendancePage();
  }

  async function addGuest(name: string) {
    setError("");

    const activeSession = await ensureTrainingSession();
    if (!activeSession) return "Træningsgangen kunne ikke oprettes.";

    const { data: newGuest, error: insertError } = await supabase
      .from("people")
      .insert({
        name,
        type: "gæst",
        balance: null,
        payment_status: "skal_betale",
        privacy_notice_given_at: new Date().toISOString(),
      })
      .select("id,name,type,balance,payment_status,created_at")
      .single();

    if (insertError) return friendlyError(insertError.message);

    const { error: attendanceError } = await supabase.rpc(
      "register_attendance_for_session",
      {
        p_person_id: (newGuest as Person).id,
        p_session_id: activeSession.id,
        p_type: "prøvetime",
      },
    );

    if (attendanceError) return friendlyError(attendanceError.message);

    await loadAttendancePage();
    return null;
  }

  if (loading) return <LoadingScreen />;

  if (!selectedClass) {
    return (
      <main className="min-h-screen bg-[#f4f5f1] px-4 py-10 text-[#18322b]">
        <div className="mx-auto max-w-xl">
          <ErrorBox message={error || "Ingen træningshold fundet."} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f5f1] px-3 py-5 text-[#18322b] sm:px-5 sm:py-8">
      <div className="mx-auto max-w-xl">
        <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <button
            type="button"
            onClick={() => changeTraining(-1)}
            className="min-h-12 justify-self-start rounded-xl px-1 text-left text-sm font-bold text-[#28755d] active:bg-[#e4ebe6] sm:px-2"
          >
            ← Forrige hold
          </button>

          <h1 className="whitespace-nowrap text-center text-base font-black sm:text-xl">
            {classTitle(selectedClass, sessionDate)}
          </h1>

          <button
            type="button"
            onClick={() => changeTraining(1)}
            className="min-h-12 justify-self-end rounded-xl px-1 text-right text-sm font-bold text-[#28755d] active:bg-[#e4ebe6] sm:px-2"
          >
            Næste hold →
          </button>
        </nav>

        <p className="mt-3 text-sm font-semibold text-[#60756d]">
          Dato: <span className="text-[#18322b]">{displayDate(sessionDate)}</span>
        </p>

        {error && <ErrorBox message={error} />}

        <button
          type="button"
          onClick={() => setAddingGuest(true)}
          className="mt-5 min-h-12 rounded-xl px-2 text-base font-black text-[#28755d] active:bg-[#e4ebe6]"
        >
          + Gæst
        </button>

        <section
          aria-busy={pageLoading}
          className={`mt-2 overflow-hidden rounded-2xl border border-[#d9e0da] bg-white shadow-sm transition ${
            pageLoading ? "opacity-55" : ""
          }`}
        >
          {sortedPeople.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-[#60756d]">Ingen deltagere.</p>
          ) : (
            <div className="divide-y divide-[#e8ece8]">
              {sortedPeople.map((person) => {
                const checked = checkedIds.has(person.id);
                const saving = savingId === person.id;

                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => toggleAttendance(person)}
                    disabled={Boolean(savingId) || pageLoading}
                    aria-pressed={checked}
                    className={`grid min-h-16 w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition ${
                      checked ? "bg-[#eef1ee] opacity-45" : "bg-white active:bg-[#f1f5f2]"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-7 w-7 items-center justify-center rounded-md border-2 text-base font-black ${
                        checked
                          ? "border-[#28755d] bg-[#28755d] text-white"
                          : "border-[#aebdb5] bg-white text-transparent"
                      }`}
                    >
                      ✓
                    </span>

                    <span className="min-w-0 truncate text-base font-bold sm:text-lg">
                      {person.name}
                    </span>

                    <span className="whitespace-nowrap text-sm font-bold text-[#526960] sm:text-base">
                      {saving ? "…" : statusText(person)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {addingGuest && (
        <AddGuest
          onClose={() => setAddingGuest(false)}
          onSave={addGuest}
        />
      )}
    </main>
  );
}

function AddGuest({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) return;

    setBusy(true);
    setError("");
    const saveError = await onSave(cleanName);
    setBusy(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    onClose();
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/35 p-3 sm:items-center sm:justify-center">
      <form
        onSubmit={submit}
        className="w-full rounded-2xl bg-white p-5 text-[#18322b] shadow-xl sm:max-w-sm"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-black">Tilføj gæst</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Luk"
            className="h-11 w-11 rounded-xl text-3xl text-[#60756d]"
          >
            ×
          </button>
        </div>

        <input
          autoFocus
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Navn"
          className="mt-4 min-h-14 w-full rounded-xl border border-[#bcc9c2] px-4 text-lg outline-none focus:border-[#28755d]"
        />

        {error && <p className="mt-3 text-sm font-semibold text-[#8d342d]">{error}</p>}

        <button
          disabled={busy || !name.trim()}
          className="mt-4 min-h-14 w-full rounded-xl bg-[#28755d] px-4 font-black text-white disabled:opacity-40"
        >
          {busy ? "Gemmer…" : "Tilføj"}
        </button>
      </form>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-xl bg-[#fee9e5] p-4 text-sm font-semibold text-[#8d342d]">
      {message}
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f5f1] font-bold text-[#60756d]">
      Indlæser…
    </main>
  );
}
