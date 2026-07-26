"use client";

import Link from "next/link";
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

type ConfirmAction =
  | { kind: "payment"; person: Person }
  | { kind: "undo-attendance"; person: Person };

const supabase = getSupabaseBrowserClient();

function localDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nearestDateForWeekday(weekday: number) {
  const today = new Date();
  const current = today.getDay() === 0 ? 7 : today.getDay();
  const result = new Date(today);
  result.setDate(today.getDate() + weekday - current);
  return localDateValue(result);
}

function moveDate(value: string, days: number) {
  const result = new Date(`${value}T12:00:00`);
  result.setDate(result.getDate() + days);
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

function sortTrainingClasses(items: TrainingClass[]) {
  return [...items].sort(
    (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
  );
}

function initialTrainingClass(items: TrainingClass[]) {
  const today = new Date();
  const weekday = today.getDay() === 0 ? 7 : today.getDay();
  const todayClasses = items.filter((item) => item.weekday === weekday);

  if (todayClasses.length > 0) {
    const currentTime = `${String(today.getHours()).padStart(2, "0")}:${String(
      today.getMinutes(),
    ).padStart(2, "0")}`;
    return (
      todayClasses.find((item) => item.end_time.slice(0, 5) >= currentTime) ??
      todayClasses.at(-1)
    );
  }

  return [...items].sort(
    (a, b) => ((a.weekday - weekday + 7) % 7) - ((b.weekday - weekday + 7) % 7),
  )[0];
}

function friendlyError(message: string) {
  if (/permission denied|row-level security/i.test(message)) {
    return "Databasen er ikke færdigopsat endnu. Kontakt Allan.";
  }
  if (/failed to fetch|network/i.test(message)) {
    return "Forbindelsen til databasen fejlede. Prøv igen.";
  }
  return message;
}

function balanceText(person: Person) {
  if (person.type === "gæst") return "Gæst · gratis prøvetime";
  if (person.balance === null) return "Ingen klipsaldo";
  if (person.balance < 0) return `${person.balance} klip · på kredit`;
  if (person.balance === 0) return "0 klip · skal betale";
  return `${person.balance} klip tilbage`;
}

function needsPayment(person: Person) {
  return person.type === "gæst" || person.payment_status !== "ok" || (person.balance ?? 0) <= 2;
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
  const [notice, setNotice] = useState("");
  const [addingPerson, setAddingPerson] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadClasses = useCallback(async () => {
    const { data, error: classError } = await supabase
      .from("classes")
      .select("id,name,weekday,start_time,end_time,sort_order")
      .eq("active", true)
      .order("weekday")
      .order("start_time");

    if (classError) setError(friendlyError(classError.message));
    else {
      const loadedClasses = sortTrainingClasses((data ?? []) as TrainingClass[]);
      const initialClass = initialTrainingClass(loadedClasses);
      setClasses(loadedClasses);

      if (initialClass) {
        setSelectedClass(initialClass);
        setSessionDate(nearestDateForWeekday(initialClass.weekday));
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
        .order("created_at", { ascending: false }),
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

    const foundSession = (sessionResult.data ?? null) as TrainingSession | null;
    setTrainingSession(foundSession);
    setPeople((peopleResult.data ?? []) as Person[]);

    if (!foundSession) {
      setCheckedIds(new Set());
      setPageLoading(false);
      return;
    }

    const attendanceResult = await supabase
      .from("attendance")
      .select("person_id")
      .eq("session_id", foundSession.id);

    if (attendanceResult.error) setError(friendlyError(attendanceResult.error.message));
    else {
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

  function chooseClass(item: TrainingClass) {
    setPageLoading(true);
    setError("");
    setSelectedClass(item);
    setSessionDate(nearestDateForWeekday(item.weekday));
    setTrainingSession(null);
    setCheckedIds(new Set());
    setNotice("");
  }

  function changeSessionDate(value: string) {
    setPageLoading(true);
    setError("");
    setNotice("");
    setSessionDate(value);
  }

  async function ensureTrainingSession() {
    if (!selectedClass) return null;
    if (trainingSession) return trainingSession;

    const { data, error: rpcError } = await supabase.rpc("get_or_create_session", {
      p_class_id: selectedClass.id,
      p_session_date: sessionDate,
    });

    if (rpcError) {
      setError(friendlyError(rpcError.message));
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
          if (person.type === "gæst") return 0;
          if ((person.balance ?? 0) < 0) return 1;
          if ((person.balance ?? 0) === 0) return 2;
          if ((person.balance ?? 0) <= 2) return 3;
          return 4;
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
    setNotice("");

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
      setError(
        rpcError.message.includes("duplicate")
          ? `${person.name} er allerede krydset af.`
          : friendlyError(rpcError.message),
      );
      return;
    }

    setNotice(`${person.name} er krydset af.`);
    await loadAttendancePage();
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;
    setActionBusy(true);
    setError("");
    setNotice("");

    if (confirmAction.kind === "payment") {
      const { error: paymentError } = await supabase.rpc("register_payment", {
        p_person_id: confirmAction.person.id,
        p_amount_ore: 37500,
        p_clips: 10,
        p_note: "MobilePay Box – manuelt godkendt",
      });

      if (paymentError) setError(friendlyError(paymentError.message));
      else {
        setNotice(`${confirmAction.person.name}: betaling registreret og 10 klip tilføjet.`);
        await loadAttendancePage();
      }
    } else if (trainingSession) {
      const { error: undoError } = await supabase.rpc("undo_attendance_for_session", {
        p_person_id: confirmAction.person.id,
        p_session_id: trainingSession.id,
      });

      if (undoError) setError(friendlyError(undoError.message));
      else {
        setNotice(`${confirmAction.person.name} er fjernet fra dagens fremmøde.`);
        await loadAttendancePage();
      }
    }

    setActionBusy(false);
    setConfirmAction(null);
  }

  if (loading) return <LoadingScreen />;

  if (!selectedClass) {
    return (
      <main className="min-h-screen bg-[#f3f5f0] px-4 py-12 text-[#17342b]">
        <div className="mx-auto max-w-xl rounded-3xl border border-[#dce2da] bg-white p-6 shadow-sm">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-[#6b837a]">
            Træningssjov
          </p>
          <h1 className="mt-2 text-2xl font-black">Ingen træningsdage fundet</h1>
          {error && <ErrorBox message={error} />}
          {!error && (
            <p className="mt-3 text-sm leading-6 text-[#6b837a]">
              Kør databaseopsætningen i Supabase, og genindlæs siden.
            </p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f3f5f0] text-[#17342b]">
      <header className="sticky top-0 z-10 border-b border-[#dce2da] bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-xl px-4 py-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-[#6b837a]">
              Træningssjov
            </p>
            <Link href="/privatliv" className="text-xs font-bold text-[#28755d]">
              Privatliv
            </Link>
          </div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#6b837a]">
                {selectedClass.name}
              </p>
              <h1 className="text-xl font-black">
                {displayTime(selectedClass.start_time)}–{displayTime(selectedClass.end_time)}
              </h1>
            </div>
            <span className="rounded-full bg-[#e8f1ec] px-3 py-1.5 text-xs font-extrabold text-[#28755d]">
              {checkedIds.size} mødt
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-xl px-4 pb-16 pt-4">
        <section className="rounded-3xl border border-[#dce2da] bg-white p-4 shadow-sm">
          <div>
            <h2 className="text-lg font-black">Træningsdag</h2>
            <p className="mt-0.5 text-sm text-[#6b837a]">
              Samme deltagere og klipsaldi på alle træningsgange
            </p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {classes.map((item) => {
              const active = item.id === selectedClass.id;
              return (
                <button
                  key={item.id}
                  onClick={() => chooseClass(item)}
                  aria-pressed={active}
                  className={`rounded-2xl border px-3 py-3 text-left transition active:scale-[0.99] ${
                    active
                      ? "border-[#28755d] bg-[#28755d] text-white"
                      : "border-[#d7dfda] bg-[#f8faf7] text-[#17342b]"
                  }`}
                >
                  <span className="block text-sm font-black">{item.name}</span>
                  <span
                    className={`mt-1 block text-xs font-semibold ${
                      active ? "text-white/80" : "text-[#6b837a]"
                    }`}
                  >
                    {displayTime(item.start_time)}–{displayTime(item.end_time)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-4 rounded-3xl border border-[#dce2da] bg-white p-4 shadow-sm">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
            <button
              onClick={() => changeSessionDate(moveDate(sessionDate, -7))}
              aria-label="Forrige uge"
              className="h-12 w-12 rounded-2xl bg-[#eef2ed] text-2xl font-black text-[#28755d]"
            >
              ‹
            </button>
            <label className="min-w-0">
              <span className="sr-only">Træningsdato</span>
              <input
                type="date"
                value={sessionDate}
                onChange={(event) => changeSessionDate(event.target.value)}
                className="w-full rounded-2xl border border-[#ccd6d0] bg-white px-3 py-3 text-center text-base font-extrabold outline-none focus:border-[#28755d]"
              />
            </label>
            <button
              onClick={() => changeSessionDate(moveDate(sessionDate, 7))}
              aria-label="Næste uge"
              className="h-12 w-12 rounded-2xl bg-[#eef2ed] text-2xl font-black text-[#28755d]"
            >
              ›
            </button>
          </div>
          <p className="mt-2 text-center text-sm capitalize text-[#6b837a]">
            {displayDate(sessionDate)}
          </p>
        </section>

        {error && <ErrorBox message={error} />}
        {notice && (
          <div className="mt-4 rounded-2xl bg-[#e3f2e9] p-4 text-sm font-semibold text-[#236047]">
            {notice}
          </div>
        )}

        <section className="mt-4 overflow-hidden rounded-3xl border border-[#dce2da] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#e8ece7] px-4 py-4">
            <div>
              <h2 className="text-lg font-black">Deltagere</h2>
              <p className="text-sm text-[#6b837a]">Tryk på navnet for at krydse af</p>
            </div>
            <button
              onClick={() => setAddingPerson(true)}
              className="rounded-2xl bg-[#17342b] px-4 py-3 text-sm font-extrabold text-white"
            >
              + Gæst
            </button>
          </div>

          {pageLoading ? (
            <div className="px-5 py-10 text-center font-bold text-[#6b837a]">Henter deltagere…</div>
          ) : sortedPeople.length === 0 ? (
            <div className="px-5 py-10 text-center text-[#6b837a]">
              Ingen deltagere endnu. Tilføj den første gæst.
            </div>
          ) : (
            <div className="divide-y divide-[#edf0ec]">
              {sortedPeople.map((person) => {
                const checked = checkedIds.has(person.id);
                return (
                  <div
                    key={person.id}
                    className={checked ? "bg-[#eef1ed]" : "bg-white"}
                  >
                    <button
                      onClick={() => checkIn(person)}
                      disabled={checked || savingId === person.id}
                      aria-pressed={checked}
                      className={`flex min-h-20 w-full items-center gap-4 px-4 py-3 text-left transition disabled:cursor-default ${
                        checked ? "opacity-50" : ""
                      }`}
                    >
                      <span
                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-xl font-black ${
                          checked
                            ? "border-[#28755d] bg-[#28755d] text-white"
                            : "border-[#bdc9c2] bg-white text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-lg font-extrabold">{person.name}</span>
                        <span className="mt-0.5 block text-sm text-[#6b837a]">
                          {checked ? `Mødt · ${balanceText(person)}` : balanceText(person)}
                        </span>
                      </span>
                      {!checked && (
                        <span className="text-sm font-bold text-[#28755d]">
                          {savingId === person.id ? "Gemmer…" : "Kryds af"}
                        </span>
                      )}
                    </button>

                    {(checked || needsPayment(person)) && (
                      <div className="flex justify-end gap-2 px-4 pb-3">
                        {checked && (
                          <button
                            onClick={() => setConfirmAction({ kind: "undo-attendance", person })}
                            className="rounded-xl border border-[#ccd6d0] px-3 py-2 text-xs font-extrabold text-[#5f746c]"
                          >
                            Fortryd fremmøde
                          </button>
                        )}
                        {needsPayment(person) && (
                          <button
                            onClick={() => setConfirmAction({ kind: "payment", person })}
                            className="rounded-xl bg-[#fff2d7] px-3 py-2 text-xs font-extrabold text-[#80580c]"
                          >
                            Betaling modtaget
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <p className="mt-5 text-center text-xs leading-5 text-[#6b837a]">
          En ny træningsgang nulstiller kun fremmødet. Navne, gæster og klipsaldi følger med.
        </p>
      </div>

      {addingPerson && (
        <AddPerson
          onClose={() => setAddingPerson(false)}
          onCreated={async (name) => {
            await loadAttendancePage();
            setNotice(`${name} er tilføjet som gæst.`);
          }}
        />
      )}

      {confirmAction && (
        <ConfirmDialog
          action={confirmAction}
          busy={actionBusy}
          onCancel={() => setConfirmAction(null)}
          onConfirm={runConfirmedAction}
        />
      )}
    </main>
  );
}

function AddPerson({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [informed, setInformed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!informed || !cleanName) return;
    setBusy(true);
    setError("");

    const { error: insertError } = await supabase.from("people").insert({
      name: cleanName,
      type: "gæst",
      balance: null,
      payment_status: "skal_betale",
      privacy_notice_given_at: new Date().toISOString(),
    });

    setBusy(false);
    if (insertError) {
      setError(friendlyError(insertError.message));
      return;
    }
    await onCreated(cleanName);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40 p-3 sm:items-center sm:justify-center">
      <form
        onSubmit={submit}
        className="w-full rounded-3xl bg-white p-5 text-[#17342b] shadow-xl sm:max-w-md"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-[#6b837a]">Ny deltager</p>
            <h2 className="text-2xl font-black">Tilføj som gæst</h2>
          </div>
          <button type="button" onClick={onClose} className="px-2 text-3xl" aria-label="Luk">
            ×
          </button>
        </div>
        <input
          autoFocus
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Navn"
          className="mt-5 w-full rounded-2xl border border-[#ccd6d0] px-4 py-4 text-lg outline-none focus:border-[#28755d]"
        />
        <label className="mt-4 flex gap-3 rounded-2xl bg-[#f3f5f0] p-4 text-sm leading-5">
          <input
            type="checkbox"
            checked={informed}
            onChange={(event) => setInformed(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
          />
          <span>Personen er informeret om, at navn og fremmøde gemmes for at administrere holdet.</span>
        </label>
        {error && <p className="mt-3 text-sm font-semibold text-[#9a3b32]">{error}</p>}
        <button
          disabled={!informed || busy}
          className="mt-4 w-full rounded-2xl bg-[#28755d] px-4 py-4 font-extrabold text-white disabled:opacity-40"
        >
          {busy ? "Gemmer…" : "Gem gæst"}
        </button>
      </form>
    </div>
  );
}

function ConfirmDialog({
  action,
  busy,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isPayment = action.kind === "payment";

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40 p-3 sm:items-center sm:justify-center">
      <div className="w-full rounded-3xl bg-white p-5 text-[#17342b] shadow-xl sm:max-w-sm">
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-[#6b837a]">
          {isPayment ? "Bekræft betaling" : "Fortryd fremmøde"}
        </p>
        <h2 className="mt-2 text-2xl font-black">{action.person.name}</h2>
        <p className="mt-3 leading-6 text-[#5f746c]">
          {isPayment
            ? "Har personen betalt 375 kr. via MobilePay? Der tilføjes 10 klip."
            : "Personen fjernes fra denne træningsdag, og et eventuelt klip sættes tilbage."}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            disabled={busy}
            onClick={onCancel}
            className="rounded-2xl border border-[#ccd6d0] px-4 py-3 font-extrabold"
          >
            Annuller
          </button>
          <button
            disabled={busy}
            onClick={onConfirm}
            className="rounded-2xl bg-[#28755d] px-4 py-3 font-extrabold text-white disabled:opacity-50"
          >
            {busy ? "Gemmer…" : isPayment ? "Ja, registrér" : "Ja, fortryd"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-2xl bg-[#fee9e5] p-4 text-sm font-semibold text-[#8d342d]">
      {message}
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f5f0] font-bold text-[#6b837a]">
      Indlæser…
    </main>
  );
}
