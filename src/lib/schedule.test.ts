import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  balancedSlotOrder,
  bracketSeedPairs,
  matchLabel,
  nextBracketSpot,
  pushbackDecision,
  PUSHBACK_LIMIT,
  overdueOutcome,
  playoffRounds,
  recommendedPlayoffTeams,
  reminderDue,
  reminderSlot,
  halfwayWeek,
  poolDueBy,
  postTimeProblem,
  roundRobinRounds,
  scheduleSpread,
  shiftDeadline,
  slotCount,
  teamStrength,
  weekDueBy,
  weekOf,
  weekRange,
  currentWeek,
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

test("calendar: each week's match is due the Sunday after, 11:59 PM Pacific", () => {
  assert.equal(addDays("2026-10-05", 6), "2026-10-11");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(formatDeadline(weekDueBy(FALL.seasonStartsOn, 1)), "Sun, Oct 11 · 11:59 PM PDT");
  // Across the Nov 1 DST change the deadline stays 11:59 PM local.
  assert.equal(formatDeadline(weekDueBy(FALL.seasonStartsOn, 5)), "Sun, Nov 8 · 11:59 PM PST");
  assert.equal(formatDeadline(shiftDeadline(weekDueBy(FALL.seasonStartsOn, 4), 1)), "Sun, Nov 8 · 11:59 PM PST");
});

test("currentWeek: the overlap Sunday still belongs to the week due that night", () => {
  assert.equal(currentWeek("2026-10-05", new Date("2026-10-04T10:00:00-07:00")), 1);
  assert.equal(currentWeek("2026-10-05", new Date("2026-10-10T20:00:00-07:00")), 1);
  assert.equal(currentWeek("2026-10-05", new Date("2026-10-11T21:00:00-07:00")), 1);
  assert.equal(currentWeek("2026-10-05", new Date("2026-10-12T00:30:00-07:00")), 2);
  assert.equal(currentWeek("2026-10-05", new Date("2026-10-03T12:00:00-07:00")), 0);
});

test("weekOf maps instants to season weeks", () => {
  // Weeks run Sunday–Saturday: week 1 is Sun Oct 4 – Sat Oct 10.
  assert.equal(weekOf("2026-10-05", new Date("2026-10-03T12:00:00-07:00")), 0);
  assert.equal(weekOf("2026-10-05", new Date("2026-10-04T00:30:00-07:00")), 1);
  assert.equal(weekOf("2026-10-05", new Date("2026-10-10T23:59:00-07:00")), 1);
  assert.equal(weekOf("2026-10-05", new Date("2026-10-11T00:01:00-07:00")), 2);
});

test("weekly reminders: Wednesday and Sunday 9 AM, each sent once, never a day late", () => {
  const at = (iso: string) => new Date(iso);
  // Wed Oct 21 9 AM PDT and Sun Oct 25 9 AM PDT are the slots.
  assert.equal(reminderSlot(at("2026-10-21T08:59:00-07:00")), null);
  assert.equal(formatDeadline(reminderSlot(at("2026-10-21T09:00:00-07:00"))!), "Wed, Oct 21 · 9:00 AM PDT");
  assert.equal(formatDeadline(reminderSlot(at("2026-10-22T08:30:00-07:00"))!), "Wed, Oct 21 · 9:00 AM PDT");
  assert.equal(reminderSlot(at("2026-10-22T09:30:00-07:00")), null, "more than a day late");
  assert.equal(reminderSlot(at("2026-10-23T12:00:00-07:00")), null, "Friday");
  assert.equal(formatDeadline(reminderSlot(at("2026-10-25T10:00:00-07:00"))!), "Sun, Oct 25 · 9:00 AM PDT");
  // After DST ends it's still 9 AM local.
  assert.equal(formatDeadline(reminderSlot(at("2026-11-04T09:05:00-08:00"))!), "Wed, Nov 4 · 9:00 AM PST");

  const wed = at("2026-10-21T10:00:00-07:00");
  assert.equal(reminderDue(null, wed), true);
  assert.equal(reminderDue(at("2026-10-21T09:00:00-07:00"), wed), false, "already sent this slot");
  assert.equal(reminderDue(at("2026-10-18T09:00:00-07:00"), wed), true, "last Sunday's doesn't count");
  assert.equal(reminderDue(null, at("2026-10-23T12:00:00-07:00")), false);
});

test("halves: weeks 1–4 due at the halfway point, weeks 5–8 at the end of the round robin", () => {
  const eight = { ...FALL, roundRobinWeeks: 8, catchupWeeks: 0 };
  assert.equal(halfwayWeek(eight), 4);
  assert.equal(halfwayWeek(FALL), 4);
  assert.equal(formatDeadline(poolDueBy(eight, 1)), "Sun, Nov 1 · 11:59 PM PST");
  assert.equal(formatDeadline(poolDueBy(eight, 4)), "Sun, Nov 1 · 11:59 PM PST");
  assert.equal(formatDeadline(poolDueBy(eight, 5)), "Sun, Nov 29 · 11:59 PM PST");
  assert.equal(formatDeadline(poolDueBy(eight, 8)), "Sun, Nov 29 · 11:59 PM PST");
  // Catch-up weeks extend the second half.
  assert.equal(formatDeadline(poolDueBy(FALL, 7)), "Sun, Nov 29 · 11:59 PM PST");
});

test("posting a match time: must be before the score deadline, only while unplayed", () => {
  const due = weekDueBy(FALL.seasonStartsOn, 1);
  const m = { status: "pending", dueBy: due };
  assert.equal(postTimeProblem(m, new Date("2026-10-08T19:00:00-07:00")), null);
  // Sunday after the week still counts; Monday doesn't.
  assert.equal(postTimeProblem(m, new Date("2026-10-11T18:00:00-07:00")), null);
  assert.match(postTimeProblem(m, new Date("2026-10-12T10:00:00-07:00"))!, /after the deadline/);
  assert.match(postTimeProblem({ ...m, status: "confirmed" }, new Date("2026-10-08T19:00:00-07:00"))!, /already has a result/);
});

test("fall plan: 7 weeks, Thanksgiving catch-up, QF/SF/final ending Sat Dec 12", () => {
  const rounds = playoffRounds(FALL);
  assert.deepEqual(
    rounds.map((r) => [r.name, formatDeadline(r.dueBy)]),
    [
      ["Quarterfinals", "Sun, Dec 6 · 11:59 PM PST"],
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
      ["Semifinals", "Sun, Dec 6 · 11:59 PM PST"],
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

test("push-back: one first-half match per team, to the second-half deadline", () => {
  assert.equal(PUSHBACK_LIMIT, 1);
  const eight = { ...FALL, roundRobinWeeks: 8, catchupWeeks: 0 };
  const base = { stage: "pool" as const, status: "pending" as const, extendedForTeamId: null };
  const wk2 = { ...base, round: 2, dueBy: poolDueBy(eight, 2) };
  const before = new Date("2026-10-23T12:00:00-07:00");
  const fresh = { teamId: "A", pushbacksUsed: 0 };

  const ok = pushbackDecision(wk2, fresh, before, eight);
  assert.equal(ok.kind, "allowed");
  assert.equal(ok.kind === "allowed" && formatDeadline(ok.newDueBy), "Sun, Nov 29 · 11:59 PM PST");

  const blocked = (m: Parameters<typeof pushbackDecision>[0], team = fresh, now = before) => {
    const d = pushbackDecision(m, team, now, eight);
    return d.kind === "blocked" ? d.message : null;
  };
  assert.match(blocked(wk2, { teamId: "A", pushbacksUsed: 1 })!, /already used/);
  assert.match(blocked({ ...wk2, extendedForTeamId: "A" })!, /already been pushed back/);
  assert.match(blocked({ ...wk2, extendedForTeamId: "B" })!, /already been pushed back/);
  assert.match(blocked({ ...base, round: 5, dueBy: poolDueBy(eight, 5) })!, /first-half/);
  assert.match(blocked({ ...wk2, stage: "knockout" })!, /Playoff/);
  assert.match(blocked({ ...wk2, status: "reported" })!, /already has a result/);
  assert.equal(blocked(wk2, fresh, new Date("2026-11-01T22:00:00-08:00")), null, "the halfway Sunday is still before the deadline");
  assert.match(blocked(wk2, fresh, new Date("2026-11-02T09:00:00-08:00"))!, /deadline has passed/);
});

test("overdue: the team that pushed a match back forfeits it unplayed; otherwise double forfeit", () => {
  assert.deepEqual(overdueOutcome({ teamAId: "a", teamBId: "b", extendedForTeamId: "a" }), { winnerTeamId: "b" });
  assert.deepEqual(overdueOutcome({ teamAId: "a", teamBId: "b", extendedForTeamId: "b" }), { winnerTeamId: "a" });
  assert.deepEqual(overdueOutcome({ teamAId: "a", teamBId: "b", extendedForTeamId: null }), { winnerTeamId: null });
});

test("labels: week ranges cross months, pushed-back matches and playoff rounds are named", () => {
  assert.equal(weekRange("2026-10-05", 1), "Oct 4 – 11");
  assert.equal(weekRange("2026-10-05", 2), "Oct 11 – 18");
  assert.equal(weekRange("2026-10-05", 9), "Nov 29 – Dec 6");
  // The range ends on the day the match is actually due.
  assert.equal(formatDeadline(weekDueBy("2026-10-05", 1)).slice(0, 11), "Sun, Oct 11");
  const season = { seasonStartsOn: "2026-10-05", playoffTeams: 8 };
  assert.equal(matchLabel({ stage: "pool", round: 3, extendedForTeamId: null }, season), "Week 3");
  assert.equal(matchLabel({ stage: "pool", round: 2, extendedForTeamId: "x" }, season), "Week 2 · pushed back");
  assert.equal(matchLabel({ stage: "knockout", round: 1, extendedForTeamId: null }, season), "Quarterfinals");
  assert.equal(matchLabel({ stage: "knockout", round: 3, extendedForTeamId: null }, season), "Final");
});
