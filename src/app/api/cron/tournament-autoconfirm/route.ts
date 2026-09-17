import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { autoConfirmDueMatchReports } from "@/lib/social-league";

/** Hit hourly by an external scheduler — see DEPLOY.md. Same CRON_SECRET as the other cron routes. */
export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  const provided = request.headers.get("authorization");

  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const result = await autoConfirmDueMatchReports();
  return NextResponse.json({ ok: true, ...result });
}
