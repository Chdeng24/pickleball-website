import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStandings, type PoolMatch } from "./standings.ts";

/** Helper: games are always written from teamA's perspective. */
const m = (
  teamAId: string,
  teamBId: string,
  winnerTeamId: string,
  games: number[][],
): PoolMatch => ({ teamAId, teamBId, winnerTeamId, games });

/** teamA wins 2-0. */
const sweep = [
  [11, 0],
  [11, 0],
];
/** teamB wins 2-0. */
const swept = [
  [0, 11],
  [0, 11],
];
/** teamA wins 2-1, every game tight. */
const close = [
  [12, 10],
  [10, 12],
  [12, 10],
];
const order = (s: { teamId: string }[]) => s.map((x) => x.teamId);

test("orders a pool by match wins when nothing is tied", () => {
  const teams = ["T1", "T2", "T3", "T4"];
  const matches = [
    m("T1", "T2", "T1", sweep),
    m("T1", "T3", "T1", sweep),
    m("T1", "T4", "T1", sweep),
    m("T2", "T3", "T2", sweep),
    m("T2", "T4", "T2", sweep),
    m("T3", "T4", "T3", sweep),
  ];
  const table = computeStandings(teams, matches);
  assert.deepEqual(order(table), ["T1", "T2", "T3", "T4"]);
  assert.equal(table[0].wins, 3);
  assert.equal(table[3].wins, 0);
  assert.equal(table[0].rank, 1);
});

test("two teams level on wins are separated by head-to-head", () => {
  const teams = ["T1", "T2", "T3", "T4"];
  const matches = [
    m("T1", "T2", "T2", sweep), // T2 owns the head-to-head
    m("T1", "T3", "T1", sweep),
    m("T1", "T4", "T1", sweep),
    m("T2", "T3", "T2", sweep),
    m("T2", "T4", "T4", sweep),
    m("T3", "T4", "T3", sweep),
  ];
  const table = computeStandings(teams, matches);
  // T1 and T2 both finish 2-1; T2 beat T1, so T2 takes the pool.
  assert.deepEqual(order(table).slice(0, 2), ["T2", "T1"]);
  assert.equal(table[0].tiebreak, "head-to-head");
  // T3 and T4 both finish 1-2; T3 beat T4.
  assert.deepEqual(order(table).slice(2), ["T3", "T4"]);
});

test("a three-way rock-paper-scissors tie falls through to game differential", () => {
  const teams = ["T1", "T2", "T3", "T4"];
  const matches = [
    m("T1", "T2", "T1", sweep),
    m("T1", "T3", "T1", sweep),
    m("T1", "T4", "T1", sweep),
    // T2 > T3 > T4 > T2 — every tied team has exactly one mini-league win.
    m("T2", "T3", "T2", [[11, 5], [11, 5]]),
    m("T3", "T4", "T3", [[11, 3], [11, 3]]),
    m("T2", "T4", "T4", [[9, 11], [11, 9], [9, 11]]),
  ];
  const table = computeStandings(teams, matches);
  assert.equal(order(table)[0], "T1");
  // Mini-league cannot separate them, so overall game diff decides:
  // T2 -1, T3 -2, T4 -3.
  assert.deepEqual(order(table).slice(1), ["T2", "T3", "T4"]);
  assert.equal(table[1].gameDiff, -1);
  assert.equal(table[2].gameDiff, -2);
  assert.equal(table[3].gameDiff, -3);
  assert.equal(table[1].tiebreak, "game-diff");
});

test("a mini-league result outranks overall differential", () => {
  // Six-team pool so the tied teams have wins from OUTSIDE the tied group —
  // in a 4-team pool a three-way tie is always rock-paper-scissors and the
  // mini-league can never separate anyone.
  const teams = ["A", "B", "C", "D", "E", "F"];
  const matches = [
    m("A", "B", "A", sweep),
    m("A", "C", "A", sweep),
    m("A", "D", "A", sweep),
    m("A", "E", "A", sweep),
    m("A", "F", "A", sweep),

    // Inside the tied group: B beats C and D, C beats D.
    m("B", "C", "B", close),
    m("B", "D", "B", close),
    m("C", "D", "C", close),

    // Outside it, B is thrashed while D racks up blowout wins — so D ends the
    // pool with a far better point differential than B.
    m("B", "E", "E", swept),
    m("B", "F", "F", swept),
    m("C", "E", "C", sweep),
    m("C", "F", "F", swept),
    m("D", "E", "D", sweep),
    m("D", "F", "D", sweep),
    m("E", "F", "F", swept),
  ];

  const table = computeStandings(teams, matches);
  const at = (id: string) => table.find((r) => r.teamId === id)!;

  // B, C and D all finish 2-3.
  assert.equal(at("B").wins, 2);
  assert.equal(at("C").wins, 2);
  assert.equal(at("D").wins, 2);

  // D's overall point differential is much better than B's...
  assert.ok(
    at("D").pointDiff > at("B").pointDiff,
    "D should have the better overall point differential",
  );

  // ...but results among the tied teams decide it, so B still ranks ahead.
  assert.deepEqual(order(table).slice(2, 5), ["B", "C", "D"]);
  assert.equal(at("B").tiebreak, "mini-league");
});

test("point differential separates teams level on game differential", () => {
  const teams = ["A", "B", "C"];
  const matches = [
    // A and B each beat C by different margins and never play each other.
    m("A", "C", "A", [[11, 9], [11, 9]]),
    m("B", "C", "B", [[11, 1], [11, 1]]),
  ];
  const table = computeStandings(teams, matches);
  assert.deepEqual(order(table).slice(0, 2), ["B", "A"]);
  assert.equal(table[0].tiebreak, "point-diff");
});

test("flags a genuinely unresolvable tie instead of guessing", () => {
  const teams = ["A", "B", "C"];
  const matches = [
    // Identical results, no head-to-head between A and B.
    m("A", "C", "A", sweep),
    m("B", "C", "B", sweep),
  ];
  const table = computeStandings(teams, matches);
  assert.equal(table[0].tiebreak, "unresolved");
  assert.equal(table[0].gameDiff, table[1].gameDiff);
  assert.equal(table[0].pointDiff, table[1].pointDiff);
});

test("handles a pool that is only partway through", () => {
  const teams = ["T1", "T2", "T3", "T4"];
  const matches = [m("T1", "T2", "T1", sweep)];
  const table = computeStandings(teams, matches);
  assert.equal(table.length, 4);
  assert.equal(table[0].teamId, "T1");
  assert.equal(table[0].played, 1);
  // Teams yet to play still appear, with zeroed records.
  assert.equal(table.find((r) => r.teamId === "T4")!.played, 0);
});

test("full 8-team pool gives every team 7 matches", () => {
  const teams = Array.from({ length: 8 }, (_, i) => `T${i + 1}`);
  const matches: PoolMatch[] = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      // Lower index always wins, giving a clean 7-6-5-4-3-2-1-0 ladder.
      matches.push(m(teams[i], teams[j], teams[i], sweep));
    }
  }
  assert.equal(matches.length, 28); // C(8,2)
  const table = computeStandings(teams, matches);
  assert.deepEqual(order(table), teams);
  table.forEach((row) => assert.equal(row.played, 7));
  assert.equal(table[0].wins, 7);
  assert.equal(table[7].wins, 0);
  // Top 3 advance.
  assert.deepEqual(order(table).slice(0, 3), ["T1", "T2", "T3"]);
});

test("ignores matches referencing teams outside the pool", () => {
  const table = computeStandings(["A", "B"], [m("A", "ZZ", "A", sweep)]);
  assert.equal(table.find((r) => r.teamId === "A")!.played, 0);
});
