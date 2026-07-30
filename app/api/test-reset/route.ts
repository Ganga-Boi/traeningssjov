import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function matchesSecret(value: string, expected: string) {
  const provided = Buffer.from(value);
  const configured = Buffer.from(expected);
  return provided.length === configured.length
    && timingSafeEqual(provided, configured);
}

export async function POST(request: Request) {
  if (process.env.TEST_MODE !== "true") {
    return NextResponse.json({ error: "Test-reset er deaktiveret." }, { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resetToken = process.env.TEST_RESET_TOKEN;

  if (!supabaseUrl || !serviceRoleKey || !resetToken) {
    return NextResponse.json({ error: "Test-reset er ikke konfigureret." }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : "";

  if (!matchesSecret(token, resetToken)) {
    return NextResponse.json({ error: "Forkert testkode." }, { status: 403 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await supabase.rpc("reset_all_test_data", {
    p_confirmation: "NULSTIL ALLE TESTDATA",
  });

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ result: result.data });
}
