import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  balancedSlotOrder,
  bracketSeedPairs,
  matchLabel,
  nextBracketSpot,
  skipDecision,
  SKIP_LIMIT,
  overdueOutcome,
  playoffRounds,
  recommendedPlayoffTeams,
  reportReminderAt,
  scheduleBy,
  postTimeProblem,
  roundRobinRounds,
  scheduleSpread,
  shiftDeadline,
  slotCount,
  teamStrength,
  weekDueBy,
  weekOf,
  weekRange,
  type SeasonConfig,
} from "./schedule.ts";
import { formatDeadline } from "./dates.ts";

const FALL: SeasonConfig = {
  seasonStartsOn: "2026-10-05",
  roundRobinWeeks: 7,
  catchupWeeks: 1,
  playoffTeams: 8,
  finalOn: "2026-12-12",
};

const ids = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

/** Deterministic rng so balancing tests are repeatable. */
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

test("every slot plays exactly once per round", () => {
  for (const n of [4, 12, 30]) {
    for (const round of roundRobinRounds(ids(n), Math.min(7, n - 1))) {
      const seen = round.flat();
      assert.equal(seen.length, n);
      assert.equal(new Set(seen).size, n);
    }
  }
});

test("nobody plays the same opponent twice, even across a full n-1 rounds", () => {
  for (const n of [8, 12, 30]) {
    const pairs = roundRobinRounds(ids(n), n - 1).flat().map(([a, b]) => [a, b].sort().join("-"));
    assert.equal(new Set(pairs).size, pairs.length);
    assert.equal(pairs.length, (n * (n - 1)) / 2);
  }
});

test("the first 7 rounds are a prefix of the full schedule — a late slot fill never reshuffles anyone", () => {
  const full = roundRobinRounds(ids(12), 11);
  assert.deepEqual(roundRobinRounds(ids(12), 7), full.slice(0, 7));
});

test("odd slot counts and too many rounds are refused", () => {
  assert.throws(() => roundRobinRounds(ids(5), 3));
  assert.throws(() => roundRobinRounds(ids(6), 6));
});

test("slot count rounds up to even, plus reserved late-team slots", () => {
  assert.equal(slotCount(29, 0), 30); // one open slot: a late team fills it, no byes
  assert.equal(slotCount(30, 0), 30);
  assert.equal(slotCount(30, 1), 32);
  assert.equal(slotCount(11, 1), 12);
});

test("team strength ranks comp above advanced above beginner", () => {
  assert.ok(teamStrength(["comp", "comp"]) > teamStrength(["advanced", "advanced"]));
  assert.ok(teamStrength(["advanced", "unknown"]) > teamStrength(["beginner", "beginner"]));
});

test("balancing spreads strong teams instead of stacking someone's schedule", () => {
  const teams = ids(30).map((id, i) => ({ id, strength: i < 4 ? 6 : 3 }));
  const rng = seeded(7);
  const naive = scheduleSpread(teams, 7);
  const balanced = balancedSlotOrder(teams, 7, rng);
  const spread = scheduleSpread(balanced.map((id) => teams.find((t) => t.id === id)!), 7);
  assert.ok(spread <= naive, `balanced ${spread} should not be worse than unshuffled ${naive}`);
  assert.equal(new Set(balanced).size, 30);
});

test("open slots don't count toward anyone's opponent strength", () => {
  const teams = [
    { id: "a", strength: 3 },
    { id: "b", strength: 3 },
    { id: "c", strength: 3 },
    { id: "open", strength: 0, placeholder: true },
  ];
  // Everyone faces the two other real teams in 3 rounds — no one is advantaged by the bye.
  assert.equal(scheduleSpread(teams, 3), 0);
});

test("calendar: scores are due Saturday 11:59 PM Pacific", () => {
  assert.equal(addDays("2026-10-05", 6), "2026-10-11");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(formatDeadline(weekDueBy(FALL.seasonStartsOn, 1)), "Sat, Oct 10 · 11:59 PM PDT");
  // Across the Nov 1 DST change the deadline stays 11:59 PM local.
  assert.equal(formatDeadline(weekDueBy(FALL.seasonStartsOn, 5)), "Sat, Nov 7 · 11:59 PM PST");
  assert.equal(formatDeadline(shiftDeadline(weekDueBy(FALL.seasonStartsOn, 4), 1)), "Sat, Nov 7 · 11:59 PM PST");
});

test("weekOf maps instants to season weeks", () => {
  // Weeks run Sunday–Saturday: week 1 is Sun Oct 4 – Sat Oct 10.
  assert.equal(weekOf("2026-10-05", new Date("2026-10-03T12:00:00-07:00")), 0);
  assert.equal(weekOf("2026-10-05", new Date("2026-10-04T00:30:00-07:00")), 1);
  assert.equal(weekOf("2026-10-05", new Date("2026-10-10T23:59:00-07:00")), 1);
  assert.equal(weekOf("2026-10-05", new Date("2026-10-11T00:01:00-07:00")), 2);
});

test("weekly clock: post-a-time cut-off Wed 11:59 PM, report reminder Sat 9 AM", () => {
  const due = weekDueBy(FALL.seasonStartsOn, 1);
  assert.equal(formatDeadline(scheduleBy(due)), "Wed, Oct 7 · 11:59 PM PDT");
  assert.equal(formatDeadline(reportReminderAt(due)), "Sat, Oct 10 · 9:00 AM PDT");
  // A Thursday playoff deadline still uses that week's Wednesday.
  const semis = playoffRounds(FALL)[1].dueBy;
  assert.equal(formatDeadline(scheduleBy(semis)), "Wed, Dec 9 · 11:59 PM PST");
});

test("posting a match time: must be before the score deadline, only while unplayed", () => {
  const due = weekDueBy(FALL.seasonStartsOn, 1);
  const m = { status: "pending", dueBy: due };
  assert.equal(postTimeProblem(m, new Date("2026-10-08T19:00:00-07:00")), null);
  assert.match(postTimeProblem(m, new Date("2026-10-11T10:00:00-07:00"))!, /after the deadline/);
  assert.match(postTimeProblem({ ...m, status: "confirmed" }, new Date("2026-10-08T19:00:00-07:00"))!, /already has a result/);
});

test("fall plan: 7 weeks, Thanksgiving catch-up, QF/SF/final ending Sat Dec 12", () => {
  const rounds = playoffRounds(FALL);
  assert.deepEqual(
    rounds.map((r) => [r.name, formatDeadline(r.dueBy)]),
    [
      ["Quarterfinals", "Sat, Dec 5 · 11:59 PM PST"],
      ["Semifinals", "Thu, Dec 10 · 11:59 PM PST"],
      ["Final", "Sat, Dec 12 · 11:59 PM PST"],
    ],
  );
});

test("a 4-team playoff gets a full week for semis", () => {
  const rounds = playoffRounds({ ...FALL, playoffTeams: 4 });
  assert.deepEqual(
    rounds.map((r) => [r.name, formatDeadline(r.dueBy)]),
    [
      ["Semifinals", "Sat, Dec 5 · 11:59 PM PST"],
      ["Final", "Sat, Dec 12 · 11:59 PM PST"],
    ],
  );
});

test("a playoff too big to fit before the final is refused", () => {
  assert.throws(() => playoffRounds({ ...FALL, playoffTeams: 16 }), /Not enough weeks/);
  assert.throws(() => playoffRounds({ ...FALL, playoffTeams: 6 }), /2, 4, 8 or 16/);
});

test("recommended playoff size: ~a third of the league, and it has to fit", () => {
  assert.equal(recommendedPlayoffTeams(30, FALL), 8);
  assert.equal(recommendedPlayoffTeams(12, FALL), 4);
  assert.equal(recommendedPlayoffTeams(10, FALL), 4);
  assert.equal(recommendedPlayoffTeams(5, FALL), 2);
  assert.equal(recommendedPlayoffTeams(60, FALL), 8); // 16 wouldn't fit
});

test("bracket seeding keeps the top two apart until the final", () => {
  assert.deepEqual(bracketSeedPairs(4), [
    [1, 4],
    [2, 3],
  ]);
  assert.deepEqual(bracketSeedPairs(8), [
    [1, 8],
    [4, 5],
    [2, 7],
    [3, 6],
  ]);
  assert.deepEqual(nextBracketSpot(0), { slot: 0, side: "A" });
  assert.deepEqual(nextBracketSpot(3), { slot: 1, side: "B" });
});

test("skips: one makeup per team per season; every skip after that is a forfeit", () => {
  assert.equal(SKIP_LIMIT, 1);
  const seasonEnd = weekDueBy(FALL.seasonStartsOn, 8);
  const base = { stage: "pool" as const, status: "pending" as const, extendedForTeamId: null };
  const wk1 = { ...base, dueBy: weekDueBy(FALL.seasonStartsOn, 1) };
  const before = new Date("2026-10-08T12:00:00-07:00");
  const fresh = { teamId: "A", skipsUsed: 0 };

  // First skip → makeup. Second → forfeit, no matter which match.
  assert.deepEqual(skipDecision(wk1, fresh, before, seasonEnd), { kind: "makeup" });
  assert.deepEqual(skipDecision(wk1, { teamId: "A", skipsUsed: 1 }, before, seasonEnd), { kind: "forfeit", reason: "skip_used" });
  assert.deepEqual(skipDecision(wk1, { teamId: "A", skipsUsed: 3 }, before, seasonEnd), { kind: "forfeit", reason: "skip_used" });

  // Can't make your own makeup → forfeit (even though that skip is already counted).
  const makeup = { ...wk1, extendedForTeamId: "A" };
  assert.deepEqual(skipDecision(makeup, { teamId: "A", skipsUsed: 1 }, before, seasonEnd), { kind: "forfeit", reason: "own_makeup" });
  // The other team on someone else's makeup can't skip it — nothing to do; the asker forfeits at the deadline.
  assert.match((skipDecision(makeup, { teamId: "B", skipsUsed: 0 }, before, seasonEnd) as { message: string }).message, /other team's makeup/);

  // Week 8 has no makeup week → skipping it is a forfeit even with a skip left; week 7 can still go to week 8.
  const wk7 = { ...base, dueBy: weekDueBy(FALL.seasonStartsOn, 7) };
  const wk8 = { ...base, dueBy: weekDueBy(FALL.seasonStartsOn, 8) };
  assert.deepEqual(skipDecision(wk7, fresh, new Date("2026-11-17T12:00:00-08:00"), seasonEnd), { kind: "makeup" });
  assert.deepEqual(skipDecision(wk8, fresh, new Date("2026-11-24T12:00:00-08:00"), seasonEnd), { kind: "forfeit", reason: "no_week_left" });

  // Never: playoffs, finished, or past the deadline.
  assert.equal(skipDecision({ ...wk1, stage: "knockout" }, fresh, before, seasonEnd).kind, "blocked");
  assert.equal(skipDecision({ ...wk1, status: "reported" }, fresh, before, seasonEnd).kind, "blocked");
  assert.equal(skipDecision(wk1, fresh, new Date("2026-10-11T09:00:00-07:00"), seasonEnd).kind, "blocked");
});

test("overdue: the out-of-town team forfeits an unplayed makeup; otherwise double forfeit", () => {
  assert.deepEqual(overdueOutcome({ teamAId: "a", teamBId: "b", extendedForTeamId: "a" }), { winnerTeamId: "b" });
  assert.deepEqual(overdueOutcome({ teamAId: "a", teamBId: "b", extendedForTeamId: "b" }), { winnerTeamId: "a" });
  assert.deepEqual(overdueOutcome({ teamAId: "a", teamBId: "b", extendedForTeamId: null }), { winnerTeamId: null });
});

test("labels: week ranges cross months, makeups and playoff rounds are named", () => {
  assert.equal(weekRange("2026-10-05", 1), "Oct 4 – 10");
  assert.equal(weekRange("2026-10-05", 2), "Oct 11 – 17");
  assert.equal(weekRange("2026-10-05", 9), "Nov 29 – Dec 5");
  const season = { seasonStartsOn: "2026-10-05", playoffTeams: 8 };
  assert.equal(matchLabel({ stage: "pool", round: 3, extendedForTeamId: null }, season), "Week 3 · Oct 18 – 24");
  assert.equal(matchLabel({ stage: "pool", round: 2, extendedForTeamId: "x" }, season), "Makeup (week 2)");
  assert.equal(matchLabel({ stage: "knockout", round: 1, extendedForTeamId: null }, season), "Quarterfinals");
  assert.equal(matchLabel({ stage: "knockout", round: 3, extendedForTeamId: null }, season), "Final");
});
