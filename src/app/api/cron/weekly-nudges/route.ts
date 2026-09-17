import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sendWeeklySocialLeagueNudges } from "@/lib/social-league";

/** Hit once a week (Sunday) by an external scheduler — see DEPLOY.md. Same CRON_SECRET as the other cron routes. */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  const provided = request.headers.get("authorization");

  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await sendWeeklySocialLeagueNudges();
  return NextResponse.json({ ok: true, ...result });
}
