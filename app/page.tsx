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
type TrialAttendance = { person_id: string; session_id: string | null };
type TrialSession = { id: string; session_date: string };

const supabase = getSupabaseBrowserClient();

const LEGACY_DEMO_GUESTS = new Set([
  "benny hansen",
  "peter hansen",
  "sofie (gæst)",
]);
const LEGACY_DEMO_GUEST_CUTOFF = new Date("2026-07-26T18:00:00Z").getTime();

type DemoPerson = {
  name: string;
  type: "medlem";
  balance: number;
  payment_status: "ok";
};

function demoPerson(name: string, balance: number): DemoPerson {
  return { name, type: "medlem", balance, payment_status: "ok" };
}

const DEMO_ROSTERS: Record<string, DemoPerson[]> = {
  "1-17:00": [
    demoPerson("Anna Madsen", 8),
    demoPerson("Birgit Holm", 5),
    demoPerson("Camilla Friis", 2),
    demoPerson("Dorte Larsen", 10),
    demoPerson("Eva Nielsen", 6),
    demoPerson("Freja Bach", 7),
    demoPerson("Helle Møller", 4),
    demoPerson("Ida Thomsen", 9),
    demoPerson("Karen Sørensen", 6),
    demoPerson("Lene Andersen", 3),
  ],
  "1-18:00": [
    demoPerson("Gitte Jensen", 9),
    demoPerson("Heidi Lund", 6),
    demoPerson("Jannie Kjær", 4),
    demoPerson("Lone Pedersen", 8),
    demoPerson("Mette Dahl", 3),
    demoPerson("Naja Poulsen", 10),
    demoPerson("Rikke Brandt", 5),
    demoPerson("Signe Vester", 7),
    demoPerson("Tina Krogh", 2),
    demoPerson("Ulla Knudsen", 6),
  ],
  "4-17:30": [
    demoPerson("Alberte Hansen", 7),
    demoPerson("Bodil Mikkelsen", 4),
    demoPerson("Cecilie Falk", 9),
    demoPerson("Ditmar Olsen", 5),
    demoPerson("Emilie Bruun", 8),
    demoPerson("Finn Lauritsen", 3),
    demoPerson("Grethe Friis", 10),
    demoPerson("Henrik Storm", 6),
    demoPerson("Inge Dahl", 2),
    demoPerson("Jesper Madsen", 7),
  ],
  "7-09:00": [
    demoPerson("Kirsten Holm", 8),
    demoPerson("Lars Winther", 5),
    demoPerson("Maria Bach", 10),
    demoPerson("Niels Jensen", 4),
    demoPerson("Olivia Larsen", 6),
    demoPerson("Pernille Skov", 9),
    demoPerson("Rasmus Kjær", 3),
    demoPerson("Susanne Lund", 7),
    demoPerson("Thomas Berg", 5),
    demoPerson("Vibeke Poulsen", 8),
  ],
};

const DEMO_PEOPLE = Object.values(DEMO_ROSTERS).flat();

function normalizedName(value: string) {
  return value.trim().toLocaleLowerCase("da-DK");
}

function clipBalance(person: Person) {
  return Math.min(10, Math.max(0, person.balance ?? 0));
}

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

function isLegacyDemoGuest(person: Person) {
  return (
    person.type === "gæst" &&
    LEGACY_DEMO_GUESTS.has(person.name.trim().toLocaleLowerCase("da-DK")) &&
    new Date(person.created_at).getTime() < LEGACY_DEMO_GUEST_CUTOFF
  );
}

function preferredDuplicate(a: Person, b: Person) {
  if (a.type !== b.type) return a.type === "medlem" ? a : b;

  if (a.type === "medlem") {
    const balanceDifference = clipBalance(a) - clipBalance(b);
    if (balanceDifference !== 0) return balanceDifference > 0 ? a : b;
  }

  return new Date(a.created_at).getTime() >= new Date(b.created_at).getTime()
    ? a
    : b;
}

function uniquePeopleByName(items: Person[]) {
  const uniquePeople = new Map<string, Person>();

  for (const person of items) {
    const key = normalizedName(person.name);
    const existing = uniquePeople.get(key);
    uniquePeople.set(key, existing ? preferredDuplicate(existing, person) : person);
  }

  return [...uniquePeople.values()];
}

function guestNeedsPayment(
  person: Person,
  trialDate: string | undefined,
  sessionDate: string,
) {
  return person.type === "gæst" && Boolean(trialDate && sessionDate > trialDate);
}

function personNeedsPayment(
  person: Person,
  trialDate: string | undefined,
  sessionDate: string,
) {
  if (person.type === "gæst") {
    return guestNeedsPayment(person, trialDate, sessionDate);
  }

  return clipBalance(person) <= 0;
}

function statusText(
  person: Person,
  trialDate: string | undefined,
  sessionDate: string,
) {
  if (person.type === "gæst") {
    return guestNeedsPayment(person, trialDate, sessionDate)
      ? "Skal betale"
      : "Gæst";
  }
  const balance = clipBalance(person);
  if (balance <= 0) return "0 klip · betal";
  return `${balance} klip`;
}

function friendlyError(message: string) {
  if (/permission denied|row-level security/i.test(message)) {
    return "Databasen er ikke færdigopsat endnu.";
  }
  if (/failed to fetch|network/i.test(message)) {
    return "Forbindelsen til databasen fejlede. Prøv igen.";
  }
  if (/register_payment|remove_unpaid_guest|schema cache|could not find the function/i.test(message)) {
    return "Handlingen kunne ikke gemmes. Databasen mangler den nyeste opdatering.";
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
  const [guestTrialDates, setGuestTrialDates] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [addingGuest, setAddingGuest] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [paymentPerson, setPaymentPerson] = useState<Person | null>(null);

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

    const [peopleResult, sessionResult, trialResult] = await Promise.all([
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
      supabase
        .from("attendance")
        .select("person_id,session_id")
        .eq("type", "prøvetime"),
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

    if (trialResult.error) {
      setError(friendlyError(trialResult.error.message));
      setPageLoading(false);
      return;
    }

    let loadedPeople = ((peopleResult.data ?? []) as Person[]).filter(
      (person) => !isLegacyDemoGuest(person),
    );

    const loadedNames = new Set(
      loadedPeople.map((person) => normalizedName(person.name)),
    );
    const missingDemoPeople = DEMO_PEOPLE.filter(
      (person) => !loadedNames.has(normalizedName(person.name)),
    );

    if (missingDemoPeople.length > 0) {
      const { data: demoPeople, error: demoError } = await supabase
        .from("people")
        .insert(
          missingDemoPeople.map((person) => ({
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

      loadedPeople = [
        ...loadedPeople,
        ...((demoPeople ?? []) as Person[]),
      ];
    }

    const foundSession = (sessionResult.data ?? null) as TrainingSession | null;
    const trialRows = (trialResult.data ?? []) as TrialAttendance[];
    const trialSessionIds = [
      ...new Set(
        trialRows
          .map((row) => row.session_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    let trialSessions: TrialSession[] = [];

    if (trialSessionIds.length > 0) {
      const { data, error: trialSessionError } = await supabase
        .from("sessions")
        .select("id,session_date")
        .in("id", trialSessionIds);

      if (trialSessionError) {
        setError(friendlyError(trialSessionError.message));
        setPageLoading(false);
        return;
      }

      trialSessions = (data ?? []) as TrialSession[];
    }

    const sessionDatesById = new Map(
      trialSessions.map((session) => [session.id, session.session_date]),
    );
    const nextTrialDates: Record<string, string> = {};

    for (const row of trialRows) {
      if (!row.session_id) continue;
      const trialDate = sessionDatesById.get(row.session_id);
      if (
        trialDate &&
        (!nextTrialDates[row.person_id] ||
          trialDate < nextTrialDates[row.person_id])
      ) {
        nextTrialDates[row.person_id] = trialDate;
      }
    }

    setPeople(loadedPeople);
    setTrainingSession(foundSession);
    setGuestTrialDates(nextTrialDates);

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

  const sortedPeople = useMemo(() => {
    if (!selectedClass) return [];

    const visiblePeople = uniquePeopleByName(people);

    return visiblePeople.sort((a, b) => {
      if (a.type !== b.type) return a.type === "gæst" ? -1 : 1;
      if (a.type === "gæst" && b.type === "gæst") {
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      }

      const balanceDifference = clipBalance(b) - clipBalance(a);
      return balanceDifference || a.name.localeCompare(b.name, "da");
    });
  }, [people, selectedClass]);

  async function toggleAttendance(person: Person) {
    if (savingId || trainingSession?.status === "aflyst") return;

    if (checkedIds.has(person.id)) {
      setSavingId(person.id);
      setError("");

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

    if (
      personNeedsPayment(
        person,
        guestTrialDates[person.id],
        sessionDate,
      )
    ) {
      setPaymentPerson(person);
      return;
    }

    setSavingId(person.id);
    setError("");

    const activeSession = await ensureTrainingSession();

    if (!activeSession) {
      setSavingId(null);
      return;
    }

    const attendanceType = person.type === "gæst" ? "prøvetime" : "normal";

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

  async function registerPayment(person: Person) {
    setSavingId(person.id);
    setError("");

    const { error: paymentError } = await supabase.rpc("register_payment", {
      p_person_id: person.id,
      p_amount_ore: 37500,
      p_clips: 10,
      p_note:
        person.type === "gæst"
          ? "10 klip efter gratis prøvetime"
          : "Nyt klippekort med 10 klip",
    });

    if (paymentError) {
      setSavingId(null);
      return friendlyError(paymentError.message);
    }

    setSavingId(null);
    await loadAttendancePage();
    return null;
  }

  async function removeGuest(person: Person) {
    setSavingId(person.id);
    setError("");

    const { data, error: removeError } = await supabase.rpc(
      "remove_unpaid_guest",
      { p_person_id: person.id },
    );

    setSavingId(null);

    if (removeError) return friendlyError(removeError.message);
    if (!data) return "Personen kunne ikke fjernes.";

    await loadAttendancePage();
    return null;
  }

  async function addGuest(name: string) {
    setError("");

    if (people.some((person) => normalizedName(person.name) === normalizedName(name))) {
      return `${name} står allerede på deltagerlisten.`;
    }

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
                const needsPayment = personNeedsPayment(
                  person,
                  guestTrialDates[person.id],
                  sessionDate,
                );
                const hasLowBalance =
                  person.type === "medlem" && clipBalance(person) <= 1;

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
                          : needsPayment
                            ? "border-[#d0a155] bg-[#fff4df] text-[#8b5605]"
                          : "border-[#aebdb5] bg-white text-transparent"
                      }`}
                    >
                      {needsPayment ? "!" : "✓"}
                    </span>

                    <span className="min-w-0 truncate text-base font-bold sm:text-lg">
                      {person.name}
                    </span>

                    <span
                      className={`whitespace-nowrap text-sm font-bold sm:text-base ${
                        needsPayment || hasLowBalance
                          ? "text-[#b42318]"
                          : "text-[#526960]"
                      }`}
                    >
                      {saving
                        ? "…"
                        : statusText(
                            person,
                            guestTrialDates[person.id],
                            sessionDate,
                          )}
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

      {paymentPerson && (
        <PaymentDialog
          person={paymentPerson}
          onClose={() => setPaymentPerson(null)}
          onConfirm={registerPayment}
          onRemove={removeGuest}
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

function PaymentDialog({
  person,
  onClose,
  onConfirm,
  onRemove,
}: {
  person: Person;
  onClose: () => void;
  onConfirm: (person: Person) => Promise<string | null>;
  onRemove: (person: Person) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirmPayment() {
    setBusy(true);
    setError("");
    const paymentError = await onConfirm(person);
    setBusy(false);

    if (paymentError) {
      setError(paymentError);
      return;
    }

    onClose();
  }

  async function confirmRemoval() {
    if (!window.confirm(`Fjern ${person.name} fra listen?`)) return;

    setBusy(true);
    setError("");
    const removeError = await onRemove(person);
    setBusy(false);

    if (removeError) {
      setError(removeError);
      return;
    }

    onClose();
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/35 p-3 sm:items-center sm:justify-center">
      <div className="w-full rounded-2xl bg-white p-5 text-[#18322b] shadow-xl sm:max-w-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-black">Skal betale 375 kr.</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Luk"
            className="h-11 w-11 rounded-xl text-3xl text-[#60756d]"
          >
            ×
          </button>
        </div>

        <p className="mt-3 text-base font-bold">{person.name}</p>
        <p className="mt-1 text-sm text-[#60756d]">
          Tryk først, når MobilePay er modtaget. Personen får 10 klip. Luk
          derefter boksen, og klik personen af på deltagerlisten.
        </p>

        {error && <p className="mt-3 text-sm font-semibold text-[#8d342d]">{error}</p>}

        <button
          type="button"
          onClick={confirmPayment}
          disabled={busy}
          className="mt-4 min-h-14 w-full rounded-xl bg-[#28755d] px-4 font-black text-white disabled:opacity-40"
        >
          {busy ? "Gemmer…" : "MobilePay modtaget"}
        </button>

        {person.type === "gæst" && (
          <button
            type="button"
            onClick={confirmRemoval}
            disabled={busy}
            className="mt-3 min-h-12 w-full rounded-xl px-4 font-bold text-[#8d342d] disabled:opacity-40"
          >
            Fjern fra listen
          </button>
        )}
      </div>
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
