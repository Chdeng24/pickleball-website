import "server-only";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { withTransaction, type Tx } from "@/db/pool";
import { isDrawReady, isSchedulable } from "@/lib/league-rules";
import { checkMatchScore, type GameScore } from "@/lib/matchscore";
import {
  balancedSlotOrder,
  bracketSeedPairs,
  nextBracketSpot,
  playoffRounds,
  roundRobinRounds,
  shiftDeadline,
  slotCount,
  teamStrength,
  weekDueBy,
  type PlayerLevel,
  type SeasonConfig,
} from "@/lib/schedule";
import { computeStandings, type PoolMatch } from "@/lib/standings";

/**
 * Pickleball League season writes: the weekly round-robin draw, manual
 * adjustments, late teams, results, and the playoff bracket. The schedule
 * rules themselves are pure and tested in src/lib/schedule.ts — this file
 * only reads and writes rows.
 *
 * Every team is in one table, stored as pool "A". Round-robin matches are
 * stage "pool" with `round` = season week; playoff matches are stage
 * "knockout" with `round` = bracket round.
 */

export const LEAGUE_POOL = "A";

type Tournament = typeof schema.tournaments.$inferSelect;

/** Pushed to a makeup week: the posted time and that week's reminders start over. */
export const MAKEUP_RESET = {
  scheduledAt: null,
  scheduledNote: null,
  scheduledBy: null,
  reminderSentAt: null,
  reportReminderSentAt: null,
};
/** A new pairing (late team, withdrawal, playoff winner moving up) gets every email fresh. */
const NEW_PAIRING_RESET = { ...MAKEUP_RESET, weekEmailSentAt: null };
type Match = typeof schema.matches.$inferSelect;

export class TournamentError extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

export function seasonConfig(t: Tournament): SeasonConfig {
  if (!t.seasonStartsOn || !t.finalOn) throw new TournamentError("no_season");
  return {
    seasonStartsOn: t.seasonStartsOn,
    roundRobinWeeks: t.roundRobinWeeks,
    catchupWeeks: t.catchupWeeks,
    playoffTeams: t.playoffTeams,
    finalOn: t.finalOn,
  };
}

/**
 * Every round-robin result that counts toward standings: confirmed scores
 * (with their games, for the game/point-diff tiebreakers) and forfeit wins
 * (a win with no games). A double forfeit has no winner, so it's nobody's win.
 */
export async function standingsMatches(tournamentId: string, conn: Pick<Tx, "select"> = db()): Promise<PoolMatch[]> {
  const rows = await conn
    .select({ match: schema.matches, games: schema.matchReports.games })
    .from(schema.matches)
    .leftJoin(schema.matchReports, eq(schema.matchReports.matchId, schema.matches.id))
    .where(
      and(
        eq(schema.matches.tournamentId, tournamentId),
        eq(schema.matches.stage, "pool"),
        inArray(schema.matches.status, ["confirmed", "forfeited"]),
      ),
    );
  return rows
    .filter((r) => r.match.teamAId && r.match.teamBId && r.match.winnerTeamId)
    .map((r) => ({
      teamAId: r.match.teamAId!,
      teamBId: r.match.teamBId!,
      winnerTeamId: r.match.winnerTeamId!,
      games: r.match.status === "confirmed" ? (r.games ?? []) : [],
    }));
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

async function teamRef(tx: Tx, teamId: string) {
  const [ref] = await tx.select().from(schema.tmTeams).where(eq(schema.tmTeams.id, teamId));
  if (!ref) throw new TournamentError("not_found");
  return ref;
}

async function addPlaceholder(tx: Tx, tournamentId: string, name: string): Promise<string> {
  const [row] = await tx
    .insert(schema.tmTeams)
    .values({ tournamentId, name, pool: LEAGUE_POOL, isPlaceholder: true, status: "registered" })
    .returning({ id: schema.tmTeams.id });
  return row.id;
}

/** Point every pending round-robin match of `fromId` (optionally only those not yet due) at `toId`. Clears the sent-email flags so the new pairing gets its own emails. */
async function repointMatches(tx: Tx, tournamentId: string, fromId: string, toId: string, notBefore: Date | null) {
  const due = notBefore ? or(isNull(schema.matches.dueBy), sql`${schema.matches.dueBy} >= ${notBefore}`) : undefined;
  const base = and(
    eq(schema.matches.tournamentId, tournamentId),
    eq(schema.matches.stage, "pool"),
    eq(schema.matches.status, "pending"),
    due,
  );
  const reset = NEW_PAIRING_RESET;
  const a = await tx
    .update(schema.matches)
    .set({ teamAId: toId, ...reset })
    .where(and(base, eq(schema.matches.teamAId, fromId)))
    .returning({ id: schema.matches.id });
  const b = await tx
    .update(schema.matches)
    .set({ teamBId: toId, ...reset })
    .where(and(base, eq(schema.matches.teamBId, fromId)))
    .returning({ id: schema.matches.id });
  return a.length + b.length;
}

/** A placeholder nobody references any more is deleted; one still holding past byes is retired instead. */
async function retirePlaceholder(tx: Tx, placeholderId: string) {
  const [left] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.matches)
    .where(or(eq(schema.matches.teamAId, placeholderId), eq(schema.matches.teamBId, placeholderId)));
  if ((left?.n ?? 0) === 0) await tx.delete(schema.tmTeams).where(eq(schema.tmTeams.id, placeholderId));
  else await tx.update(schema.tmTeams).set({ status: "withdrawn" }).where(eq(schema.tmTeams.id, placeholderId));
}

/**
 * Records a result and, in the playoffs, moves the winner into their next
 * match (or clears that spot if the result was reopened). Every path that
 * decides a match goes through here so the bracket can't drift.
 */
export async function settleMatchTx(
  tx: Tx,
  match: Pick<Match, "id" | "stage" | "nextMatchId" | "nextSlot">,
  status: Match["status"],
  winnerTeamId: string | null,
) {
  await tx.update(schema.matches).set({ status, winnerTeamId }).where(eq(schema.matches.id, match.id));
  if (match.stage !== "knockout" || !match.nextMatchId) return;
  const side = match.nextSlot === 1 ? { teamBId: winnerTeamId } : { teamAId: winnerTeamId };
  await tx
    .update(schema.matches)
    .set({ ...side, ...NEW_PAIRING_RESET })
    .where(eq(schema.matches.id, match.nextMatchId));
}

/** True once the round after this playoff match has a result — changing this one would rewrite history. */
async function nextRoundDecided(tx: Tx, match: Match): Promise<boolean> {
  if (match.stage !== "knockout" || !match.nextMatchId) return false;
  const [next] = await tx.select({ status: schema.matches.status }).from(schema.matches).where(eq(schema.matches.id, match.nextMatchId));
  return Boolean(next && next.status !== "pending");
}

/* ─── Draw ───────────────────────────────────────────────────────────────── */

function playerLevel(m: { derivedLevel: "unknown" | "beginner" | "advanced"; onCompetitiveTeam: boolean }): PlayerLevel {
  return m.onCompetitiveTeam ? "comp" : m.derivedLevel;
}

/**
 * (Re)builds the draft season: every complete team gets a slot, plus
 * `openSlots` reserved for late teams (rounded up to an even total), and the
 * weekly round robin is drawn across all slots with strength balancing.
 * Generating closes registration; nothing is visible to members or emailed
 * until exec publishes.
 */
export async function generateDraftDrawTx(
  tx: Tx,
  tournamentId: string,
  opts: { openSlots: number; now?: Date },
): Promise<{ teamCount: number; openSlots: number; weeks: number }> {
  const tournament = await lockTournament(tx, tournamentId);
  if (tournament.poolsAnnouncedAt) throw new TournamentError("already_announced");
  if (tournament.status !== "registration" && tournament.status !== "pools") throw new TournamentError("not_open");
  const season = seasonConfig(tournament);
  if (weekDueBy(season.seasonStartsOn, 1) <= (opts.now ?? new Date())) throw new TournamentError("season_started");

  await tx
    .delete(schema.matches)
    .where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "pool")));
  await tx
    .delete(schema.tmTeams)
    .where(and(eq(schema.tmTeams.tournamentId, tournamentId), eq(schema.tmTeams.isPlaceholder, true)));
  await tx.update(schema.tmTeams).set({ pool: null }).where(eq(schema.tmTeams.tournamentId, tournamentId));

  const teams = await tx.query.tmTeams.findMany({
    where: and(eq(schema.tmTeams.tournamentId, tournamentId), eq(schema.tmTeams.status, "registered")),
    with: { members: { with: { member: { columns: { derivedLevel: true, onCompetitiveTeam: true } } } } },
  });
  const ready = teams
    .filter((t) => isDrawReady(t.members))
    .map((t) => ({
      id: t.id,
      strength: teamStrength(t.members.filter((m) => m.inviteStatus === "accepted").map((m) => playerLevel(m.member))),
    }));
  if (ready.length < 2) throw new TournamentError("too_few_teams");

  const slots = slotCount(ready.length, opts.openSlots);
  const placeholders = [];
  for (let i = 0; i < slots - ready.length; i++) {
    placeholders.push({ id: await addPlaceholder(tx, tournamentId, `Open slot ${i + 1}`), strength: 0, placeholder: true });
  }

  const weeks = Math.min(season.roundRobinWeeks, slots - 1);
  const order = balancedSlotOrder([...ready, ...placeholders], weeks);
  const rounds = roundRobinRounds(order, weeks);

  await tx.update(schema.tmTeams).set({ pool: LEAGUE_POOL }).where(inArray(schema.tmTeams.id, order));
  await tx.insert(schema.matches).values(
    rounds.flatMap((pairs, i) =>
      pairs.map(([teamAId, teamBId]) => ({
        tournamentId,
        stage: "pool" as const,
        pool: LEAGUE_POOL,
        round: i + 1,
        teamAId,
        teamBId,
        dueBy: weekDueBy(season.seasonStartsOn, i + 1),
      })),
    ),
  );

  await tx.update(schema.tournaments).set({ status: "pools" }).where(eq(schema.tournaments.id, tournamentId));
  return { teamCount: ready.length, openSlots: placeholders.length, weeks };
}

/** Throw away the unpublished draft and reopen registration — the undo for "generated the draw too early". */
export async function discardDraftDrawTx(tx: Tx, tournamentId: string): Promise<void> {
  const tournament = await lockTournament(tx, tournamentId);
  if (tournament.poolsAnnouncedAt) throw new TournamentError("already_announced");
  if (tournament.status !== "pools") throw new TournamentError("no_draft_draw");

  await tx
    .delete(schema.matches)
    .where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "pool")));
  await tx
    .delete(schema.tmTeams)
    .where(and(eq(schema.tmTeams.tournamentId, tournamentId), eq(schema.tmTeams.isPlaceholder, true)));
  await tx.update(schema.tmTeams).set({ pool: null }).where(eq(schema.tmTeams.tournamentId, tournamentId));
  await tx.update(schema.tournaments).set({ status: "registration" }).where(eq(schema.tournaments.id, tournamentId));
}

/**
 * Swap two teams' places — every matchup one had, the other gets. Works on
 * the draft schedule (including swapping a team with an open slot, or with a
 * complete team that isn't in the draw yet, which replaces it), and on the
 * playoff bracket before any playoff result is in.
 */
export async function swapTeamsTx(tx: Tx, teamAId: string, teamBId: string): Promise<void> {
  if (teamAId === teamBId) throw new TournamentError("same_team");
  const [a, b] = [await teamRef(tx, teamAId), await teamRef(tx, teamBId)];
  if (a.tournamentId !== b.tournamentId) throw new TournamentError("not_found");
  const tournament = await lockTournament(tx, a.tournamentId);

  let stage: "pool" | "knockout";
  if (tournament.status === "pools" && !tournament.poolsAnnouncedAt) stage = "pool";
  else if (tournament.status === "knockout") {
    const [started] = await tx
      .select({ id: schema.matches.id })
      .from(schema.matches)
      .where(and(eq(schema.matches.tournamentId, tournament.id), eq(schema.matches.stage, "knockout"), ne(schema.matches.status, "pending")))
      .limit(1);
    if (started) throw new TournamentError("playoffs_started");
    stage = "knockout";
  } else throw new TournamentError("already_announced");

  for (const t of [a, b]) {
    if (t.status === "withdrawn") throw new TournamentError("not_found");
    if (!t.isPlaceholder && !isSchedulable(await tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, t.id)))) {
      throw new TournamentError("incomplete_team");
    }
  }
  if (stage === "knockout" && (a.isPlaceholder || b.isPlaceholder)) throw new TournamentError("not_found");

  const swap = (col: typeof schema.matches.teamAId | typeof schema.matches.teamBId) =>
    sql`case when ${col} = ${teamAId} then ${teamBId}::uuid when ${col} = ${teamBId} then ${teamAId}::uuid else ${col} end`;
  await tx
    .update(schema.matches)
    .set({ teamAId: swap(schema.matches.teamAId), teamBId: swap(schema.matches.teamBId) })
    .where(
      and(
        eq(schema.matches.tournamentId, tournament.id),
        eq(schema.matches.stage, stage),
        or(inArray(schema.matches.teamAId, [teamAId, teamBId]), inArray(schema.matches.teamBId, [teamAId, teamBId])),
      ),
    );

  if (stage === "pool") {
    await tx.update(schema.tmTeams).set({ pool: b.pool }).where(eq(schema.tmTeams.id, a.id));
    await tx.update(schema.tmTeams).set({ pool: a.pool }).where(eq(schema.tmTeams.id, b.id));
  } else {
    await tx.update(schema.tmTeams).set({ seed: b.seed }).where(eq(schema.tmTeams.id, a.id));
    await tx.update(schema.tmTeams).set({ seed: a.seed }).where(eq(schema.tmTeams.id, b.id));
  }
}

/**
 * A late team takes over an open slot: from this week on, every match the
 * slot had is theirs. Weeks already over stay byes. Nobody else's matchups
 * move. Works on the draft too (then it takes all the slot's matches).
 */
export async function fillOpenSlotTx(tx: Tx, placeholderId: string, teamId: string, now = new Date()) {
  const [slot, team] = [await teamRef(tx, placeholderId), await teamRef(tx, teamId)];
  if (!slot.isPlaceholder || slot.status === "withdrawn") throw new TournamentError("slot_taken");
  if (team.tournamentId !== slot.tournamentId || team.isPlaceholder || team.status === "withdrawn") throw new TournamentError("not_found");
  const tournament = await lockTournament(tx, slot.tournamentId);
  if (tournament.status !== "pools") throw new TournamentError("not_in_season");
  if (team.pool) throw new TournamentError("already_scheduled");
  const roster = await tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, team.id));
  if (!isSchedulable(roster)) throw new TournamentError("incomplete_team");

  // "This week on" = any match whose deadline hasn't passed yet.
  const moved = await repointMatches(tx, tournament.id, slot.id, team.id, tournament.poolsAnnouncedAt ? now : null);
  await tx.update(schema.tmTeams).set({ pool: LEAGUE_POOL }).where(eq(schema.tmTeams.id, team.id));
  await retirePlaceholder(tx, slot.id);
  return { tournament, team, moved, live: Boolean(tournament.poolsAnnouncedAt) };
}

/**
 * Withdraws a team. During registration it just frees the spots. Once it's
 * in the schedule (draft or live), its slot becomes an open slot — opponents
 * get a bye unless a late team takes it over — and played results stand.
 * Live, an unplayed match whose deadline already passed is a forfeit win for
 * the opponent, and in the playoffs the opponent advances.
 */
export async function withdrawTeamTx(tx: Tx, teamId: string, now = new Date()): Promise<void> {
  const ref = await teamRef(tx, teamId);
  if (ref.isPlaceholder) throw new TournamentError("not_found");
  const tournament = await lockTournament(tx, ref.tournamentId);

  await tx.update(schema.tmTeams).set({ status: "withdrawn" }).where(eq(schema.tmTeams.id, teamId));
  await tx
    .update(schema.tmTeamMembers)
    .set({ inviteStatus: "declined" })
    .where(and(eq(schema.tmTeamMembers.teamId, teamId), eq(schema.tmTeamMembers.inviteStatus, "pending")));
  if (!ref.pool) return;

  const live = Boolean(tournament.poolsAnnouncedAt);
  const openId = await addPlaceholder(tx, tournament.id, "Open slot");
  await repointMatches(tx, tournament.id, teamId, openId, live ? now : null);
  await retirePlaceholder(tx, openId);
  if (!live) {
    await tx.update(schema.tmTeams).set({ pool: null }).where(eq(schema.tmTeams.id, teamId));
    return;
  }

  // What's left pointing at them is past due (round robin) or a playoff match: the other side wins.
  const theirs = await tx
    .select()
    .from(schema.matches)
    .where(
      and(
        eq(schema.matches.tournamentId, tournament.id),
        inArray(schema.matches.status, ["pending", "reported", "disputed"]),
        or(eq(schema.matches.teamAId, teamId), eq(schema.matches.teamBId, teamId)),
      ),
    );
  const placeholderIds = new Set(
    (
      await tx
        .select({ id: schema.tmTeams.id })
        .from(schema.tmTeams)
        .where(and(eq(schema.tmTeams.tournamentId, tournament.id), eq(schema.tmTeams.isPlaceholder, true)))
    ).map((r) => r.id),
  );
  for (const m of theirs) {
    const other = m.teamAId === teamId ? m.teamBId : m.teamAId;
    if (!other || placeholderIds.has(other)) continue;
    await settleMatchTx(tx, m, "forfeited", other);
  }
}

/** Locks the draft, marks it announced, and returns each team's schedule for the announcement email (caller sends). */
export async function publishDrawTx(tx: Tx, tournamentId: string) {
  const tournament = await lockTournament(tx, tournamentId);
  if (tournament.poolsAnnouncedAt) throw new TournamentError("already_announced");
  if (tournament.status !== "pools") throw new TournamentError("no_draft_draw");

  const drawn = await tx.query.tmTeams.findMany({
    where: and(eq(schema.tmTeams.tournamentId, tournamentId), ne(schema.tmTeams.status, "withdrawn")),
    with: { members: { with: { member: true } } },
  });
  const teams = drawn.filter((t) => t.pool);
  if (teams.filter((t) => !t.isPlaceholder).length < 2) throw new TournamentError("too_few_teams");

  const matches = await tx
    .select()
    .from(schema.matches)
    .where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "pool")));

  const announcedAt = new Date();
  await tx.update(schema.tournaments).set({ poolsAnnouncedAt: announcedAt }).where(eq(schema.tournaments.id, tournamentId));
  return { tournament: { ...tournament, poolsAnnouncedAt: announcedAt }, teams, matches };
}

/** Ends a league — it drops off members' Tournaments tab and stops holding anyone's one-league slot. */
export async function completeLeague(tournamentId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await lockTournament(tx, tournamentId);
    await tx.update(schema.tournaments).set({ status: "complete" }).where(eq(schema.tournaments.id, tournamentId));
  });
}

/* ─── Playoffs ───────────────────────────────────────────────────────────── */

/**
 * Seeds the top `playoffTeams` from the final standings into a single-
 * elimination bracket (1v8, 4v5, 2v7, 3v6), each round due on its playoff
 * deadline. Refuses while round-robin results are still open. Can be
 * regenerated until the first playoff result is in.
 */
export async function generatePlayoffsTx(tx: Tx, tournamentId: string) {
  const tournament = await lockTournament(tx, tournamentId);
  if (!tournament.poolsAnnouncedAt || (tournament.status !== "pools" && tournament.status !== "knockout")) {
    throw new TournamentError("not_in_season");
  }
  const season = seasonConfig(tournament);
  let rounds;
  try {
    rounds = playoffRounds(season);
  } catch (e) {
    throw new TournamentError(e instanceof Error ? e.message : "bad_playoffs");
  }

  const existing = await tx
    .select()
    .from(schema.matches)
    .where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "knockout")));
  if (existing.some((m) => m.status !== "pending")) throw new TournamentError("playoffs_started");

  const teams = await tx
    .select()
    .from(schema.tmTeams)
    .where(and(eq(schema.tmTeams.tournamentId, tournamentId), ne(schema.tmTeams.status, "withdrawn")));
  const real = teams.filter((t) => !t.isPlaceholder && t.pool);
  const placeholderIds = new Set(teams.filter((t) => t.isPlaceholder).map((t) => t.id));

  const pool = await tx
    .select()
    .from(schema.matches)
    .where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "pool")));
  const open = pool.filter(
    (m) =>
      m.status !== "confirmed" &&
      m.status !== "forfeited" &&
      m.teamAId &&
      m.teamBId &&
      !placeholderIds.has(m.teamAId) &&
      !placeholderIds.has(m.teamBId) &&
      real.some((t) => t.id === m.teamAId) &&
      real.some((t) => t.id === m.teamBId),
  );
  if (open.length > 0) throw new TournamentError(`pool_unfinished:${open.length}`);
  if (real.length < season.playoffTeams) throw new TournamentError("too_few_for_playoffs");

  const standings = computeStandings(
    real.map((t) => t.id),
    await standingsMatches(tournamentId, tx),
  );
  const seeds = standings.slice(0, season.playoffTeams).map((s) => s.teamId);
  const tieAtCut = standings[season.playoffTeams - 1]?.tiebreak === "unresolved";

  if (existing.length) {
    await tx.delete(schema.matches).where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "knockout")));
  }
  await tx.update(schema.tmTeams).set({ seed: null }).where(eq(schema.tmTeams.tournamentId, tournamentId));
  for (const [i, id] of seeds.entries()) {
    await tx.update(schema.tmTeams).set({ seed: i + 1 }).where(eq(schema.tmTeams.id, id));
  }

  // Build from the final backwards so each match knows where its winner goes.
  let later: { id: string }[] = [];
  for (const r of [...rounds].reverse()) {
    const count = season.playoffTeams / 2 ** r.round;
    const firstRound = r.round === 1;
    const pairs = firstRound ? bracketSeedPairs(season.playoffTeams) : [];
    const rows = Array.from({ length: count }, (_, slot) => {
      const next = later.length ? nextBracketSpot(slot) : null;
      return {
        tournamentId,
        stage: "knockout" as const,
        round: r.round,
        slot,
        dueBy: r.dueBy,
        teamAId: firstRound ? seeds[pairs[slot][0] - 1] : null,
        teamBId: firstRound ? seeds[pairs[slot][1] - 1] : null,
        nextMatchId: next ? later[next.slot].id : null,
        nextSlot: next ? (next.side === "A" ? 0 : 1) : null,
      };
    });
    later = await tx.insert(schema.matches).values(rows).returning({ id: schema.matches.id });
  }

  await tx.update(schema.tournaments).set({ status: "knockout" }).where(eq(schema.tournaments.id, tournamentId));
  return { seeds, tieAtCut };
}

/** Back to round robin: deletes the bracket. Only before any playoff result. */
export async function discardPlayoffsTx(tx: Tx, tournamentId: string): Promise<void> {
  const tournament = await lockTournament(tx, tournamentId);
  if (tournament.status !== "knockout") throw new TournamentError("no_playoffs");
  const started = await tx
    .select({ id: schema.matches.id })
    .from(schema.matches)
    .where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "knockout"), ne(schema.matches.status, "pending")))
    .limit(1);
  if (started.length) throw new TournamentError("playoffs_started");
  await tx.delete(schema.matches).where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "knockout")));
  await tx.update(schema.tmTeams).set({ seed: null }).where(eq(schema.tmTeams.tournamentId, tournamentId));
  await tx.update(schema.tournaments).set({ status: "pools" }).where(eq(schema.tournaments.id, tournamentId));
}

/* ─── Results ────────────────────────────────────────────────────────────── */

export type ExecOutcome =
  | { kind: "score"; games: GameScore[] }
  | { kind: "forfeit"; winner: "A" | "B" }
  | { kind: "double_forfeit" }
  | { kind: "reopen" }
  | { kind: "extend" };

/** Exec's override for any match: enter a score, award a forfeit, double forfeit, reopen it, or give it another week. */
export async function execSetResultTx(tx: Tx, matchId: string, outcome: ExecOutcome, execId: string): Promise<Match> {
  const [match] = await tx.select().from(schema.matches).where(eq(schema.matches.id, matchId)).for("update");
  if (!match) throw new TournamentError("not_found");
  const tournament = await lockTournament(tx, match.tournamentId);
  if (!tournament.poolsAnnouncedAt || tournament.status === "complete") throw new TournamentError("not_in_season");

  if (outcome.kind === "extend") {
    if (match.status !== "pending" || !match.dueBy) throw new TournamentError("not_pending");
    await tx
      .update(schema.matches)
      .set({ dueBy: shiftDeadline(match.dueBy, 1), ...MAKEUP_RESET })
      .where(eq(schema.matches.id, match.id));
    return match;
  }

  if (!match.teamAId || !match.teamBId) throw new TournamentError("teams_tbd");
  const [teamA, teamB] = [await teamRef(tx, match.teamAId), await teamRef(tx, match.teamBId)];
  if (teamA.isPlaceholder || teamB.isPlaceholder) throw new TournamentError("bye");
  if (await nextRoundDecided(tx, match)) throw new TournamentError("next_round_played");

  await tx.delete(schema.matchReports).where(eq(schema.matchReports.matchId, match.id));

  switch (outcome.kind) {
    case "score": {
      const check = checkMatchScore(outcome.games);
      if (!check.ok) throw new TournamentError(check.error);
      const winnerTeamId = check.winner === "A" ? match.teamAId : match.teamBId;
      await tx.insert(schema.matchReports).values({
        matchId: match.id,
        reportedBy: execId,
        games: outcome.games,
        winnerTeamId,
        confirmedAt: new Date(),
      });
      await settleMatchTx(tx, match, "confirmed", winnerTeamId);
      break;
    }
    case "forfeit":
      await settleMatchTx(tx, match, "forfeited", outcome.winner === "A" ? match.teamAId : match.teamBId);
      break;
    case "double_forfeit":
      if (match.stage === "knockout") throw new TournamentError("no_double_forfeit_in_playoffs");
      await settleMatchTx(tx, match, "forfeited", null);
      break;
    case "reopen":
      await settleMatchTx(tx, match, "pending", null);
      break;
  }
  return match;
}

/* ─── wrappers the server actions call ─────────────────────────────────── */

export const generateDraftDraw = (tournamentId: string, openSlots: number) =>
  withTransaction((tx) => generateDraftDrawTx(tx, tournamentId, { openSlots }));
export const discardDraftDraw = (tournamentId: string) => withTransaction((tx) => discardDraftDrawTx(tx, tournamentId));
export const swapTeams = (a: string, b: string) => withTransaction((tx) => swapTeamsTx(tx, a, b));
export const fillOpenSlot = (placeholderId: string, teamId: string) =>
  withTransaction((tx) => fillOpenSlotTx(tx, placeholderId, teamId));
export const withdrawTeam = (teamId: string) => withTransaction((tx) => withdrawTeamTx(tx, teamId));
export const publishDraw = (tournamentId: string) => withTransaction((tx) => publishDrawTx(tx, tournamentId));
export const generatePlayoffs = (tournamentId: string) => withTransaction((tx) => generatePlayoffsTx(tx, tournamentId));
export const discardPlayoffs = (tournamentId: string) => withTransaction((tx) => discardPlayoffsTx(tx, tournamentId));
export const execSetResult = (matchId: string, outcome: ExecOutcome, execId: string) =>
  withTransaction((tx) => execSetResultTx(tx, matchId, outcome, execId));
