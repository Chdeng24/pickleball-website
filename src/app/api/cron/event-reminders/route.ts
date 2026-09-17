import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sendDueEventReminders } from "@/lib/reminders";

/**
 * Hit on a schedule by an external trigger (see DEPLOY.md) — Cloudflare Workers
 * doesn't run this app's own cron here, so something outside the app has to
 * call it periodically. Protected by CRON_SECRET so it can't be triggered (or
 * discovered) by anyone else; sendDueEventReminders() is itself idempotent,
 * so being hit more than once an hour is harmless, never a double-send.
 */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  const provided = request.headers.get("authorization");

  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await sendDueEventReminders();
  return NextResponse.json({ ok: true, ...result });
}
