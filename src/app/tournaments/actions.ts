"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { requireMember } from "@/lib/session";
import { db, schema } from "@/db";
import { withTransaction } from "@/db/pool";
import { checkMatchScore } from "@/lib/matchscore";
import { AlreadyDone, invitePartner, leaveLeague, LeagueError, registerForLeague, respondToInvite } from "@/lib/league";
import { outOfTownEmail, sendMany, sendPartnerInvite, sendScoreReported } from "@/lib/email";
import { laInputToUtc } from "@/lib/dates";
import { outOfTownProblem, postTimeProblem, regularSeasonEndsAt, shiftDeadline } from "@/lib/schedule";
import { MAKEUP_RESET, seasonConfig, settleMatchTx } from "@/lib/tournament";

export type ActionResult = { ok: boolean; error?: string; message?: string };

class ActionError extends Error {}

/** Known failures come back as a readable message; anything unexpected is logged and still returns one instead of an error page. */
function fail(e: unknown): ActionResult {
  if (e instanceof AlreadyDone) {
    refresh();
    return { ok: true, message: e.message };
  }
  if (e instanceof LeagueError || e instanceof ActionError) return { ok: false, error: e.message };
  console.error("league action failed", e);
  return { ok: false, error: "Something went wrong — nothing was saved. Try again." };
}

function refresh() {
  revalidatePath("/tournaments");
  revalidatePath("/dashboard");
}

const registerSchema = z.object({
  tournamentId: z.uuid(),
  teamName: z.string().trim().max(60, "Keep the team name under 60 characters."),
  partnerEmail: z.union([z.literal(""), z.email("That partner email doesn't look right.")]),
});

export async function registerTeam(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = registerSchema.safeParse({
    tournamentId: formData.get("tournamentId"),
    teamName: String(formData.get("teamName") ?? ""),
    partnerEmail: String(formData.get("partnerEmail") ?? "").trim(),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  let result;
  try {
    result = await registerForLeague({
      tournamentId: parsed.data.tournamentId,
      userId: user.id,
      teamName: parsed.data.teamName,
      partnerEmail: parsed.data.partnerEmail,
    });
  } catch (e) {
    return fail(e);
  }

  // After commit — a failed email never undoes a registration. The invite also shows on their Tournaments tab.
  if (result.partner) {
    await sendPartnerInvite(
      { email: result.partner.email, name: result.partner.name },
      {
        captainName: result.captain.name,
        tournamentName: result.league.name,
        teamName: result.teamName,
        location: result.league.location,
        registrationClosesAt: result.league.registrationClosesAt,
      },
    ).catch((err) => console.error("partner invite email failed", err));
  }

  refresh();
  return {
    ok: true,
    message: result.partner
      ? `You're in! Your partner has to accept before your team is complete.`
      : `You're in! Add a partner anytime before registration closes, or exec will pair you.`,
  };
}

const inviteSchema = z.object({
  teamId: z.uuid(),
  partnerEmail: z.email("Enter your partner's email."),
});

export async function invitePartnerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = inviteSchema.safeParse({
    teamId: formData.get("teamId"),
    partnerEmail: String(formData.get("partnerEmail") ?? "").trim(),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  let result;
  try {
    result = await invitePartner({ teamId: parsed.data.teamId, userId: user.id, partnerEmail: parsed.data.partnerEmail });
  } catch (e) {
    return fail(e);
  }

  await sendPartnerInvite(
    { email: result.partner.email, name: result.partner.name },
    {
      captainName: result.captain.name,
      tournamentName: result.league.name,
      teamName: result.teamName,
      location: result.league.location,
      registrationClosesAt: result.league.registrationClosesAt,
    },
  ).catch((err) => console.error("partner invite email failed", err));

  refresh();
  return { ok: true, message: "Invite sent." };
}

const teamIdSchema = z.uuid();

export async function respondToInviteAction(teamId: string, accept: boolean): Promise<ActionResult> {
  const user = await requireMember();
  if (!teamIdSchema.safeParse(teamId).success || typeof accept !== "boolean") {
    return { ok: false, error: "That invite is no longer open." };
  }
  try {
    await respondToInvite({ teamId, userId: user.id, accept });
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true };
}

export async function leaveLeagueAction(teamId: string): Promise<ActionResult> {
  const user = await requireMember();
  if (!teamIdSchema.safeParse(teamId).success) return { ok: false, error: "That team no longer exists." };
  try {
    await leaveLeague({ teamId, userId: user.id });
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true };
}

/* ── scores ───────────────────────────────────────────────────────────── */

const reportSchema = z.object({
  matchId: z.uuid(),
  games: z.array(z.tuple([z.number(), z.number()])).min(1).max(5),
});

/** Confirmed players on the given teams, with contact info for notifications. */
async function matchPlayers(teamIds: string[]) {
  return db()
    .select({
      teamId: schema.tmTeamMembers.teamId,
      memberId: schema.tmTeamMembers.memberId,
      email: schema.users.email,
      name: schema.users.name,
    })
    .from(schema.tmTeamMembers)
    .innerJoin(schema.users, eq(schema.tmTeamMembers.memberId, schema.users.id))
    .where(and(inArray(schema.tmTeamMembers.teamId, teamIds), eq(schema.tmTeamMembers.inviteStatus, "accepted")));
}

export async function reportScore(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("games") ?? ""));
  } catch {
    return { ok: false, error: "Enter the score for each game." };
  }
  const parsed = reportSchema.safeParse({ matchId: formData.get("matchId"), games: raw });
  if (!parsed.success) return { ok: false, error: "Enter the score for each game." };

  const check = checkMatchScore(parsed.data.games);
  if (!check.ok) return { ok: false, error: check.error };

  let notify: { email: string; name: string | null }[] = [];
  let tournamentName = "your league";
  try {
    await withTransaction(async (tx) => {
      const [match] = await tx
        .select()
        .from(schema.matches)
        .where(eq(schema.matches.id, parsed.data.matchId))
        .for("update");
      if (!match || !match.teamAId || !match.teamBId) throw new ActionError("This match isn't set yet — the other team is still TBD.");
      if (match.status !== "pending") throw new ActionError("This match already has a result.");
      const sides = await tx
        .select({ isPlaceholder: schema.tmTeams.isPlaceholder })
        .from(schema.tmTeams)
        .where(inArray(schema.tmTeams.id, [match.teamAId, match.teamBId]));
      if (sides.some((t) => t.isPlaceholder)) throw new ActionError("That's a bye week — there's no match to report.");

      const [tournament] = await tx.select().from(schema.tournaments).where(eq(schema.tournaments.id, match.tournamentId));
      if (!tournament?.poolsAnnouncedAt || tournament.status === "complete") {
        throw new ActionError("Scores can only be reported while the league is being played.");
      }

      const players = await matchPlayers([match.teamAId, match.teamBId]);
      if (!players.some((p) => p.memberId === user.id)) throw new ActionError("You're not playing in this match.");

      await tx.insert(schema.matchReports).values({
        matchId: match.id,
        reportedBy: user.id,
        games: parsed.data.games,
        winnerTeamId: check.winner === "A" ? match.teamAId : match.teamBId,
      });
      await tx.update(schema.matches).set({ status: "reported" }).where(eq(schema.matches.id, match.id));

      tournamentName = tournament.name;
      notify = players.filter((p) => p.memberId !== user.id);
    });
  } catch (e) {
    return fail(e);
  }

  const summary = parsed.data.games.map(([a, b]) => `${a}-${b}`).join(", ");
  for (const p of notify) {
    await sendScoreReported(
      { email: p.email, name: p.name },
      { tournamentName, reporterName: user.name ?? null, summary },
    ).catch((err) => console.error("score-reported email failed", err));
  }

  refresh();
  return { ok: true, message: "Score submitted — the other team can confirm it, or it confirms automatically unless disputed." };
}

/** The other team agrees with the reported score — confirms it now instead of waiting out the dispute window. */
export async function confirmScore(matchId: string): Promise<ActionResult> {
  const user = await requireMember();
  if (!z.uuid().safeParse(matchId).success) return { ok: false, error: "That match no longer exists." };

  try {
    await withTransaction(async (tx) => {
      const [match] = await tx.select().from(schema.matches).where(eq(schema.matches.id, matchId)).for("update");
      if (match?.status === "confirmed") throw new AlreadyDone("Score confirmed.");
      if (!match || match.status !== "reported" || !match.teamAId || !match.teamBId) {
        throw new ActionError("There's no reported score to confirm on this match.");
      }
      const players = await matchPlayers([match.teamAId, match.teamBId]);
      const me = players.find((p) => p.memberId === user.id);
      if (!me) throw new ActionError("You're not playing in this match.");

      const [report] = await tx.select().from(schema.matchReports).where(eq(schema.matchReports.matchId, match.id));
      if (!report || report.confirmedAt || report.disputedBy) throw new ActionError("That score can't be confirmed anymore.");
      const reporterTeam = players.find((p) => p.memberId === report.reportedBy)?.teamId;
      if (reporterTeam === me.teamId) throw new ActionError("The other team has to confirm your score.");

      await tx.update(schema.matchReports).set({ confirmedAt: new Date() }).where(eq(schema.matchReports.id, report.id));
      await settleMatchTx(tx, match, "confirmed", report.winnerTeamId);
    });
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true, message: "Score confirmed." };
}

/**
 * "We can't make it this week" (sick, out of town): the match becomes a makeup due next Saturday.
 * Once per match, round robin only. If the makeup isn't played, the team that
 * asked forfeits it (src/lib/schedule.ts overdueOutcome).
 */
export async function markOutOfTown(matchId: string): Promise<ActionResult> {
  const user = await requireMember();
  if (!z.uuid().safeParse(matchId).success) return { ok: false, error: "That match no longer exists." };

  let notify: { email: string; name: string | null }[] = [];
  let mail: { tournamentName: string; requestingTeam: string; otherTeam: string; newDueBy: Date } | null = null;
  try {
    await withTransaction(async (tx) => {
      const [match] = await tx.select().from(schema.matches).where(eq(schema.matches.id, matchId)).for("update");
      if (!match || !match.teamAId || !match.teamBId) throw new ActionError("That match no longer exists.");
      const [tournament] = await tx.select().from(schema.tournaments).where(eq(schema.tournaments.id, match.tournamentId));
      if (!tournament?.poolsAnnouncedAt || tournament.status === "complete") throw new ActionError("The league isn't being played right now.");

      const players = await matchPlayers([match.teamAId, match.teamBId]);
      const me = players.find((p) => p.memberId === user.id);
      if (!me) throw new ActionError("You're not playing in this match.");
      if (match.extendedForTeamId === me.teamId) throw new AlreadyDone("Already marked — it's a makeup next week.");

      const problem = outOfTownProblem(match, new Date(), regularSeasonEndsAt(seasonConfig(tournament)));
      if (problem) throw new ActionError(problem);

      const newDueBy = shiftDeadline(match.dueBy!, 1);
      await tx
        .update(schema.matches)
        .set({ dueBy: newDueBy, extendedForTeamId: me.teamId, ...MAKEUP_RESET })
        .where(eq(schema.matches.id, match.id));

      const names = await tx
        .select({ id: schema.tmTeams.id, name: schema.tmTeams.name })
        .from(schema.tmTeams)
        .where(inArray(schema.tmTeams.id, [match.teamAId, match.teamBId]));
      const otherId = me.teamId === match.teamAId ? match.teamBId : match.teamAId;
      mail = {
        tournamentName: tournament.name,
        requestingTeam: names.find((t) => t.id === me.teamId)?.name ?? "A team",
        otherTeam: names.find((t) => t.id === otherId)?.name ?? "their opponent",
        newDueBy,
      };
      notify = players.filter((p) => p.memberId !== user.id);
    });
  } catch (e) {
    return fail(e);
  }

  if (mail) await sendMany(notify.map((p) => outOfTownEmail(p, mail!)));
  refresh();
  return { ok: true, message: "Done — it's now a makeup due next Saturday. Your opponents were emailed." };
}

const postTimeSchema = z.object({
  matchId: z.uuid(),
  when: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a day and time."),
  note: z.string().trim().max(80, "Keep the note short."),
});

/** "We're playing Thursday 7 PM, Court 3" — due Wednesday 11:59 PM each week. Any of the four players; posting again updates it. */
export async function postMatchTime(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = postTimeSchema.safeParse({
    matchId: formData.get("matchId"),
    when: String(formData.get("when") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  // The input is Pacific wall-clock time — never `new Date(str)`.
  const when = laInputToUtc(parsed.data.when);

  try {
    await withTransaction(async (tx) => {
      const [match] = await tx.select().from(schema.matches).where(eq(schema.matches.id, parsed.data.matchId)).for("update");
      if (!match || !match.teamAId || !match.teamBId) throw new ActionError("This match isn't set yet — the other team is still TBD.");
      const players = await matchPlayers([match.teamAId, match.teamBId]);
      if (!players.some((p) => p.memberId === user.id)) throw new ActionError("You're not playing in this match.");
      const problem = postTimeProblem(match, when);
      if (problem) throw new ActionError(problem);
      await tx
        .update(schema.matches)
        .set({ scheduledAt: when, scheduledNote: parsed.data.note || null, scheduledBy: user.id })
        .where(eq(schema.matches.id, match.id));
    });
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true, message: "Match time posted." };
}

const disputeSchema = z.object({ matchId: z.uuid(), reason: z.string().trim().min(1, "Say what's wrong.").max(500) });

export async function disputeScore(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = disputeSchema.safeParse({ matchId: formData.get("matchId"), reason: formData.get("reason") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withTransaction(async (tx) => {
      const [match] = await tx
        .select()
        .from(schema.matches)
        .where(eq(schema.matches.id, parsed.data.matchId))
        .for("update");
      if (!match || match.status !== "reported" || !match.teamAId || !match.teamBId) {
        throw new ActionError("There's no reported score to dispute on this match.");
      }

      const players = await matchPlayers([match.teamAId, match.teamBId]);
      if (!players.some((p) => p.memberId === user.id)) throw new ActionError("You're not playing in this match.");

      const [report] = await tx.select().from(schema.matchReports).where(eq(schema.matchReports.matchId, match.id));
      if (!report || report.confirmedAt) throw new ActionError("That score is already confirmed.");
      if (report.reportedBy === user.id) throw new ActionError("You can't dispute your own report.");

      await tx
        .update(schema.matchReports)
        .set({ disputedBy: user.id, disputeReason: parsed.data.reason })
        .where(eq(schema.matchReports.id, report.id));
      await tx.update(schema.matches).set({ status: "disputed" }).where(eq(schema.matches.id, match.id));
    });
  } catch (e) {
    return fail(e);
  }

  refresh();
  return { ok: true, message: "Disputed — an admin will sort it out." };
}
