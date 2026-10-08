import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema } from "@/db";
import type { Tx } from "@/db/pool";
import { AlreadyDone, LeagueError } from "@/lib/league";
import { checkMatchScore, type GameScore } from "@/lib/matchscore";
import { postTimeProblem, regularSeasonEndsAt, shiftDeadline, skipDecision } from "@/lib/schedule";
import { MAKEUP_RESET, seasonConfig, settleMatchTx } from "@/lib/tournament";

/**
 * What a player can do to one match: report, confirm, dispute, post a time,
 * skip it (one makeup per team per season, forfeits after that) — plus the
 * admin's dispute ruling. Each runs inside a
 * caller-supplied transaction so the server actions stay thin and the rules
 * are exercised against the real DB in `npm run test:season`.
 *
 * Failures throw LeagueError (a readable message) or AlreadyDone (a harmless
 * repeat, reported as success).
 */

type Player = { teamId: string; memberId: string; email: string; name: string | null };

/** Confirmed players on the given teams, with contact info. */
export async function matchPlayersTx(tx: Tx, teamIds: string[]): Promise<Player[]> {
  return tx
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

/** Locks the match and checks it's a real, live match this user plays in. */
async function myMatch(tx: Tx, matchId: string, userId: string) {
  const [match] = await tx.select().from(schema.matches).where(eq(schema.matches.id, matchId)).for("update");
  if (!match) throw new LeagueError("That match no longer exists.");
  if (!match.teamAId || !match.teamBId) throw new LeagueError("This match isn't set yet — the other team is still TBD.");

  const sides = await tx
    .select({ isPlaceholder: schema.tmTeams.isPlaceholder })
    .from(schema.tmTeams)
    .where(inArray(schema.tmTeams.id, [match.teamAId, match.teamBId]));
  if (sides.some((t) => t.isPlaceholder)) throw new LeagueError("That's a bye week — there's no match to play.");

  const [tournament] = await tx.select().from(schema.tournaments).where(eq(schema.tournaments.id, match.tournamentId));
  if (!tournament?.poolsAnnouncedAt || tournament.status === "complete") {
    throw new LeagueError("The league isn't being played right now.");
  }

  const players = await matchPlayersTx(tx, [match.teamAId, match.teamBId]);
  const me = players.find((p) => p.memberId === userId);
  if (!me) throw new LeagueError("You're not playing in this match.");
  return { match, tournament, players, me };
}

export async function reportScoreTx(tx: Tx, input: { userId: string; matchId: string; games: GameScore[] }) {
  const check = checkMatchScore(input.games);
  if (!check.ok) throw new LeagueError(check.error);

  const { match, tournament, players } = await myMatch(tx, input.matchId, input.userId);
  if (match.status !== "pending") throw new LeagueError("This match already has a result.");

  await tx.insert(schema.matchReports).values({
    matchId: match.id,
    reportedBy: input.userId,
    games: input.games,
    winnerTeamId: check.winner === "A" ? match.teamAId! : match.teamBId!,
  });
  await tx.update(schema.matches).set({ status: "reported" }).where(eq(schema.matches.id, match.id));
  return { tournamentName: tournament.name, notify: players.filter((p) => p.memberId !== input.userId) };
}

/** The other team agrees with the reported score — confirms it now instead of waiting out the dispute window. */
export async function confirmScoreTx(tx: Tx, input: { userId: string; matchId: string }) {
  const [peek] = await tx.select({ status: schema.matches.status }).from(schema.matches).where(eq(schema.matches.id, input.matchId));
  if (peek?.status === "confirmed") throw new AlreadyDone("Score confirmed.");

  const { match, players, me } = await myMatch(tx, input.matchId, input.userId);
  if (match.status !== "reported") throw new LeagueError("There's no reported score to confirm on this match.");
  const [report] = await tx.select().from(schema.matchReports).where(eq(schema.matchReports.matchId, match.id));
  if (!report || report.confirmedAt || report.disputedBy) throw new LeagueError("That score can't be confirmed anymore.");
  if (players.find((p) => p.memberId === report.reportedBy)?.teamId === me.teamId) {
    throw new LeagueError("The other team has to confirm your score.");
  }

  await tx.update(schema.matchReports).set({ confirmedAt: new Date() }).where(eq(schema.matchReports.id, report.id));
  await settleMatchTx(tx, match, "confirmed", report.winnerTeamId);
}

/** The other team says the reported score is wrong — it goes to an admin. */
export async function disputeScoreTx(tx: Tx, input: { userId: string; matchId: string; reason: string }) {
  const { match, players, me } = await myMatch(tx, input.matchId, input.userId);
  if (match.status !== "reported") throw new LeagueError("There's no reported score to dispute on this match.");
  const [report] = await tx.select().from(schema.matchReports).where(eq(schema.matchReports.matchId, match.id));
  if (!report || report.confirmedAt) throw new LeagueError("That score is already confirmed.");
  if (players.find((p) => p.memberId === report.reportedBy)?.teamId === me.teamId) {
    throw new LeagueError("You can't dispute your own team's report.");
  }

  await tx
    .update(schema.matchReports)
    .set({ disputedBy: input.userId, disputeReason: input.reason })
    .where(eq(schema.matchReports.id, report.id));
  await tx.update(schema.matches).set({ status: "disputed" }).where(eq(schema.matches.id, match.id));
}

/** How many skips (makeups) a team has used this season. */
export async function skipsUsedTx(tx: Tx, tournamentId: string, teamId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.matches)
    .where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.extendedForTeamId, teamId)));
  return row?.n ?? 0;
}

/**
 * "We can't make it this week" (sick, out of town). The team's first skip of
 * the season turns the match into a makeup due a week later; every skip
 * after that — or not making their own makeup, or a week with no makeup week
 * left — is an immediate forfeit to the other team. See schedule.ts skipDecision.
 */
export async function skipMatchTx(
  tx: Tx,
  input: { userId: string; matchId: string; now?: Date; /** What the button promised — refuse if it's changed since (a skip used in another tab). */ expect: "makeup" | "forfeit" },
) {
  const { match, tournament, players, me } = await myMatch(tx, input.matchId, input.userId);
  // One skip at a time per team, so two taps on two different matches can't both get the free makeup.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`skip:${me.teamId}`}))`);

  const skipsUsed = await skipsUsedTx(tx, tournament.id, me.teamId);
  const decision = skipDecision(match, { teamId: me.teamId, skipsUsed }, input.now ?? new Date(), regularSeasonEndsAt(seasonConfig(tournament)));
  if (decision.kind === "blocked") throw new LeagueError(decision.message);
  if (decision.kind !== input.expect) {
    throw new LeagueError(
      decision.kind === "forfeit"
        ? "Your team's skip was just used on another match — skipping this one now would be a forfeit. Refresh to see it."
        : "This changed since you loaded the page — refresh and try again.",
    );
  }

  const names = await tx
    .select({ id: schema.tmTeams.id, name: schema.tmTeams.name })
    .from(schema.tmTeams)
    .where(inArray(schema.tmTeams.id, [match.teamAId!, match.teamBId!]));
  const otherId = me.teamId === match.teamAId ? match.teamBId! : match.teamAId!;
  const teamName = names.find((t) => t.id === me.teamId)?.name ?? "A team";
  const otherTeam = names.find((t) => t.id === otherId)?.name ?? "their opponent";
  const notify = players.filter((p) => p.memberId !== input.userId);

  if (decision.kind === "forfeit") {
    await settleMatchTx(tx, match, "forfeited", otherId);
    return { outcome: "forfeit" as const, reason: decision.reason, notify, mail: { tournamentName: tournament.name, forfeitingTeam: teamName, otherTeam } };
  }

  const newDueBy = shiftDeadline(match.dueBy!, 1);
  await tx
    .update(schema.matches)
    .set({ dueBy: newDueBy, extendedForTeamId: me.teamId, ...MAKEUP_RESET })
    .where(eq(schema.matches.id, match.id));
  return {
    outcome: "makeup" as const,
    notify,
    mail: { tournamentName: tournament.name, requestingTeam: teamName, otherTeam, newDueBy },
  };
}

/** "We're playing Thursday 7 PM, Court 3" — due Wednesday 11:59 PM each week. Any of the four players; posting again updates it. */
export async function postMatchTimeTx(tx: Tx, input: { userId: string; matchId: string; when: Date; note: string }) {
  const { match } = await myMatch(tx, input.matchId, input.userId);
  const problem = postTimeProblem(match, input.when);
  if (problem) throw new LeagueError(problem);
  await tx
    .update(schema.matches)
    .set({ scheduledAt: input.when, scheduledNote: input.note || null, scheduledBy: input.userId })
    .where(eq(schema.matches.id, match.id));
}

/** Admin rules on a disputed (or any reported) score: confirms it with the chosen winner, advancing the bracket in the playoffs. */
export async function resolveDisputeTx(tx: Tx, input: { reportId: string; winnerTeamId: string }): Promise<boolean> {
  const [report] = await tx.select().from(schema.matchReports).where(eq(schema.matchReports.id, input.reportId));
  if (!report) return false;
  const [match] = await tx.select().from(schema.matches).where(eq(schema.matches.id, report.matchId)).for("update");
  if (!match || (input.winnerTeamId !== match.teamAId && input.winnerTeamId !== match.teamBId)) return false;
  await tx
    .update(schema.matchReports)
    .set({ confirmedAt: new Date(), winnerTeamId: input.winnerTeamId })
    .where(eq(schema.matchReports.id, report.id));
  await settleMatchTx(tx, match, "confirmed", input.winnerTeamId);
  return true;
}
