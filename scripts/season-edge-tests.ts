/**
 * Pickleball League season engine checks, run against the REAL database:
 *
 *   npm run test:season
 *
 * Same safety model as test:league — every scenario runs in its own
 * transaction that is always rolled back, on a throwaway league and users.
 * Real leagues are never read, locked, or changed.
 *
 * Covers: every player button (post time, report, confirm, dispute,
 * can't-make-it) and the admin dispute ruling, a full season end to end, the weekly draw (one match per team per week, no repeats, open
 * slots), swapping teams, a late team taking an open slot mid-season without
 * moving anyone else, withdrawals, random free-agent pairing, exec-added
 * teams, the playoff bracket advancing winners, and the hourly league clock
 * (Monday matchup emails, Thursday reminders, out-of-town makeups, and
 * settling unreported matches).
 */
import assert from "node:assert/strict";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, like } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Tx } from "../src/db/pool";
import {
  AlreadyDone,
  execAddTeamTx,
  LeagueError,
  pairFreeAgentsTx,
  randomPairFreeAgentsTx,
  registerForLeagueTx,
  respondToInviteTx,
} from "../src/lib/league";
import {
  confirmScoreTx,
  disputeScoreTx,
  skipMatchTx,
  postMatchTimeTx,
  reportScoreTx,
  resolveDisputeTx,
} from "../src/lib/match-actions";
import {
  execSetResultTx,
  fillOpenSlotTx,
  generateDraftDrawTx,
  generatePlayoffsTx,
  publishDrawTx,
  swapTeamsTx,
  TournamentError,
  withdrawTeamTx,
} from "../src/lib/tournament";
import { addDays, scheduleBy, shiftDeadline, weekDueBy } from "../src/lib/schedule";
import { leagueTickTx } from "../src/lib/social-league";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — run via `npm run test:season`.");
  process.exit(1);
}

class Rollback extends Error {}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const conn = drizzle(pool, { schema });
const tag = `season-${Date.now().toString(36)}`;
let n = 0;

/** A Monday comfortably in the future, so "week 1 hasn't ended" holds. */
function futureMonday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 14 + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}
const START = futureMonday();

async function makeUser(tx: Tx) {
  const i = ++n;
  const [u] = await tx
    .insert(schema.users)
    .values({ name: `Season Tester${i}`, email: `${tag}-${i}@berkeley.edu`, status: "approved" })
    .returning();
  return u;
}

async function makeLeague(tx: Tx, opts: Partial<typeof schema.tournaments.$inferInsert> = {}) {
  const [l] = await tx
    .insert(schema.tournaments)
    .values({
      name: `${tag} League`,
      kind: "im_semester",
      division: "advanced",
      status: "registration",
      registrationClosesAt: new Date(Date.now() - 60_000),
      seasonStartsOn: START,
      roundRobinWeeks: 7,
      catchupWeeks: 1,
      playoffTeams: 4,
      finalOn: addDays(START, 7 * 10 + 5),
      ...opts,
    })
    .returning();
  return l;
}

/** `count` complete two-player teams, inserted directly. */
async function makeTeams(tx: Tx, tournamentId: string, count: number) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const [a, b] = [await makeUser(tx), await makeUser(tx)];
    const [t] = await tx.insert(schema.tmTeams).values({ tournamentId, name: `${tag} T${i}` }).returning();
    await tx.insert(schema.tmTeamMembers).values([
      { teamId: t.id, memberId: a.id, isCaptain: true, inviteStatus: "accepted" },
      { teamId: t.id, memberId: b.id, inviteStatus: "accepted" },
    ]);
    ids.push(t.id);
  }
  return ids;
}

async function poolMatches(tx: Tx, tournamentId: string) {
  return tx
    .select()
    .from(schema.matches)
    .where(and(eq(schema.matches.tournamentId, tournamentId), eq(schema.matches.stage, "pool")));
}

async function placeholders(tx: Tx, tournamentId: string) {
  return tx
    .select()
    .from(schema.tmTeams)
    .where(and(eq(schema.tmTeams.tournamentId, tournamentId), eq(schema.tmTeams.isPlaceholder, true)));
}

function sp<T>(tx: Tx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx.transaction(fn) as Promise<T>;
}

async function rejects(p: Promise<unknown>, kind: typeof TournamentError | typeof LeagueError | typeof AlreadyDone, pattern?: RegExp) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof kind, `expected ${kind.name}, got ${e instanceof Error ? `${e.constructor.name}: ${e.message}` : e}`);
    if (pattern) assert.match((e as Error).message, pattern);
    return;
  }
  assert.fail(`expected ${kind.name}, but it succeeded`);
}

const scenarios: [string, (tx: Tx) => Promise<void>][] = [
  [
    "draw: 11 teams → 12 slots, 1 open slot; every team once a week, never the same opponent twice",
    async (tx) => {
      const league = await makeLeague(tx);
      const teams = await makeTeams(tx, league.id, 11);
      const r = await generateDraftDrawTx(tx, league.id, { openSlots: 0 });
      assert.deepEqual(r, { teamCount: 11, openSlots: 1, weeks: 7 });

      const ms = await poolMatches(tx, league.id);
      assert.equal(ms.length, 7 * 6);
      for (let w = 1; w <= 7; w++) {
        const week = ms.filter((m) => m.round === w);
        const sides = week.flatMap((m) => [m.teamAId, m.teamBId]);
        assert.equal(new Set(sides).size, 12, `week ${w} has a team playing twice`);
        assert.equal(week[0].dueBy!.getTime(), weekDueBy(START, w).getTime());
      }
      const pairs = ms.map((m) => [m.teamAId, m.teamBId].sort().join());
      assert.equal(new Set(pairs).size, pairs.length);
      for (const t of teams) assert.equal(ms.filter((m) => m.teamAId === t || m.teamBId === t).length, 7);
    },
  ],
  [
    "draw: an even count has no open slot; reserving 1 adds 2 (stays even)",
    async (tx) => {
      const league = await makeLeague(tx);
      await makeTeams(tx, league.id, 10);
      assert.equal((await generateDraftDrawTx(tx, league.id, { openSlots: 0 })).openSlots, 0);
      assert.equal((await generateDraftDrawTx(tx, league.id, { openSlots: 1 })).openSlots, 2);
      assert.equal((await placeholders(tx, league.id)).length, 2, "regenerating replaced the old placeholders");
    },
  ],
  [
    "draw refuses when week 1 is already over, or the season dates are missing",
    async (tx) => {
      const late = await makeLeague(tx, { seasonStartsOn: "2020-01-06", finalOn: "2020-03-14" });
      await makeTeams(tx, late.id, 4);
      await rejects(sp(tx, (t) => generateDraftDrawTx(t, late.id, { openSlots: 0 })), TournamentError, /season_started/);
      const none = await makeLeague(tx, { seasonStartsOn: null });
      await makeTeams(tx, none.id, 4);
      await rejects(sp(tx, (t) => generateDraftDrawTx(t, none.id, { openSlots: 0 })), TournamentError, /no_season/);
    },
  ],
  [
    "swap trades two teams' whole schedules and nothing else",
    async (tx) => {
      const league = await makeLeague(tx);
      const [a, b] = await makeTeams(tx, league.id, 8);
      await generateDraftDrawTx(tx, league.id, { openSlots: 0 });
      const before = await poolMatches(tx, league.id);
      await swapTeamsTx(tx, a, b);
      const after = await poolMatches(tx, league.id);
      const sw = (id: string | null) => (id === a ? b : id === b ? a : id);
      for (const m of before) {
        const now = after.find((x) => x.id === m.id)!;
        assert.deepEqual([now.teamAId, now.teamBId].sort(), [sw(m.teamAId), sw(m.teamBId)].sort());
      }
    },
  ],
  [
    "late team takes an open slot in week 3: weeks 1–2 stay byes, weeks 3–7 are theirs, nobody else moves",
    async (tx) => {
      const league = await makeLeague(tx);
      await makeTeams(tx, league.id, 11);
      await generateDraftDrawTx(tx, league.id, { openSlots: 0 });
      await publishDrawTx(tx, league.id);
      const [slot] = await placeholders(tx, league.id);
      const before = await poolMatches(tx, league.id);

      const [late] = await makeTeams(tx, league.id, 1);
      const midWeek3 = new Date(weekDueBy(START, 3).getTime() - 3 * 86_400_000);
      const r = await fillOpenSlotTx(tx, slot.id, late, midWeek3);
      assert.equal(r.moved, 5);

      const after = await poolMatches(tx, league.id);
      for (const m of before) {
        const now = after.find((x) => x.id === m.id)!;
        const hadSlot = m.teamAId === slot.id || m.teamBId === slot.id;
        if (!hadSlot) assert.deepEqual([now.teamAId, now.teamBId], [m.teamAId, m.teamBId], "a match without the slot changed");
        else if (m.round! < 3) assert.ok(now.teamAId === slot.id || now.teamBId === slot.id, "a past bye was handed out");
        else assert.ok(now.teamAId === late || now.teamBId === late, `week ${m.round} didn't go to the late team`);
      }
      const [retired] = await tx.select().from(schema.tmTeams).where(eq(schema.tmTeams.id, slot.id));
      assert.equal(retired.status, "withdrawn", "the used slot is retired, not offered again");
      await rejects(sp(tx, (t) => fillOpenSlotTx(t, slot.id, late, midWeek3)), TournamentError, /slot_taken/);
    },
  ],
  [
    "a one-player team (playing solo by choice) can take an open slot; one with a pending invite can't",
    async (tx) => {
      const league = await makeLeague(tx, { registrationClosesAt: new Date(Date.now() + 3_600_000) });
      await makeTeams(tx, league.id, 9);
      const [solo, inviter, invitee] = [await makeUser(tx), await makeUser(tx), await makeUser(tx)];
      const { teamId: soloTeam } = await registerForLeagueTx(tx, { tournamentId: league.id, userId: solo.id });
      const { teamId: waiting } = await registerForLeagueTx(tx, { tournamentId: league.id, userId: inviter.id, partnerEmail: invitee.email });
      await generateDraftDrawTx(tx, league.id, { openSlots: 0 }); // neither is a full team, so neither is drawn
      const [slot] = await placeholders(tx, league.id);
      await rejects(sp(tx, (t) => fillOpenSlotTx(t, slot.id, waiting)), TournamentError, /incomplete_team/);
      const r = await fillOpenSlotTx(tx, slot.id, soloTeam);
      assert.equal(r.moved, 7);
    },
  ],
  [
    "withdrawal mid-season: remaining matches become an open slot; an overdue unplayed one is the opponent's forfeit win",
    async (tx) => {
      const league = await makeLeague(tx);
      const [quitter] = await makeTeams(tx, league.id, 8);
      await generateDraftDrawTx(tx, league.id, { openSlots: 0 });
      await publishDrawTx(tx, league.id);
      const week3 = new Date(weekDueBy(START, 3).getTime() - 3 * 86_400_000);
      await withdrawTeamTx(tx, quitter, week3);

      const ms = (await poolMatches(tx, league.id)).filter((m) => m.round! <= 7);
      const [slot] = await placeholders(tx, league.id);
      for (const m of ms) {
        const theirs = m.teamAId === quitter || m.teamBId === quitter;
        if (m.round! >= 3) assert.ok(!theirs, `week ${m.round} still points at the withdrawn team`);
        else {
          if (!theirs) continue;
          assert.equal(m.status, "forfeited");
          assert.notEqual(m.winnerTeamId, quitter);
        }
      }
      assert.equal(ms.filter((m) => m.teamAId === slot.id || m.teamBId === slot.id).length, 5);
    },
  ],
  [
    "random pairing: only after close, odd count leaves one over, pending invites untouched",
    async (tx) => {
      const league = await makeLeague(tx, { registrationClosesAt: new Date(Date.now() + 3_600_000), division: "beginner" });
      const solos = [];
      for (let i = 0; i < 5; i++) solos.push(await makeUser(tx));
      for (const u of solos) await registerForLeagueTx(tx, { tournamentId: league.id, userId: u.id });
      const [cap, invitee] = [await makeUser(tx), await makeUser(tx)];
      await registerForLeagueTx(tx, { tournamentId: league.id, userId: cap.id, partnerEmail: invitee.email });

      await rejects(sp(tx, (t) => randomPairFreeAgentsTx(t, { tournamentId: league.id })), LeagueError, /still open/);
      await tx.update(schema.tournaments).set({ registrationClosesAt: new Date(Date.now() - 1000) }).where(eq(schema.tournaments.id, league.id));
      const { pairs, leftover } = await randomPairFreeAgentsTx(tx, { tournamentId: league.id });
      assert.equal(pairs.length, 2);
      assert.ok(leftover);
      const rows = await tx
        .select()
        .from(schema.tmTeamMembers)
        .innerJoin(schema.tmTeams, eq(schema.tmTeams.id, schema.tmTeamMembers.teamId))
        .where(eq(schema.tmTeams.tournamentId, league.id));
      assert.ok(rows.some((r) => r.tm_team_member.memberId === invitee.id && r.tm_team_member.inviteStatus === "pending"));
    },
  ],
  [
    "exec add team: both confirmed at once; refused if someone is already on a team elsewhere",
    async (tx) => {
      const league = await makeLeague(tx);
      const other = await makeLeague(tx, { name: `${tag} Other`, registrationClosesAt: new Date(Date.now() + 3_600_000) });
      const [a, b, c] = [await makeUser(tx), await makeUser(tx), await makeUser(tx)];
      const { teamId } = await execAddTeamTx(tx, { tournamentId: league.id, emailA: a.email, emailB: b.email });
      const roster = await tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, teamId));
      assert.deepEqual(roster.map((r) => r.inviteStatus), ["accepted", "accepted"]);
      await rejects(sp(tx, (t) => execAddTeamTx(t, { tournamentId: other.id, emailA: a.email, emailB: c.email })), LeagueError, /already on a team/);
    },
  ],
  [
    "playoffs: refused while matches are open; seeds 1v4/2v3; winners advance; can't rewrite a decided round",
    async (tx) => {
      const league = await makeLeague(tx);
      const teams = await makeTeams(tx, league.id, 6);
      const exec = await makeUser(tx);
      await generateDraftDrawTx(tx, league.id, { openSlots: 0 });
      await publishDrawTx(tx, league.id);
      await rejects(sp(tx, (t) => generatePlayoffsTx(t, league.id)), TournamentError, /pool_unfinished/);

      // Lower index always wins → T0 is 1st, T1 2nd, ...
      for (const m of await poolMatches(tx, league.id)) {
        const aWins = teams.indexOf(m.teamAId!) < teams.indexOf(m.teamBId!);
        await execSetResultTx(tx, m.id, { kind: "score", games: aWins ? [[11, 5], [11, 6]] : [[5, 11], [6, 11]] }, exec.id);
      }
      const { seeds } = await generatePlayoffsTx(tx, league.id);
      assert.deepEqual(seeds, teams.slice(0, 4));

      const ko = await tx
        .select()
        .from(schema.matches)
        .where(and(eq(schema.matches.tournamentId, league.id), eq(schema.matches.stage, "knockout")));
      const semis = ko.filter((m) => m.round === 1).sort((x, y) => x.slot! - y.slot!);
      const final = ko.find((m) => m.round === 2)!;
      assert.deepEqual(semis.map((m) => [m.teamAId, m.teamBId]), [
        [teams[0], teams[3]],
        [teams[1], teams[2]],
      ]);

      await execSetResultTx(tx, semis[0].id, { kind: "forfeit", winner: "B" }, exec.id); // 4 seed advances
      await execSetResultTx(tx, semis[1].id, { kind: "score", games: [[11, 9], [11, 9]] }, exec.id);
      let [f] = await tx.select().from(schema.matches).where(eq(schema.matches.id, final.id));
      assert.deepEqual([f.teamAId, f.teamBId], [teams[3], teams[1]]);

      await rejects(sp(tx, (t) => execSetResultTx(t, semis[0].id, { kind: "double_forfeit" }, exec.id)), TournamentError, /no_double_forfeit/);
      await execSetResultTx(tx, final.id, { kind: "score", games: [[11, 3], [11, 3]] }, exec.id);
      await rejects(sp(tx, (t) => execSetResultTx(t, semis[0].id, { kind: "reopen" }, exec.id)), TournamentError, /next_round_played/);

      // Reopening the final is allowed and clears nothing upstream.
      await execSetResultTx(tx, final.id, { kind: "reopen" }, exec.id);
      [f] = await tx.select().from(schema.matches).where(eq(schema.matches.id, final.id));
      assert.equal(f.status, "pending");
      assert.equal(f.winnerTeamId, null);
    },
  ],
  [
    "clock: only two emails — Thu 'post a time' (skips posted/reported), Sat 9 AM 'report tonight' (skips reported), each once",
    async (tx) => {
      const league = await makeLeague(tx);
      await makeTeams(tx, league.id, 7); // 8 slots, 1 open → one bye + 3 real matches a week
      const exec = await makeUser(tx);
      await generateDraftDrawTx(tx, league.id, { openSlots: 0 });
      await publishDrawTx(tx, league.id);
      // due1 is Saturday 11:59:59 PM of week 1; offsets below are from there.
      const due1 = weekDueBy(START, 1);
      const at = (days: number, hours: number) => new Date(due1.getTime() - days * 86_400_000 + hours * 3_600_000);

      assert.equal((await leagueTickTx(tx, league.id, at(6, 9))).outbox.length, 0, "no Monday email");

      const slot = (await placeholders(tx, league.id))[0].id;
      const [reported, posted] = (await poolMatches(tx, league.id)).filter((m) => m.round === 1 && m.teamAId !== slot && m.teamBId !== slot);
      await execSetResultTx(tx, reported.id, { kind: "score", games: [[11, 4], [11, 4]] }, exec.id);
      await tx.update(schema.matches).set({ scheduledAt: at(2, -4) }).where(eq(schema.matches.id, posted.id));

      assert.equal((await leagueTickTx(tx, league.id, at(3, -1))).reminderEmails, 0, "nothing before Wed 11:59 PM");
      const thu = await leagueTickTx(tx, league.id, at(3, 1)); // Thu ~1 AM
      assert.equal(thu.reminderEmails, 4, "only the match with no time posted (2 teams × 2 players)");
      assert.ok(thu.outbox.every((m) => m.subject.includes("post your match time")));
      assert.equal((await leagueTickTx(tx, league.id, at(3, 1))).reminderEmails, 0);

      const sat = await leagueTickTx(tx, league.id, at(0, -14)); // Sat ~10 AM
      assert.equal(sat.reportEmails, 8, "both unreported matches, posted or not");
      assert.equal((await leagueTickTx(tx, league.id, at(0, -14))).reportEmails, 0);
    },
  ],
  [
    "clock: unreported → double forfeit Sunday morning; a makeup not played → the team that missed week 1 forfeits a week later",
    async (tx) => {
      const league = await makeLeague(tx);
      await makeTeams(tx, league.id, 4);
      await generateDraftDrawTx(tx, league.id, { openSlots: 0 });
      await publishDrawTx(tx, league.id);
      const [away, normal] = (await poolMatches(tx, league.id)).filter((m) => m.round === 1);
      await tx
        .update(schema.matches)
        .set({ extendedForTeamId: away.teamAId, dueBy: shiftDeadline(away.dueBy!, 1) })
        .where(eq(schema.matches.id, away.id));

      const mondayAfter = (w: number) => new Date(weekDueBy(START, w).getTime() + 11 * 3_600_000); // Sunday ~11 AM
      const r1 = await leagueTickTx(tx, league.id, mondayAfter(1));
      assert.equal(r1.settled, 1);
      const [n1] = await tx.select().from(schema.matches).where(eq(schema.matches.id, normal.id));
      assert.deepEqual([n1.status, n1.winnerTeamId], ["forfeited", null]);
      const [a1] = await tx.select().from(schema.matches).where(eq(schema.matches.id, away.id));
      assert.equal(a1.status, "pending", "the makeup isn't due yet");

      const r2 = await leagueTickTx(tx, league.id, mondayAfter(2));
      const [a2] = await tx.select().from(schema.matches).where(eq(schema.matches.id, away.id));
      assert.deepEqual([a2.status, a2.winnerTeamId], ["forfeited", away.teamBId]);
      assert.equal(r2.outbox.length, 0, "settling sends no email");
    },
  ],
  [
    "player buttons: post time, report, confirm, dispute, admin ruling, can't-make-it — with every guard",
    async (tx) => {
      const league = await makeLeague(tx);
      await makeTeams(tx, league.id, 8);
      await generateDraftDrawTx(tx, league.id, { openSlots: 0 });
      const [m1, m2, m3] = (await poolMatches(tx, league.id)).filter((m) => m.round === 1);
      const roster = async (teamId: string) =>
        (await tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, teamId))).map((r) => r.memberId);
      const [a1, a2] = await roster(m1.teamAId!);
      const [b1] = await roster(m1.teamBId!);
      const outsider = (await roster(m2.teamAId!))[0];
      const due = weekDueBy(START, 1);
      const tue = new Date(due.getTime() - 4 * 86_400_000);

      // Nothing works until the schedule is published.
      await rejects(sp(tx, (t) => postMatchTimeTx(t, { userId: a1, matchId: m1.id, when: tue, note: "" })), LeagueError, /isn't being played/);
      await publishDrawTx(tx, league.id);

      // Post a time: players only, before the deadline; posting again updates it.
      await rejects(sp(tx, (t) => postMatchTimeTx(t, { userId: outsider, matchId: m1.id, when: tue, note: "" })), LeagueError, /not playing/);
      await rejects(sp(tx, (t) => postMatchTimeTx(t, { userId: a1, matchId: m1.id, when: new Date(due.getTime() + 3_600_000), note: "" })), LeagueError, /after the deadline/);
      await postMatchTimeTx(tx, { userId: a1, matchId: m1.id, when: tue, note: "Court 3" });
      await postMatchTimeTx(tx, { userId: b1, matchId: m1.id, when: new Date(tue.getTime() + 3_600_000), note: "Court 4" });
      let [row] = await tx.select().from(schema.matches).where(eq(schema.matches.id, m1.id));
      assert.equal(row.scheduledNote, "Court 4");
      assert.ok(row.scheduledAt! < scheduleBy(due), "posted before the Wednesday cut-off");

      // Report: valid scores only, once; own team can't confirm or dispute; the other team confirms.
      await rejects(sp(tx, (t) => reportScoreTx(t, { userId: a1, matchId: m1.id, games: [[11, 10], [11, 5]] })), LeagueError, /win by|at least 2/i);
      await rejects(sp(tx, (t) => reportScoreTx(t, { userId: outsider, matchId: m1.id, games: [[11, 5], [11, 5]] })), LeagueError, /not playing/);
      const rep = await reportScoreTx(tx, { userId: a1, matchId: m1.id, games: [[11, 5], [9, 11], [11, 7]] });
      assert.equal(rep.notify.length, 3, "the other three players are emailed");
      await rejects(sp(tx, (t) => reportScoreTx(t, { userId: b1, matchId: m1.id, games: [[5, 11], [5, 11]] })), LeagueError, /already has a result/);
      await rejects(sp(tx, (t) => confirmScoreTx(t, { userId: a2, matchId: m1.id })), LeagueError, /other team has to confirm/);
      await rejects(sp(tx, (t) => disputeScoreTx(t, { userId: a2, matchId: m1.id, reason: "x" })), LeagueError, /own team/);
      await confirmScoreTx(tx, { userId: b1, matchId: m1.id });
      [row] = await tx.select().from(schema.matches).where(eq(schema.matches.id, m1.id));
      assert.deepEqual([row.status, row.winnerTeamId], ["confirmed", m1.teamAId]);
      await rejects(sp(tx, (t) => confirmScoreTx(t, { userId: b1, matchId: m1.id })), AlreadyDone);

      // Dispute → admin ruling picks the winner.
      const [c1] = await roster(m2.teamAId!);
      const [d1] = await roster(m2.teamBId!);
      await reportScoreTx(tx, { userId: c1, matchId: m2.id, games: [[11, 2], [11, 2]] });
      await disputeScoreTx(tx, { userId: d1, matchId: m2.id, reason: "We won game 2" });
      [row] = await tx.select().from(schema.matches).where(eq(schema.matches.id, m2.id));
      assert.equal(row.status, "disputed");
      await rejects(sp(tx, (t) => confirmScoreTx(t, { userId: d1, matchId: m2.id })), LeagueError);
      const [report] = await tx.select().from(schema.matchReports).where(eq(schema.matchReports.matchId, m2.id));
      assert.equal(await resolveDisputeTx(tx, { reportId: report.id, winnerTeamId: m2.teamBId! }), true);
      [row] = await tx.select().from(schema.matches).where(eq(schema.matches.id, m2.id));
      assert.deepEqual([row.status, row.winnerTeamId], ["confirmed", m2.teamBId]);

      // Playing ahead: a week-5 match can have its time posted and score reported during week 1, then confirmed.
      const w5 = (await poolMatches(tx, league.id)).find((m) => m.round === 5 && m.teamAId === m1.teamAId)!;
      const [w5b] = await roster(w5.teamBId!);
      await postMatchTimeTx(tx, { userId: a1, matchId: w5.id, when: tue, note: "playing early" });
      await reportScoreTx(tx, { userId: a1, matchId: w5.id, games: [[11, 3], [11, 3]] });
      await confirmScoreTx(tx, { userId: w5b, matchId: w5.id });
      assert.equal((await tx.select().from(schema.matches).where(eq(schema.matches.id, w5.id)))[0].status, "confirmed");

      // Can't make it: pushes a week and clears the posted time; the other team can't skip someone's makeup.
      const [e1] = await roster(m3.teamAId!);
      const [f1] = await roster(m3.teamBId!);
      await postMatchTimeTx(tx, { userId: e1, matchId: m3.id, when: tue, note: "" });
      const first = await skipMatchTx(tx, { userId: e1, matchId: m3.id, now: tue, expect: "makeup" });
      assert.equal(first.outcome, "makeup");
      assert.equal(first.notify.length, 3);
      assert.equal(first.outcome === "makeup" && first.mail.newDueBy.getTime(), weekDueBy(START, 2).getTime());
      [row] = await tx.select().from(schema.matches).where(eq(schema.matches.id, m3.id));
      assert.deepEqual([row.extendedForTeamId, row.scheduledAt], [m3.teamAId, null]);
      await rejects(sp(tx, (t) => skipMatchTx(t, { userId: f1, matchId: m3.id, now: tue, expect: "makeup" })), LeagueError, /other team's makeup/);
    },
  ],
  [
    "full season end to end: sign-ups → pairing → draw → late team → 8 weeks → clock → playoffs → champion",
    async (tx) => {
      // 1. Sign-ups: 9 pairs, one invite accepted, 4 free agents, and a closed deadline.
      const league = await makeLeague(tx, { registrationClosesAt: new Date(Date.now() + 3_600_000), roundRobinWeeks: 8, catchupWeeks: 0 });
      await makeTeams(tx, league.id, 8);
      const [cap, mate] = [await makeUser(tx), await makeUser(tx)];
      const invited = await registerForLeagueTx(tx, { tournamentId: league.id, userId: cap.id, partnerEmail: mate.email });
      await respondToInviteTx(tx, { teamId: invited.teamId, userId: mate.id, accept: true });
      const fas = [await makeUser(tx), await makeUser(tx), await makeUser(tx), await makeUser(tx)];
      const faTeams = [];
      for (const u of fas) faTeams.push((await registerForLeagueTx(tx, { tournamentId: league.id, userId: u.id })).teamId);
      await tx.update(schema.tournaments).set({ registrationClosesAt: new Date(Date.now() - 1000) }).where(eq(schema.tournaments.id, league.id));

      // 2. Exec hand-pairs two, random-pairs the rest → 11 teams.
      await pairFreeAgentsTx(tx, { teamAId: faTeams[0], teamBId: faTeams[1] });
      const random = await randomPairFreeAgentsTx(tx, { tournamentId: league.id });
      assert.deepEqual([random.pairs.length, random.leftover], [1, null]);

      // 3. Draw: 11 teams → 1 open slot; 8 weeks.
      const draw = await generateDraftDrawTx(tx, league.id, { openSlots: 0 });
      assert.deepEqual(draw, { teamCount: 11, openSlots: 1, weeks: 8 });
      await publishDrawTx(tx, league.id);

      // 4. Late team added and slotted before week 1 → no byes all season.
      const [l1, l2] = [await makeUser(tx), await makeUser(tx)];
      const late = await execAddTeamTx(tx, { tournamentId: league.id, emailA: l1.email, emailB: l2.email });
      const [slot] = await placeholders(tx, league.id);
      await fillOpenSlotTx(tx, slot.id, late.teamId, new Date(weekDueBy(START, 1).getTime() - 6 * 86_400_000));
      const all = await poolMatches(tx, league.id);
      assert.ok(all.every((m) => m.teamAId !== slot.id && m.teamBId !== slot.id), "no byes left");

      // 5. Play 8 weeks: lower team id wins; one match per week left unreported for the clock.
      const ids = [...new Set(all.flatMap((m) => [m.teamAId!, m.teamBId!]))].sort();
      for (let w = 1; w <= 8; w++) {
        const week = all.filter((m) => m.round === w);
        for (const m of week.slice(1)) {
          const aWins = ids.indexOf(m.teamAId!) < ids.indexOf(m.teamBId!);
          const reporter = (await tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, m.teamAId!)))[0].memberId;
          await reportScoreTx(tx, { userId: reporter, matchId: m.id, games: aWins ? [[11, 6], [11, 6]] : [[6, 11], [6, 11]] });
        }
        // Sunday after the deadline: the dispute window (24h) has closed for these, and week[0] was never reported.
        const tick = await leagueTickTx(tx, league.id, new Date(weekDueBy(START, w).getTime() + 30 * 3_600_000));
        assert.equal(tick.confirmed, week.length - 1, `week ${w} auto-confirmed`);
        assert.equal(tick.settled, 1, `week ${w} unreported match settled`);
      }
      const done = await poolMatches(tx, league.id);
      assert.ok(done.every((m) => m.status === "confirmed" || m.status === "forfeited"));
      assert.equal(done.filter((m) => m.status === "forfeited" && m.winnerTeamId === null).length, 8, "8 double forfeits");

      // 6. Playoffs: top 4, semis then final, winners advance via member report + confirm.
      const { seeds } = await generatePlayoffsTx(tx, league.id);
      assert.equal(seeds.length, 4);
      const ko = async () =>
        (await tx.select().from(schema.matches).where(and(eq(schema.matches.tournamentId, league.id), eq(schema.matches.stage, "knockout")))).sort(
          (a, b) => a.round! - b.round! || a.slot! - b.slot!,
        );
      const play = async (matchId: string, teamAId: string, teamBId: string) => {
        const [ra] = (await tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, teamAId))).map((r) => r.memberId);
        const [rb] = (await tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, teamBId))).map((r) => r.memberId);
        await reportScoreTx(tx, { userId: ra, matchId, games: [[11, 8], [11, 8]] });
        await confirmScoreTx(tx, { userId: rb, matchId });
      };
      let bracket = await ko();
      const [inSemi] = (await tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, bracket[0].teamAId!))).map((r) => r.memberId);
      await rejects(sp(tx, (t) => skipMatchTx(t, { userId: inSemi, matchId: bracket[0].id, expect: "makeup" })), LeagueError, /Playoff/);
      for (const m of bracket.filter((x) => x.round === 1)) await play(m.id, m.teamAId!, m.teamBId!);
      bracket = await ko();
      const final = bracket.find((x) => x.round === 2)!;
      assert.deepEqual([final.teamAId, final.teamBId], [seeds[0], seeds[1]], "1 and 2 seeds meet in the final");
      await play(final.id, final.teamAId!, final.teamBId!);
      const [champ] = (await ko()).filter((x) => x.round === 2);
      assert.deepEqual([champ.status, champ.winnerTeamId], ["confirmed", seeds[0]]);
    },
  ],
  [
    "one skip per season: 1st skip → makeup; 2nd skip → instant forfeit; own makeup → forfeit; week 8 → forfeit; stale tab refused",
    async (tx) => {
      const league = await makeLeague(tx, { roundRobinWeeks: 8, catchupWeeks: 0 });
      const teams = await makeTeams(tx, league.id, 10);
      await generateDraftDrawTx(tx, league.id, { openSlots: 0 });
      await publishDrawTx(tx, league.id);
      const ms = await poolMatches(tx, league.id);
      const team = teams[0];
      const [player] = (await tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, team))).map((r) => r.memberId);
      const mine = (w: number) => ms.find((m) => m.round === w && (m.teamAId === team || m.teamBId === team))!;
      const other = (m: (typeof ms)[number]) => (m.teamAId === team ? m.teamBId! : m.teamAId!);
      const inWeek = (w: number) => new Date(weekDueBy(START, w).getTime() - 4 * 86_400_000); // Tuesday night
      const get = async (id: string) => (await tx.select().from(schema.matches).where(eq(schema.matches.id, id)))[0];

      // Week 1: first skip → makeup due week 2.
      const w1 = mine(1);
      assert.equal((await skipMatchTx(tx, { userId: player, matchId: w1.id, now: inWeek(1), expect: "makeup" })).outcome, "makeup");
      assert.equal((await get(w1.id)).dueBy!.getTime(), weekDueBy(START, 2).getTime());

      // Week 2, a different match: a stale "makeup" button is refused (nothing changes)...
      const w2 = mine(2);
      await rejects(sp(tx, (t) => skipMatchTx(t, { userId: player, matchId: w2.id, now: inWeek(2), expect: "makeup" })), LeagueError, /skip was just used/);
      assert.equal((await get(w2.id)).status, "pending");
      // ...and the real one forfeits it to the opponent, right away.
      const f = await skipMatchTx(tx, { userId: player, matchId: w2.id, now: inWeek(2), expect: "forfeit" });
      assert.equal(f.outcome, "forfeit");
      assert.equal(f.outcome === "forfeit" && f.reason, "skip_used");
      assert.deepEqual([(await get(w2.id)).status, (await get(w2.id)).winnerTeamId], ["forfeited", other(w2)]);

      // Can't make their own makeup (week 1's, now due week 2) → forfeit to the opponent.
      const own = await skipMatchTx(tx, { userId: player, matchId: w1.id, now: inWeek(2), expect: "forfeit" });
      assert.equal(own.outcome === "forfeit" && own.reason, "own_makeup");
      assert.deepEqual([(await get(w1.id)).status, (await get(w1.id)).winnerTeamId], ["forfeited", other(w1)]);

      // Week 3: still a forfeit (the limit is per season, not per week).
      assert.equal((await skipMatchTx(tx, { userId: player, matchId: mine(3).id, now: inWeek(3), expect: "forfeit" })).outcome, "forfeit");

      // A team with its skip unused: week 8 has no makeup week, so skipping it is a forfeit — and it doesn't use up the skip.
      const fresh = teams[5];
      const [freshPlayer] = (await tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, fresh))).map((r) => r.memberId);
      const w8 = ms.find((m) => m.round === 8 && (m.teamAId === fresh || m.teamBId === fresh))!;
      const r8 = await skipMatchTx(tx, { userId: freshPlayer, matchId: w8.id, now: inWeek(8), expect: "forfeit" });
      assert.equal(r8.outcome === "forfeit" && r8.reason, "no_week_left");
      assert.equal(
        (await tx.select().from(schema.matches).where(and(eq(schema.matches.tournamentId, league.id), eq(schema.matches.extendedForTeamId, fresh)))).length,
        0,
      );

      // Past the deadline: nothing.
      await rejects(sp(tx, (t) => skipMatchTx(t, { userId: player, matchId: mine(4).id, now: new Date(weekDueBy(START, 4).getTime() + 60_000), expect: "forfeit" })), LeagueError, /deadline has passed/);
    },
  ],
];

/**
 * Two skips at the same instant, on two different matches, from separate
 * connections: exactly one may become the free makeup; the other must be
 * refused. Needs committed rows (a rolled-back transaction can't race
 * itself), so it builds a hidden one-day-kind league and deletes it after.
 */
async function skipRace(): Promise<void> {
  const ids: { league?: string; users: string[] } = { users: [] };
  try {
    const setup = await conn.transaction(async (tx) => {
      const league = await makeLeague(tx, { kind: "one_day", name: `${tag} race` });
      ids.league = league.id;
      const teams = await makeTeams(tx, league.id, 4);
      await generateDraftDrawTx(tx, league.id, { openSlots: 0 });
      await publishDrawTx(tx, league.id);
      const members = await tx.select().from(schema.tmTeamMembers);
      const mine = members.filter((m) => teams.includes(m.teamId));
      ids.users = mine.map((m) => m.memberId);
      const ms = await poolMatches(tx, league.id);
      const player = mine.find((m) => m.teamId === teams[0])!.memberId;
      const two = ms.filter((m) => (m.round === 1 || m.round === 2) && (m.teamAId === teams[0] || m.teamBId === teams[0]));
      return { player, matchIds: two.map((m) => m.id) };
    });

    const now = new Date(weekDueBy(START, 1).getTime() - 4 * 86_400_000);
    const results = await Promise.allSettled(
      setup.matchIds.map((matchId) => conn.transaction((tx) => skipMatchTx(tx, { userId: setup.player, matchId, now, expect: "makeup" }))),
    );
    const won = results.filter((r) => r.status === "fulfilled").length;
    const refused = results.filter((r) => r.status === "rejected" && r.reason instanceof LeagueError && /skip was just used/.test(r.reason.message)).length;
    assert.deepEqual([won, refused], [1, 1], `expected exactly one makeup; got ${JSON.stringify(results.map((r) => r.status))}`);
  } finally {
    if (ids.league) await conn.delete(schema.tournaments).where(eq(schema.tournaments.id, ids.league));
    for (const id of ids.users) await conn.delete(schema.users).where(eq(schema.users.id, id));
  }
}

async function main() {
  let failed = 0;
  for (const [name, run] of scenarios) {
    try {
      await conn.transaction(async (tx) => {
        await run(tx);
        throw new Rollback();
      });
    } catch (e) {
      if (e instanceof Rollback) {
        console.log(`  ✓ ${name}`);
        continue;
      }
      failed++;
      console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    await skipRace();
    console.log("  ✓ race: two skips at the same instant → exactly one makeup, the other refused");
  } catch (e) {
    failed++;
    console.log(`  ✗ race: two skips at the same instant\n      ${e instanceof Error ? e.message : e}`);
  }

  // Nothing tagged may survive: scenarios roll back, and the race cleans up after itself.
  const leftovers = await conn.select({ id: schema.users.id }).from(schema.users).where(like(schema.users.email, `${tag}-%`));
  const leftLeagues = await conn.select({ id: schema.tournaments.id }).from(schema.tournaments).where(like(schema.tournaments.name, `${tag}%`));
  await pool.end();
  const total = scenarios.length + 1;
  const leaked = leftovers.length + leftLeagues.length;
  console.log(`\n${total - failed}/${total} passed${leaked ? " — WARNING: test rows leaked" : ""}`);
  process.exit(failed || leaked ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
