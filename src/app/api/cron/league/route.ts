import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runLeagueTick } from "@/lib/social-league";

/**
 * Hit hourly by the "Hourly reminders" GitHub Actions workflow — see DEPLOY.md.
 * Auto-confirms scores, settles unreported matches, and sends the Monday
 * matchup and Thursday unreported-score emails. Safe to call any number of times.
 */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  const provided = request.headers.get("authorization");

  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await runLeagueTick();
  return NextResponse.json({ ok: true, ...result });
}
