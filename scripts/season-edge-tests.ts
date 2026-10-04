/**
 * Pickleball League season engine checks, run against the REAL database:
 *
 *   npm run test:season
 *
 * Same safety model as test:league — every scenario runs in its own
 * transaction that is always rolled back, on a throwaway league and users.
 * Real leagues are never read, locked, or changed.
 *
 * Covers: the weekly draw (one match per team per week, no repeats, open
 * slots), swapping teams, a late team taking an open slot mid-season without
 * moving anyone else, withdrawals, random free-agent pairing, exec-added
 * teams, the playoff bracket advancing winners, and the hourly league clock
 * (Monday matchup emails, Thursday reminders, out-of-town makeups, and
 * settling unreported matches).
 */
import assert from "node:assert/strict";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Tx } from "../src/db/pool";
import { execAddTeamTx, LeagueError, randomPairFreeAgentsTx, registerForLeagueTx } from "../src/lib/league";
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
import { addDays, shiftDeadline, weekDueBy } from "../src/lib/schedule";
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

async function rejects(p: Promise<unknown>, kind: typeof TournamentError | typeof LeagueError, pattern?: RegExp) {
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
];

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

  const leftovers = await conn.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, `${tag}-1@berkeley.edu`));
  await pool.end();
  console.log(`\n${scenarios.length - failed}/${scenarios.length} passed${leftovers.length ? " — WARNING: test rows leaked" : ""}`);
  process.exit(failed || leftovers.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
