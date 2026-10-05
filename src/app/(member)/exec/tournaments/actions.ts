"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireExec, requireAdmin } from "@/lib/session";
import { db, schema } from "@/db";
import { withTransaction } from "@/db/pool";
import {
  completeLeague,
  discardDraftDraw,
  discardPlayoffs,
  execSetResult,
  fillOpenSlot,
  generateDraftDraw,
  generatePlayoffs,
  publishDraw,
  seasonConfig,
  settleMatchTx,
  swapTeams,
  TournamentError,
  withdrawTeam,
  type ExecOutcome,
} from "@/lib/tournament";
import { execAddTeam, LeagueError, pairFreeAgents, randomPairFreeAgents } from "@/lib/league";
import { laDeadlineToUtc } from "@/lib/dates";
import { scheduleAnnouncedEmail, sendLateTeamSchedule, sendMany, type MatchLine } from "@/lib/email";
import { matchLabel, playoffRounds } from "@/lib/schedule";

export type ActionResult = { ok: boolean; error?: string; message?: string };

const FRIENDLY: Record<string, string> = {
  not_found: "That league (or team) no longer exists.",
  already_announced: "Pools are already published — the draft can't be changed anymore.",
  no_draft_draw: "Generate the draft draw first.",
  not_open: "This league has ended.",
  too_few_teams: "Need at least 2 complete teams (two confirmed players each) to make a draw.",
  incomplete_team: "That team still has an unanswered invite — it can't be scheduled until it's settled.",
  no_season: "Set the season start date and final date in Settings first.",
  season_started: "Week 1 would already be over — move the season start date in Settings.",
  same_team: "Pick a different team.",
  playoffs_started: "A playoff result is already in — the bracket is locked.",
  slot_taken: "That open slot was already filled.",
  not_in_season: "That only works while the round robin is being played.",
  already_scheduled: "That team is already on the schedule.",
  too_few_for_playoffs: "Fewer teams than playoff spots — lower the playoff size in Settings.",
  no_playoffs: "There's no playoff bracket to discard.",
  not_pending: "Only an unplayed match can be given another week.",
  teams_tbd: "Both teams aren't known yet.",
  bye: "That's a bye — there's no match to record.",
  next_round_played: "The next playoff round already has a result — change that one first.",
  no_double_forfeit_in_playoffs: "A playoff match needs a winner — award a forfeit to one side instead.",
};

/** Known failures become a readable message; anything unexpected is logged and still returns a message instead of crashing the page. */
function fail(e: unknown): ActionResult {
  if (e instanceof TournamentError && e.reason.startsWith("pool_unfinished:")) {
    const n = e.reason.split(":")[1];
    return { ok: false, error: `${n} round-robin match${n === "1" ? " is" : "es are"} still unsettled (unplayed, awaiting confirmation, or disputed). Settle them first — the cron settles unplayed ones Monday morning.` };
  }
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

const dateKey = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.");

const leagueSchema = z
  .object({
    name: z.string().trim().min(1, "Give the league a name.").max(120),
    division: z.enum(["beginner", "advanced", "competitive"]),
    eligibility: z.enum(["all", "competitive_only"]),
    location: z.string().trim().max(120),
    maxPlayers: optionalInt(2, 512),
    registrationClosesAt: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v), "Pick a valid date and time."),
    autoconfirmHours: z.coerce.number().int().min(1).max(168),
    seasonStartsOn: dateKey.refine((v) => new Date(`${v}T12:00:00Z`).getUTCDay() === 1, "The season has to start on a Monday."),
    roundRobinWeeks: z.coerce.number().int().min(1).max(15),
    catchupWeeks: z.coerce.number().int().min(0).max(3),
    playoffTeams: z.coerce.number().int().refine((n) => [2, 4, 8, 16].includes(n), "Playoffs are 2, 4, 8 or 16 teams."),
    finalOn: dateKey,
  })
  .superRefine((d, ctx) => {
    try {
      playoffRounds(d);
    } catch (e) {
      ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : "Those playoff dates don't fit.", path: ["playoffTeams"] });
    }
  });

function readLeague(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "");
  const parsed = leagueSchema.safeParse({
    name: get("name"),
    division: get("division"),
    eligibility: get("eligibility"),
    location: get("location"),
    maxPlayers: get("maxPlayers"),
    registrationClosesAt: get("registrationClosesAt"),
    autoconfirmHours: get("autoconfirmHours"),
    seasonStartsOn: get("seasonStartsOn"),
    roundRobinWeeks: get("roundRobinWeeks"),
    catchupWeeks: get("catchupWeeks"),
    playoffTeams: get("playoffTeams"),
    finalOn: get("finalOn"),
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
      // The input is Pacific wall-clock time — never `new Date(str)`, which would read it as UTC.
      registrationClosesAt: d.registrationClosesAt ? laDeadlineToUtc(d.registrationClosesAt) : null,
      autoconfirmHours: d.autoconfirmHours,
      seasonStartsOn: d.seasonStartsOn,
      roundRobinWeeks: d.roundRobinWeeks,
      catchupWeeks: d.catchupWeeks,
      playoffTeams: d.playoffTeams,
      finalOn: d.finalOn,
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

  const [current] = await db().select().from(schema.tournaments).where(eq(schema.tournaments.id, id.data));
  if (!current) return { ok: false, error: FRIENDLY.not_found };
  // Match deadlines are written when the schedule is drawn — moving week 1 afterwards would desync them.
  if (
    current.status !== "registration" &&
    (current.seasonStartsOn !== read.values.seasonStartsOn || current.roundRobinWeeks !== read.values.roundRobinWeeks)
  ) {
    return { ok: false, error: "The schedule is already drawn — discard the draft to change the start date or number of weeks." };
  }
  if (current.status === "knockout" && (current.playoffTeams !== read.values.playoffTeams || current.finalOn !== read.values.finalOn)) {
    return { ok: false, error: "The playoff bracket exists — discard it to change the playoff size or final date." };
  }

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

export async function generateDraft(tournamentId: string, openSlots: number): Promise<ActionResult> {
  await requireExec();
  if (!idSchema.safeParse(tournamentId).success) return { ok: false, error: FRIENDLY.not_found };
  if (!z.number().int().min(0).max(4).safeParse(openSlots).success) return { ok: false, error: "Open slots has to be 0–4." };
  try {
    const r = await generateDraftDraw(tournamentId, openSlots);
    refresh(tournamentId);
    return {
      ok: true,
      message: `Scheduled ${r.teamCount} teams over ${r.weeks} weeks${r.openSlots ? ` with ${r.openSlots} open slot${r.openSlots === 1 ? "" : "s"}` : " — no byes"}.`,
    };
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

const swapSchema = z.object({ teamId: z.uuid(), otherId: z.uuid() });

/** Swap two teams' places in the draft schedule (or the playoff bracket before it starts). */
export async function swap(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireExec();
  const parsed = swapSchema.safeParse({ teamId: formData.get("teamId"), otherId: formData.get("otherId") });
  if (!parsed.success) return { ok: false, error: "Pick a team to swap with." };
  try {
    await swapTeams(parsed.data.teamId, parsed.data.otherId);
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true };
}

const fillSchema = z.object({ placeholderId: z.uuid(), teamId: z.uuid() });

/** A late team takes over an open slot. Live, they're emailed their schedule from this week on. */
export async function fillSlot(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireExec();
  const parsed = fillSchema.safeParse({ placeholderId: formData.get("placeholderId"), teamId: formData.get("teamId") });
  if (!parsed.success) return { ok: false, error: "Pick a team." };

  let result;
  try {
    result = await fillOpenSlot(parsed.data.placeholderId, parsed.data.teamId);
  } catch (e) {
    return fail(e);
  }

  if (result.live) {
    const lines = await scheduleLinesFor(result.tournament.id, result.team.id);
    const players = await db()
      .select({ email: schema.users.email, name: schema.users.name })
      .from(schema.tmTeamMembers)
      .innerJoin(schema.users, eq(schema.tmTeamMembers.memberId, schema.users.id))
      .where(eq(schema.tmTeamMembers.teamId, result.team.id));
    for (const p of players) {
      await sendLateTeamSchedule(p, {
        tournamentName: result.tournament.name,
        teamName: result.team.name,
        weeks: lines,
        playoffTeams: result.tournament.playoffTeams,
      }).catch((err) => console.error("late-team schedule email failed", err));
    }
  }

  refresh(result.tournament.id);
  return { ok: true, message: `${result.team.name} took the slot — ${result.moved} match${result.moved === 1 ? "" : "es"}.` };
}

/** One team's upcoming round-robin matches as email lines. */
async function scheduleLinesFor(tournamentId: string, teamId: string): Promise<MatchLine[]> {
  const [tournament] = await db().select().from(schema.tournaments).where(eq(schema.tournaments.id, tournamentId));
  const season = seasonConfig(tournament);
  const teams = await db().select().from(schema.tmTeams).where(eq(schema.tmTeams.tournamentId, tournamentId));
  const matches = await db().select().from(schema.matches).where(eq(schema.matches.tournamentId, tournamentId));
  return matches
    .filter((m) => m.stage === "pool" && m.status === "pending" && (m.teamAId === teamId || m.teamBId === teamId))
    .sort((a, b) => (a.round ?? 0) - (b.round ?? 0))
    .map((m) => {
      const opp = teams.find((t) => t.id === (m.teamAId === teamId ? m.teamBId : m.teamAId));
      return {
        label: matchLabel(m, season),
        dueBy: m.dueBy!,
        opponent: opp && !opp.isPlaceholder ? { name: opp.name, players: [] } : null,
      };
    });
}

export async function randomPair(tournamentId: string): Promise<ActionResult> {
  await requireExec();
  if (!idSchema.safeParse(tournamentId).success) return { ok: false, error: FRIENDLY.not_found };
  try {
    const { pairs, leftover } = await randomPairFreeAgents(tournamentId);
    refresh(tournamentId);
    return {
      ok: true,
      message: `Paired ${pairs.length * 2} free agents into ${pairs.length} team${pairs.length === 1 ? "" : "s"}.${
        leftover ? " One player is left over — pair them with a late sign-up or withdraw them." : ""
      }`,
    };
  } catch (e) {
    return fail(e);
  }
}

const addTeamSchema = z.object({
  tournamentId: z.uuid(),
  teamName: z.string().trim().max(60, "Keep the team name under 60 characters."),
  emailA: z.email("Enter the first player's email."),
  emailB: z.email("Enter the second player's email."),
});

/** Add a complete team directly (late sign-up). They show up under "Not on the schedule" until placed in an open slot. */
export async function addTeam(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireExec();
  const parsed = addTeamSchema.safeParse({
    tournamentId: formData.get("tournamentId"),
    teamName: String(formData.get("teamName") ?? ""),
    emailA: String(formData.get("emailA") ?? "").trim(),
    emailB: String(formData.get("emailB") ?? "").trim(),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  try {
    const { teamName } = await execAddTeam(parsed.data);
    refresh(parsed.data.tournamentId);
    return { ok: true, message: `Added ${teamName}.` };
  } catch (e) {
    return fail(e);
  }
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
  const season = seasonConfig(result.tournament);
  const byId = new Map(result.teams.map((t) => [t.id, t]));
  const outbox = [];
  for (const team of result.teams) {
    if (team.isPlaceholder) continue;
    const weeks: MatchLine[] = result.matches
      .filter((m) => m.teamAId === team.id || m.teamBId === team.id)
      .sort((a, b) => (a.round ?? 0) - (b.round ?? 0))
      .map((m) => {
        const opp = byId.get((m.teamAId === team.id ? m.teamBId : m.teamAId) ?? "");
        return { label: matchLabel(m, season), dueBy: m.dueBy!, opponent: opp && !opp.isPlaceholder ? { name: opp.name, players: [] } : null };
      });
    for (const m of team.members) {
      if (m.inviteStatus !== "accepted" || !m.member.email) continue;
      outbox.push(
        scheduleAnnouncedEmail(
          { email: m.member.email, name: m.member.name ?? null },
          { tournamentName: result.tournament.name, teamName: team.name, weeks, playoffTeams: result.tournament.playoffTeams },
        ),
      );
    }
  }
  await sendMany(outbox);

  refresh(tournamentId);
  return { ok: true, message: `Published — emailed ${outbox.length} players their schedule.` };
}

export async function makePlayoffs(tournamentId: string): Promise<ActionResult> {
  await requireExec();
  if (!idSchema.safeParse(tournamentId).success) return { ok: false, error: FRIENDLY.not_found };
  try {
    const { seeds, tieAtCut } = await generatePlayoffs(tournamentId);
    refresh(tournamentId);
    return {
      ok: true,
      message: `Seeded the top ${seeds.length} into the bracket.${
        tieAtCut ? " Heads up: the last playoff spot was an unresolved tie — swap teams in the bracket if you decide differently." : ""
      } Teams see their matchup on the site right away.`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function scrapPlayoffs(tournamentId: string): Promise<ActionResult> {
  await requireExec();
  if (!idSchema.safeParse(tournamentId).success) return { ok: false, error: FRIENDLY.not_found };
  try {
    await discardPlayoffs(tournamentId);
  } catch (e) {
    return fail(e);
  }
  refresh(tournamentId);
  return { ok: true };
}

const resultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("score"), games: z.array(z.tuple([z.number(), z.number()])).min(2).max(3) }),
  z.object({ kind: z.literal("forfeit"), winner: z.enum(["A", "B"]) }),
  z.object({ kind: z.literal("double_forfeit") }),
  z.object({ kind: z.literal("reopen") }),
  z.object({ kind: z.literal("extend") }),
]);

/** Exec override on any match — the fix for "we did play", "they never responded", or a typo'd score. */
export async function setResult(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireExec();
  const matchId = z.uuid().safeParse(formData.get("matchId"));
  if (!matchId.success) return { ok: false, error: FRIENDLY.not_found };

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("outcome") ?? ""));
  } catch {
    return { ok: false, error: "Pick what happened." };
  }
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Enter the score for each game played." };

  try {
    await execSetResult(matchId.data, parsed.data as ExecOutcome, user.id);
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true, message: "Saved." };
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
    const found = await withTransaction(async (tx) => {
      const [report] = await tx.select().from(schema.matchReports).where(eq(schema.matchReports.id, parsed.data.reportId));
      if (!report) return false;
      const [match] = await tx.select().from(schema.matches).where(eq(schema.matches.id, report.matchId)).for("update");
      if (!match || (parsed.data.winnerTeamId !== match.teamAId && parsed.data.winnerTeamId !== match.teamBId)) return false;
      await tx
        .update(schema.matchReports)
        .set({ confirmedAt: new Date(), winnerTeamId: parsed.data.winnerTeamId })
        .where(eq(schema.matchReports.id, report.id));
      await settleMatchTx(tx, match, "confirmed", parsed.data.winnerTeamId);
      return true;
    });
    if (!found) return { ok: false, error: "That report no longer exists." };
  } catch (e) {
    return fail(e);
  }

  refresh();
  return { ok: true };
}
