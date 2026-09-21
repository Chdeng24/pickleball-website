import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { withTransaction, type Tx } from "@/db/pool";
import { assignPools, generateRoundRobinMatches, type DrawLevel } from "@/lib/draw";
import { isDrawReady } from "@/lib/league-rules";
import type { PoolMatch } from "@/lib/standings";

/** Confirmed pool matches for a tournament, with the actual reported games (for game/point-diff tiebreakers). */
export async function confirmedPoolMatches(tournamentId: string): Promise<(PoolMatch & { pool: string | null })[]> {
  const rows = await db()
    .select({ match: schema.matches, report: schema.matchReports })
    .from(schema.matches)
    .innerJoin(
      schema.matchReports,
      and(eq(schema.matchReports.matchId, schema.matches.id), eq(schema.matches.status, "confirmed")),
    )
    .where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "pool")));

  return rows
    .filter((r) => r.match.teamAId && r.match.teamBId && r.match.winnerTeamId)
    .map((r) => ({
      teamAId: r.match.teamAId!,
      teamBId: r.match.teamBId!,
      winnerTeamId: r.match.winnerTeamId!,
      games: r.report.games,
      pool: r.match.pool,
    }));
}

export class TournamentError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

async function lockTournament(tx: Tx, tournamentId: string) {
  const [tournament] = await tx
    .select()
    .from(schema.tournaments)
    .where(eq(schema.tournaments.id, tournamentId))
    .for("update");
  if (!tournament) throw new TournamentError("not_found");
  return tournament;
}

/** Team level = the stronger of its two players — standard doubles seeding. */
const LEVEL_RANK: Record<DrawLevel, number> = { advanced: 2, beginner: 1, unknown: 0 };
function teamLevel(memberLevels: DrawLevel[]): DrawLevel {
  return memberLevels.reduce((best, l) => (LEVEL_RANK[l] > LEVEL_RANK[best] ? l : best), "unknown" as DrawLevel);
}

/** Rebuild one pool's round-robin from whoever is in it now. Only for the unpublished draft. */
async function rebuildPool(tx: Tx, tournamentId: string, pool: string) {
  await tx
    .delete(schema.matches)
    .where(
      and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "pool"), eq(schema.matches.pool, pool)),
    );
  const poolTeams = await tx
    .select({ id: schema.tmTeams.id })
    .from(schema.tmTeams)
    .where(
      and(eq(schema.tmTeams.tournamentId, tournamentId), eq(schema.tmTeams.pool, pool), ne(schema.tmTeams.status, "withdrawn")),
    );
  const pairs = generateRoundRobinMatches(poolTeams.map((t) => t.id));
  if (pairs.length > 0) {
    await tx.insert(schema.matches).values(pairs.map((p) => ({ tournamentId, stage: "pool" as const, pool, ...p })));
  }
}

/**
 * (Re)builds the draft pool assignment + round-robin matches from every
 * complete (two confirmed players), non-withdrawn team. Generating it closes
 * registration; nothing is visible to members or emailed until exec publishes.
 */
export async function generateDraftDrawTx(tx: Tx, tournamentId: string): Promise<{ poolCount: number; teamCount: number }> {
  const tournament = await lockTournament(tx, tournamentId);
  if (tournament.poolsAnnouncedAt) throw new TournamentError("already_announced");
  if (tournament.status !== "registration" && tournament.status !== "pools") throw new TournamentError("not_open");

  const teams = await tx.query.tmTeams.findMany({
    where: and(eq(schema.tmTeams.tournamentId, tournamentId), eq(schema.tmTeams.status, "registered")),
    with: { members: { with: { member: { columns: { derivedLevel: true, onCompetitiveTeam: true } } } } },
  });

  const ready = teams
    .filter((t) => isDrawReady(t.members))
    .map((t) => ({
      id: t.id,
      level: teamLevel(
        t.members
          .filter((m) => m.inviteStatus === "accepted")
          // Comp Team players seed as advanced even before their first Social practice.
          .map((m) => (m.member.onCompetitiveTeam ? "advanced" : m.member.derivedLevel)),
      ),
    }));

  if (ready.length < 2) throw new TournamentError("too_few_teams");

  const pools = assignPools(ready, tournament.poolSize);

  await tx
    .delete(schema.matches)
    .where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "pool")));
  await tx.update(schema.tmTeams).set({ pool: null }).where(eq(schema.tmTeams.tournamentId, tournamentId));

  for (const [pool, teamIds] of pools) {
    await tx.update(schema.tmTeams).set({ pool }).where(inArray(schema.tmTeams.id, teamIds));
    const pairs = generateRoundRobinMatches(teamIds);
    if (pairs.length > 0) {
      await tx
        .insert(schema.matches)
        .values(pairs.map((p) => ({ tournamentId, stage: "pool" as const, pool, ...p })));
    }
  }

  await tx.update(schema.tournaments).set({ status: "pools" }).where(eq(schema.tournaments.id, tournamentId));
  return { poolCount: pools.size, teamCount: ready.length };
}

/** Throw away the unpublished draft and reopen registration — the undo for "generated the draw too early". */
export async function discardDraftDrawTx(tx: Tx, tournamentId: string): Promise<void> {
  const tournament = await lockTournament(tx, tournamentId);
  if (tournament.poolsAnnouncedAt) throw new TournamentError("already_announced");
  if (tournament.status !== "pools") throw new TournamentError("no_draft_draw");

  await tx
    .delete(schema.matches)
    .where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "pool")));
  await tx.update(schema.tmTeams).set({ pool: null }).where(eq(schema.tmTeams.tournamentId, tournamentId));
  await tx.update(schema.tournaments).set({ status: "registration" }).where(eq(schema.tournaments.id, tournamentId));
}

/** Manually move a team to a different pool letter, then rebuild both affected pools. Draft stage only. */
export async function moveTeamPoolTx(tx: Tx, teamId: string, pool: string): Promise<void> {
  const [ref] = await tx.select().from(schema.tmTeams).where(eq(schema.tmTeams.id, teamId));
  if (!ref) throw new TournamentError("not_found");
  const tournament = await lockTournament(tx, ref.tournamentId);
  if (tournament.poolsAnnouncedAt) throw new TournamentError("already_announced");
  if (tournament.status !== "pools") throw new TournamentError("no_draft_draw");
  if (ref.status === "withdrawn") throw new TournamentError("not_found");

  const roster = await tx
    .select({ inviteStatus: schema.tmTeamMembers.inviteStatus })
    .from(schema.tmTeamMembers)
    .where(eq(schema.tmTeamMembers.teamId, teamId));
  if (!isDrawReady(roster)) throw new TournamentError("incomplete_team");

  await tx.update(schema.tmTeams).set({ pool }).where(eq(schema.tmTeams.id, teamId));
  for (const p of new Set([ref.pool, pool].filter((x): x is string => Boolean(x)))) {
    await rebuildPool(tx, tournament.id, p);
  }
}

/**
 * Withdraws a team. During registration it just frees the spots. In the
 * unpublished draft it leaves its pool and only that pool's matches are
 * rebuilt. Once live, its unplayed matches are deleted — a bye for whoever
 * they'd have faced — while reported/confirmed results stand as real history.
 */
export async function withdrawTeamTx(tx: Tx, teamId: string): Promise<void> {
  const [ref] = await tx.select().from(schema.tmTeams).where(eq(schema.tmTeams.id, teamId));
  if (!ref) throw new TournamentError("not_found");
  const tournament = await lockTournament(tx, ref.tournamentId);

  await tx.update(schema.tmTeams).set({ status: "withdrawn" }).where(eq(schema.tmTeams.id, teamId));
  await tx
    .update(schema.tmTeamMembers)
    .set({ inviteStatus: "declined" })
    .where(and(eq(schema.tmTeamMembers.teamId, teamId), eq(schema.tmTeamMembers.inviteStatus, "pending")));

  if (!tournament.poolsAnnouncedAt) {
    if (ref.pool) {
      await tx.update(schema.tmTeams).set({ pool: null }).where(eq(schema.tmTeams.id, teamId));
      await rebuildPool(tx, tournament.id, ref.pool);
    }
    return;
  }

  const theirs = await tx
    .select({ id: schema.matches.id, teamAId: schema.matches.teamAId, teamBId: schema.matches.teamBId })
    .from(schema.matches)
    .where(and(eq(schema.matches.tournamentId, tournament.id), eq(schema.matches.status, "pending")));
  const toDelete = theirs.filter((m) => m.teamAId === teamId || m.teamBId === teamId).map((m) => m.id);
  if (toDelete.length > 0) await tx.delete(schema.matches).where(inArray(schema.matches.id, toDelete));
}

/** Locks the draft draw, marks it announced, and returns the drawn teams to notify (caller sends the emails). */
export async function publishDrawTx(tx: Tx, tournamentId: string) {
  const tournament = await lockTournament(tx, tournamentId);
  if (tournament.poolsAnnouncedAt) throw new TournamentError("already_announced");
  if (tournament.status !== "pools") throw new TournamentError("no_draft_draw");

  const drawn = await tx.query.tmTeams.findMany({
    where: and(eq(schema.tmTeams.tournamentId, tournamentId), ne(schema.tmTeams.status, "withdrawn")),
    with: { members: { with: { member: true } } },
  });
  const teams = drawn.filter((t) => t.pool);
  if (teams.length < 2) throw new TournamentError("too_few_teams");

  await tx
    .update(schema.tournaments)
    .set({ poolsAnnouncedAt: new Date() })
    .where(eq(schema.tournaments.id, tournamentId));

  return { tournament: { ...tournament, poolsAnnouncedAt: new Date() }, teams };
}

/** Ends a league — it drops off members' Tournaments tab and stops holding anyone's one-league slot. */
export async function completeLeague(tournamentId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await lockTournament(tx, tournamentId);
    await tx.update(schema.tournaments).set({ status: "complete" }).where(eq(schema.tournaments.id, tournamentId));
  });
}

/* ── wrappers the server actions call ─────────────────────────────────── */

export const generateDraftDraw = (tournamentId: string) => withTransaction((tx) => generateDraftDrawTx(tx, tournamentId));
export const discardDraftDraw = (tournamentId: string) => withTransaction((tx) => discardDraftDrawTx(tx, tournamentId));
export const moveTeamPool = (teamId: string, pool: string) => withTransaction((tx) => moveTeamPoolTx(tx, teamId, pool));
export const withdrawTeam = (teamId: string) => withTransaction((tx) => withdrawTeamTx(tx, teamId));
export const publishDraw = (tournamentId: string) => withTransaction((tx) => publishDrawTx(tx, tournamentId));
