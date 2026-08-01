import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type AuditEvent = {
  id: number;
  occurred_at: string;
  action_type: string;
  person_id: string | null;
  session_id: string | null;
  balance_before: number | null;
  balance_after: number | null;
  details: Record<string, unknown>;
};

type PersonRow = { id: string; name: string };
type SessionRow = { id: string; class_id: string; session_date: string };
type ClassRow = { id: string; name: string };

function formatSessionDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("da-DK", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export async function GET() {
  if (process.env.TEST_MODE !== "true") {
    return NextResponse.json({ error: "Aktivitetsloggen er deaktiveret." }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Aktivitetsloggen er ikke konfigureret." }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const eventsResult = await supabase
    .from("audit_events")
    .select("id,occurred_at,action_type,person_id,session_id,balance_before,balance_after,details")
    .in("action_type", [
      "attendance_registered",
      "attendance_removed",
      "payment_registered",
      "payment_reversed",
      "guest_created",
      "guest_converted",
      "guest_conversion_reversed",
      "member_deactivated",
      "member_reactivated",
      "session_cancelled",
      "session_reopened",
      "test_data_reset",
    ])
    .order("id", { ascending: false })
    .limit(200);

  if (eventsResult.error) {
    return NextResponse.json({ error: eventsResult.error.message }, { status: 500 });
  }

  const events = (eventsResult.data ?? []) as AuditEvent[];
  const personIds = [...new Set(events.flatMap((event) => event.person_id ? [event.person_id] : []))];
  const sessionIds = [...new Set(events.flatMap((event) => event.session_id ? [event.session_id] : []))];

  const [peopleResult, sessionsResult] = await Promise.all([
    personIds.length
      ? supabase.from("people").select("id,name").in("id", personIds)
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length
      ? supabase.from("sessions").select("id,class_id,session_date").in("id", sessionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (peopleResult.error) {
    return NextResponse.json({ error: peopleResult.error.message }, { status: 500 });
  }
  if (sessionsResult.error) {
    return NextResponse.json({ error: sessionsResult.error.message }, { status: 500 });
  }

  const sessions = (sessionsResult.data ?? []) as SessionRow[];
  const classIds = [...new Set(sessions.map((session) => session.class_id))];
  const classesResult = classIds.length
    ? await supabase.from("classes").select("id,name").in("id", classIds)
    : { data: [], error: null };

  if (classesResult.error) {
    return NextResponse.json({ error: classesResult.error.message }, { status: 500 });
  }

  const people = new Map((peopleResult.data as PersonRow[]).map((person) => [person.id, person.name]));
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const classes = new Map((classesResult.data as ClassRow[]).map((trainingClass) => [trainingClass.id, trainingClass.name]));
  const items: Array<{ id: string; occurred_at: string; text: string }> = [];

  for (const event of events) {
    const personName = event.person_id
      ? people.get(event.person_id) ?? String(event.details.name ?? "Ukendt person")
      : null;
    const session = event.session_id ? sessionMap.get(event.session_id) : null;
    const trainingClass = session ? classes.get(session.class_id) ?? "træningen" : "træningen";
    const date = session
      ? formatSessionDate(session.session_date)
      : null;
    let text: string;

    if (event.action_type === "attendance_registered") {
      text = `${personName} deltog på ${trainingClass} den ${date}.`;
      if (event.balance_after !== null) {
        text += ` Saldo: ${event.balance_before} → ${event.balance_after} klip.`;
      }
    } else {
      switch (event.action_type) {
        case "attendance_removed":
          text = `Fremmødet for ${personName} blev fjernet fra ${trainingClass} den ${date}.`;
          break;
        case "payment_registered":
          text = `${personName} betalte ${Math.abs(Number(event.details.amount_ore ?? 37500)) / 100} kr. og fik ${event.balance_after} klip.`;
          break;
        case "payment_reversed":
          text = `Betalingen for ${personName} blev tilbageført.`;
          break;
        case "guest_created":
          text = `${personName} blev oprettet som gæst.`;
          break;
        case "guest_converted":
          text = `${personName} blev konverteret fra gæst til medlem.`;
          break;
        case "guest_conversion_reversed":
          text = `${personName} blev ændret tilbage til gæst.`;
          break;
        case "member_deactivated":
          text = `${personName} blev fjernet fra den aktive medlemsliste.`;
          break;
        case "member_reactivated":
          text = `${personName} blev genaktiveret som medlem.`;
          break;
        case "session_cancelled":
          text = `${trainingClass} den ${date} blev aflyst.`;
          break;
        case "session_reopened":
          if (event.details.old_status !== "aflyst") continue;
          text = `${trainingClass} den ${date} blev sat tilbage til planlagt.`;
          break;
        case "test_data_reset":
          text = "Alle testdata blev nulstillet.";
          break;
        default:
          continue;
      }
    }

    items.push({
      id: String(event.id),
      occurred_at: event.occurred_at,
      text,
    });
  }

  return NextResponse.json({ items: items.slice(0, 100) });
}
