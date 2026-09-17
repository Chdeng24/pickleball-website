import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { assignPools, generateRoundRobinMatches, type DrawLevel } from "@/lib/draw";
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

/** Team level = the stronger of its two players — standard doubles seeding. */
const LEVEL_RANK: Record<DrawLevel, number> = { advanced: 2, beginner: 1, unknown: 0 };
function teamLevel(memberLevels: DrawLevel[]): DrawLevel {
  return memberLevels.reduce((best, l) => (LEVEL_RANK[l] > LEVEL_RANK[best] ? l : best), "unknown" as DrawLevel);
}

/** A team is draw-ready once it has exactly 2 members who've both accepted. */
async function drawReadyTeams(tournamentId: string) {
  const teams = await db().query.tmTeams.findMany({
    where: and(eq(schema.tmTeams.tournamentId, tournamentId), eq(schema.tmTeams.status, "registered")),
    with: {
      members: { with: { member: { columns: { derivedLevel: true } } } },
    },
  });

  return teams
    .filter((t) => t.members.length === 2 && t.members.every((m) => m.inviteStatus === "accepted"))
    .map((t) => ({
      id: t.id,
      level: teamLevel(t.members.map((m) => m.member.derivedLevel)),
    }));
}

/**
 * (Re)builds the draft pool assignment + round-robin matches for a
 * tournament from its currently-registered, draw-ready teams. Safe to call
 * repeatedly pre-announce — it deletes and recreates only PENDING pool
 * matches, never touching anything already reported/confirmed, which can't
 * exist yet at this stage anyway (announce is what starts play).
 */
export async function generateDraftDraw(tournamentId: string): Promise<{ poolCount: number; teamCount: number }> {
  const [tournament] = await db().select().from(schema.tournaments).where(eq(schema.tournaments.id, tournamentId));
  if (!tournament) throw new TournamentError("not_found");
  if (tournament.poolsAnnouncedAt) throw new TournamentError("already_announced");

  const teams = await drawReadyTeams(tournamentId);
  const pools = assignPools(teams, tournament.poolSize);

  await db().delete(schema.matches).where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "pool")));

  for (const [pool, teamIds] of pools) {
    await db()
      .update(schema.tmTeams)
      .set({ pool })
      .where(inArray(schema.tmTeams.id, teamIds));

    const pairs = generateRoundRobinMatches(teamIds);
    if (pairs.length > 0) {
      await db()
        .insert(schema.matches)
        .values(pairs.map((p) => ({ tournamentId, stage: "pool" as const, pool, ...p })));
    }
  }

  // Teams that didn't make the cut (declined partner, solo, etc.) get no pool.
  const drawnIds = new Set(teams.map((t) => t.id));
  const allRegistered = await db()
    .select({ id: schema.tmTeams.id })
    .from(schema.tmTeams)
    .where(and(eq(schema.tmTeams.tournamentId, tournamentId), eq(schema.tmTeams.status, "registered")));
  const undrawnIds = allRegistered.map((t) => t.id).filter((id) => !drawnIds.has(id));
  if (undrawnIds.length > 0) {
    await db().update(schema.tmTeams).set({ pool: null }).where(inArray(schema.tmTeams.id, undrawnIds));
  }

  await db().update(schema.tournaments).set({ status: "pools" }).where(eq(schema.tournaments.id, tournamentId));

  return { poolCount: pools.size, teamCount: teams.length };
}

/** Manually move a team to a different pool letter, then rebuild that tournament's matches to match. Draft stage only. */
export async function moveTeamPool(teamId: string, pool: string): Promise<void> {
  const [team] = await db().select().from(schema.tmTeams).where(eq(schema.tmTeams.id, teamId));
  if (!team) throw new TournamentError("not_found");
  const [tournament] = await db().select().from(schema.tournaments).where(eq(schema.tournaments.id, team.tournamentId));
  if (!tournament) throw new TournamentError("not_found");
  if (tournament.poolsAnnouncedAt) throw new TournamentError("already_announced");

  // Rebuild round-robin matches for both the old and new pool so they stay consistent.
  const affectedPools = new Set([team.pool, pool].filter((p): p is string => Boolean(p)));
  await db().update(schema.tmTeams).set({ pool }).where(eq(schema.tmTeams.id, teamId));

  for (const p of affectedPools) {
    await db()
      .delete(schema.matches)
      .where(and(eq(schema.matches.tournamentId, tournament.id), eq(schema.matches.stage, "pool"), eq(schema.matches.pool, p)));

    const poolTeams = await db()
      .select({ id: schema.tmTeams.id })
      .from(schema.tmTeams)
      .where(and(eq(schema.tmTeams.tournamentId, tournament.id), eq(schema.tmTeams.pool, p)));
    const pairs = generateRoundRobinMatches(poolTeams.map((t) => t.id));
    if (pairs.length > 0) {
      await db()
        .insert(schema.matches)
        .values(pairs.map((pair) => ({ tournamentId: tournament.id, stage: "pool" as const, pool: p, ...pair })));
    }
  }
}

/**
 * Withdraws a team. Pre-announce, it's removed cleanly from its pool (draft
 * gets regenerated next time exec runs the draw). Post-announce, the team's
 * still-unplayed matches are deleted — a "bye" for whoever they'd have faced
 * — while anything already reported/confirmed stands as real history.
 */
export async function withdrawTeam(teamId: string): Promise<void> {
  const [team] = await db().select().from(schema.tmTeams).where(eq(schema.tmTeams.id, teamId));
  if (!team) throw new TournamentError("not_found");
  const [tournament] = await db().select().from(schema.tournaments).where(eq(schema.tournaments.id, team.tournamentId));
  if (!tournament) throw new TournamentError("not_found");

  await db().update(schema.tmTeams).set({ status: "withdrawn" }).where(eq(schema.tmTeams.id, teamId));

  if (!tournament.poolsAnnouncedAt) {
    // Draft stage: just drop them from the pool; exec re-runs generateDraftDraw to reshuffle.
    await db().update(schema.tmTeams).set({ pool: null }).where(eq(schema.tmTeams.id, teamId));
    await db()
      .delete(schema.matches)
      .where(
        and(
          eq(schema.matches.tournamentId, tournament.id),
          eq(schema.matches.stage, "pool"),
        ),
      );
    return;
  }

  // Live season: delete only their unplayed matches — a bye for the opponent, not a forfeit-win.
  const theirMatches = await db()
    .select()
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.tournamentId, tournament.id),
        eq(schema.matches.status, "pending"),
      ),
    );
  const toDelete = theirMatches
    .filter((m) => m.teamAId === teamId || m.teamBId === teamId)
    .map((m) => m.id);
  if (toDelete.length > 0) {
    await db().delete(schema.matches).where(inArray(schema.matches.id, toDelete));
  }
}

/** Locks the draft draw, marks it announced, and returns the teams to notify (caller sends the emails). */
export async function publishDraw(tournamentId: string) {
  const [tournament] = await db().select().from(schema.tournaments).where(eq(schema.tournaments.id, tournamentId));
  if (!tournament) throw new TournamentError("not_found");
  if (tournament.poolsAnnouncedAt) throw new TournamentError("already_announced");
  if (tournament.status !== "pools") throw new TournamentError("no_draft_draw");

  await db()
    .update(schema.tournaments)
    .set({ poolsAnnouncedAt: new Date() })
    .where(eq(schema.tournaments.id, tournamentId));

  const teams = await db().query.tmTeams.findMany({
    where: and(eq(schema.tmTeams.tournamentId, tournamentId), isNull(schema.tmTeams.pool)),
  });
  const drawnTeams = await db().query.tmTeams.findMany({
    where: and(eq(schema.tmTeams.tournamentId, tournamentId)),
    with: { members: { with: { member: true } } },
  });

  return { tournament, teams: drawnTeams.filter((t) => t.pool), undrawn: teams };
}
