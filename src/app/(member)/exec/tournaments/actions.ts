"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireExec, requireAdmin } from "@/lib/session";
import { db, schema } from "@/db";
import { generateDraftDraw, moveTeamPool, withdrawTeam, publishDraw, TournamentError } from "@/lib/tournament";
import { sendPoolsAnnounced } from "@/lib/email";

export type ActionResult = { ok: boolean; error?: string };

const FRIENDLY: Record<string, string> = {
  not_found: "That tournament (or team) no longer exists.",
  already_announced: "Pools are already published — draft editing is closed.",
  no_draft_draw: "Generate the draft draw before publishing it.",
};

function friendly(e: unknown): string {
  if (e instanceof TournamentError) return FRIENDLY[e.reason] ?? e.reason;
  throw e;
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  division: z.enum(["beginner", "advanced"]),
  eligibility: z.enum(["all", "competitive_only"]),
  poolSize: z.coerce.number().int().min(3).max(16),
  advancePerPool: z.coerce.number().int().min(1).max(8),
  registrationClosesAt: z.string().optional(),
  autoconfirmHours: z.coerce.number().int().min(1).max(168),
});

export async function createSocialLeagueTournament(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  await requireExec();

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  await db()
    .insert(schema.tournaments)
    .values({
      name: d.name,
      kind: "im_semester",
      division: d.division,
      eligibility: d.eligibility,
      poolSize: d.poolSize,
      advancePerPool: d.advancePerPool,
      autoconfirmHours: d.autoconfirmHours,
      registrationClosesAt: d.registrationClosesAt ? new Date(d.registrationClosesAt) : null,
      status: "registration",
    });

  revalidatePath("/exec/tournaments");
  return { ok: true };
}

export async function generateDraft(tournamentId: string): Promise<ActionResult> {
  await requireExec();
  try {
    await generateDraftDraw(tournamentId);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  revalidatePath(`/exec/tournaments/${tournamentId}`);
  return { ok: true };
}

const movePoolSchema = z.object({ teamId: z.uuid(), pool: z.string().trim().min(1).max(4) });

export async function moveTeam(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireExec();
  const parsed = movePoolSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Invalid pool." };

  try {
    await moveTeamPool(parsed.data.teamId, parsed.data.pool.toUpperCase());
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  revalidatePath("/exec/tournaments");
  return { ok: true };
}

export async function withdraw(teamId: string): Promise<ActionResult> {
  await requireExec();
  try {
    await withdrawTeam(teamId);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
  revalidatePath("/exec/tournaments");
  return { ok: true };
}

export async function publish(tournamentId: string): Promise<ActionResult> {
  await requireExec();

  let result;
  try {
    result = await publishDraw(tournamentId);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }

  for (const team of result.teams) {
    const opponents = result.teams.filter((t) => t.pool === team.pool && t.id !== team.id);
    for (const m of team.members) {
      if (!m.member.email) continue;
      await sendPoolsAnnounced(
        { email: m.member.email, name: m.member.name ?? null },
        {
          tournamentName: result.tournament.name,
          teamName: team.name,
          pool: team.pool ?? "?",
          opponents: opponents.map((o) => o.name),
        },
      ).catch((err) => console.error("pools-announced email failed", err));
    }
  }

  revalidatePath("/exec/tournaments");
  return { ok: true };
}

const resolveSchema = z.object({ reportId: z.uuid(), winnerTeamId: z.uuid() });

/** Admin-only per TASKS.md F4 — a disputed score is decided by an admin, not exec. */
export async function resolveDispute(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = resolveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const [report] = await db()
    .select()
    .from(schema.matchReports)
    .where(eq(schema.matchReports.id, parsed.data.reportId));
  if (!report) return { ok: false, error: "That report no longer exists." };

  await db()
    .update(schema.matchReports)
    .set({ confirmedAt: new Date(), winnerTeamId: parsed.data.winnerTeamId })
    .where(eq(schema.matchReports.id, report.id));

  await db()
    .update(schema.matches)
    .set({ status: "confirmed", winnerTeamId: parsed.data.winnerTeamId })
    .where(eq(schema.matches.id, report.matchId));

  revalidatePath("/exec/tournaments");
  return { ok: true };
}
