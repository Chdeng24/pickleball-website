"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireExec, requireAdmin } from "@/lib/session";
import { db, schema } from "@/db";
import {
  completeLeague,
  discardDraftDraw,
  generateDraftDraw,
  moveTeamPool,
  publishDraw,
  TournamentError,
  withdrawTeam,
} from "@/lib/tournament";
import { LeagueError, pairFreeAgents } from "@/lib/league";
import { laDeadlineToUtc } from "@/lib/dates";
import { sendPoolsAnnounced } from "@/lib/email";

export type ActionResult = { ok: boolean; error?: string; message?: string };

const FRIENDLY: Record<string, string> = {
  not_found: "That league (or team) no longer exists.",
  already_announced: "Pools are already published — the draft can't be changed anymore.",
  no_draft_draw: "Generate the draft draw first.",
  not_open: "This league has ended.",
  too_few_teams: "Need at least 2 complete teams (two confirmed players each) to make a draw.",
  incomplete_team: "Only teams with two confirmed players can go in a pool.",
};

/** Known failures become a readable message; anything unexpected is logged and still returns a message instead of crashing the page. */
function fail(e: unknown): ActionResult {
  if (e instanceof TournamentError) return { ok: false, error: FRIENDLY[e.reason] ?? e.reason };
  if (e instanceof LeagueError) return { ok: false, error: e.message };
  console.error("league exec action failed", e);
  return { ok: false, error: "Something went wrong — nothing was changed. Try again." };
}

function refresh(tournamentId?: string) {
  revalidatePath("/exec/tournaments");
  if (tournamentId) revalidatePath(`/exec/tournaments/${tournamentId}`);
  revalidatePath("/tournaments");
  revalidatePath("/dashboard");
}

const optionalInt = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(z.number().int().min(min).max(max).nullable());

const leagueSchema = z
  .object({
    name: z.string().trim().min(1, "Give the league a name.").max(120),
    division: z.enum(["beginner", "advanced", "competitive"]),
    eligibility: z.enum(["all", "competitive_only"]),
    location: z.string().trim().max(120),
    maxPlayers: optionalInt(2, 512),
    poolSize: z.coerce.number().int().min(3).max(16),
    advancePerPool: z.coerce.number().int().min(1).max(8),
    registrationClosesAt: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v), "Pick a valid date and time."),
    autoconfirmHours: z.coerce.number().int().min(1).max(168),
  })
  .refine((d) => d.advancePerPool < d.poolSize, {
    message: "Teams moving up per pool has to be less than the pool size.",
    path: ["advancePerPool"],
  });

function readLeague(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "");
  const parsed = leagueSchema.safeParse({
    name: get("name"),
    division: get("division"),
    eligibility: get("eligibility"),
    location: get("location"),
    maxPlayers: get("maxPlayers"),
    poolSize: get("poolSize"),
    advancePerPool: get("advancePerPool"),
    registrationClosesAt: get("registrationClosesAt"),
    autoconfirmHours: get("autoconfirmHours"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." } as const;
  const d = parsed.data;
  return {
    values: {
      name: d.name,
      division: d.division,
      eligibility: d.eligibility,
      location: d.location || null,
      maxPlayers: d.maxPlayers,
      poolSize: d.poolSize,
      advancePerPool: d.advancePerPool,
      // The input is Pacific wall-clock time — never `new Date(str)`, which would read it as UTC.
      registrationClosesAt: d.registrationClosesAt ? laDeadlineToUtc(d.registrationClosesAt) : null,
      autoconfirmHours: d.autoconfirmHours,
    },
  } as const;
}

export async function createLeague(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireExec();
  const read = readLeague(formData);
  if ("error" in read) return { ok: false, error: read.error };

  try {
    await db()
      .insert(schema.tournaments)
      .values({ ...read.values, kind: "im_semester", status: "registration" });
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true, message: "League created — registration is open." };
}

export async function updateLeague(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireExec();
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Missing league." };
  const read = readLeague(formData);
  if ("error" in read) return { ok: false, error: read.error };

  try {
    const updated = await db()
      .update(schema.tournaments)
      .set(read.values)
      .where(eq(schema.tournaments.id, id.data))
      .returning({ id: schema.tournaments.id });
    if (updated.length === 0) return { ok: false, error: FRIENDLY.not_found };
  } catch (e) {
    return fail(e);
  }
  refresh(id.data);
  return { ok: true, message: "Saved." };
}

const idSchema = z.uuid();

export async function generateDraft(tournamentId: string): Promise<ActionResult> {
  await requireExec();
  if (!idSchema.safeParse(tournamentId).success) return { ok: false, error: FRIENDLY.not_found };
  try {
    const { poolCount, teamCount } = await generateDraftDraw(tournamentId);
    refresh(tournamentId);
    return { ok: true, message: `Drew ${teamCount} teams into ${poolCount} pool${poolCount === 1 ? "" : "s"}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function discardDraft(tournamentId: string): Promise<ActionResult> {
  await requireExec();
  if (!idSchema.safeParse(tournamentId).success) return { ok: false, error: FRIENDLY.not_found };
  try {
    await discardDraftDraw(tournamentId);
  } catch (e) {
    return fail(e);
  }
  refresh(tournamentId);
  return { ok: true };
}

const movePoolSchema = z.object({ teamId: z.uuid(), pool: z.string().trim().regex(/^[A-Za-z]{1,2}$/) });

export async function moveTeam(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireExec();
  const parsed = movePoolSchema.safeParse({ teamId: formData.get("teamId"), pool: formData.get("pool") });
  if (!parsed.success) return { ok: false, error: "Pick a pool." };
  try {
    await moveTeamPool(parsed.data.teamId, parsed.data.pool.toUpperCase());
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true };
}

export async function withdraw(teamId: string): Promise<ActionResult> {
  await requireExec();
  if (!idSchema.safeParse(teamId).success) return { ok: false, error: FRIENDLY.not_found };
  try {
    await withdrawTeam(teamId);
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true };
}

const pairSchema = z.object({ teamAId: z.uuid(), teamBId: z.uuid() });

export async function pairTeams(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireExec();
  const parsed = pairSchema.safeParse({ teamAId: formData.get("teamAId"), teamBId: formData.get("teamBId") });
  if (!parsed.success) return { ok: false, error: "Pick a player to pair with." };
  try {
    await pairFreeAgents(parsed.data);
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true };
}

export async function publish(tournamentId: string): Promise<ActionResult> {
  await requireExec();
  if (!idSchema.safeParse(tournamentId).success) return { ok: false, error: FRIENDLY.not_found };

  let result;
  try {
    result = await publishDraw(tournamentId);
  } catch (e) {
    return fail(e);
  }

  // Emails go out after the draw is committed — a failed send never un-publishes it.
  for (const team of result.teams) {
    const opponents = result.teams.filter((t) => t.pool === team.pool && t.id !== team.id);
    for (const m of team.members) {
      if (m.inviteStatus !== "accepted" || !m.member.email) continue;
      await sendPoolsAnnounced(
        { email: m.member.email, name: m.member.name ?? null },
        {
          tournamentName: result.tournament.name,
          teamName: team.name,
          pool: team.pool ?? "?",
          opponents: opponents.map((o) => o.name),
          location: result.tournament.location,
          advancePerPool: result.tournament.advancePerPool,
        },
      ).catch((err) => console.error("pools-announced email failed", err));
    }
  }

  refresh(tournamentId);
  return { ok: true };
}

export async function endLeague(tournamentId: string): Promise<ActionResult> {
  await requireExec();
  if (!idSchema.safeParse(tournamentId).success) return { ok: false, error: FRIENDLY.not_found };
  try {
    await completeLeague(tournamentId);
  } catch (e) {
    return fail(e);
  }
  refresh(tournamentId);
  return { ok: true };
}

const resolveSchema = z.object({ reportId: z.uuid(), winnerTeamId: z.uuid() });

/** Admin-only per TASKS.md F4 — a disputed score is decided by an admin, not exec. */
export async function resolveDispute(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const parsed = resolveSchema.safeParse({ reportId: formData.get("reportId"), winnerTeamId: formData.get("winnerTeamId") });
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  try {
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
  } catch (e) {
    return fail(e);
  }

  refresh();
  return { ok: true };
}
