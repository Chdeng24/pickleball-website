import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "@/db";
import type { Tx } from "@/db/pool";
import { AlreadyDone, LeagueError } from "@/lib/league";
import { checkMatchScore, type GameScore } from "@/lib/matchscore";
import { outOfTownProblem, postTimeProblem, regularSeasonEndsAt, shiftDeadline } from "@/lib/schedule";
import { MAKEUP_RESET, seasonConfig, settleMatchTx } from "@/lib/tournament";

/**
 * What a player can do to one match: report, confirm, dispute, post a time,
 * push it to a makeup — plus the admin's dispute ruling. Each runs inside a
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

/**
 * "We can't make it this week" (sick, out of town): the match becomes a
 * makeup due next Saturday. Once per match, round robin only. If the makeup
 * isn't played, the team that asked forfeits it (schedule.ts overdueOutcome).
 */
export async function markOutOfTownTx(tx: Tx, input: { userId: string; matchId: string; now?: Date }) {
  const { match, tournament, players, me } = await myMatch(tx, input.matchId, input.userId);
  if (match.extendedForTeamId === me.teamId) throw new AlreadyDone("Already marked — it's a makeup next week.");
  const problem = outOfTownProblem(match, input.now ?? new Date(), regularSeasonEndsAt(seasonConfig(tournament)));
  if (problem) throw new LeagueError(problem);

  const newDueBy = shiftDeadline(match.dueBy!, 1);
  await tx
    .update(schema.matches)
    .set({ dueBy: newDueBy, extendedForTeamId: me.teamId, ...MAKEUP_RESET })
    .where(eq(schema.matches.id, match.id));

  const names = await tx
    .select({ id: schema.tmTeams.id, name: schema.tmTeams.name })
    .from(schema.tmTeams)
    .where(inArray(schema.tmTeams.id, [match.teamAId!, match.teamBId!]));
  const otherId = me.teamId === match.teamAId ? match.teamBId : match.teamAId;
  return {
    mail: {
      tournamentName: tournament.name,
      requestingTeam: names.find((t) => t.id === me.teamId)?.name ?? "A team",
      otherTeam: names.find((t) => t.id === otherId)?.name ?? "their opponent",
      newDueBy,
    },
    notify: players.filter((p) => p.memberId !== input.userId),
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
