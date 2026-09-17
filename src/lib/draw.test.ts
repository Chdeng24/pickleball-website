import { test } from "node:test";
import assert from "node:assert/strict";
import { assignPools, generateRoundRobinMatches, poolLabel } from "./draw.ts";

const noShuffle = () => 0; // deterministic rng: shuffle becomes a no-op

test("pool labels go A, B, C ... Z, AA, AB", () => {
  assert.equal(poolLabel(0), "A");
  assert.equal(poolLabel(25), "Z");
  assert.equal(poolLabel(26), "AA");
  assert.equal(poolLabel(27), "AB");
});

test("16 teams split into two pools of 8", () => {
  const teams = Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, level: "unknown" as const }));
  const pools = assignPools(teams, 8, noShuffle);
  assert.equal(pools.size, 2);
  assert.equal(pools.get("A")!.length, 8);
  assert.equal(pools.get("B")!.length, 8);
});

test("15 teams split 8 and 7, not 8 and a leftover pool of 1", () => {
  const teams = Array.from({ length: 15 }, (_, i) => ({ id: `t${i}`, level: "unknown" as const }));
  const pools = assignPools(teams, 8, noShuffle);
  assert.equal(pools.size, 2);
  const sizes = [...pools.values()].map((p) => p.length).sort();
  assert.deepEqual(sizes, [7, 8]);
});

test("no team appears in two pools, and every team is placed exactly once", () => {
  const teams = Array.from({ length: 19 }, (_, i) => ({ id: `t${i}`, level: "unknown" as const }));
  const pools = assignPools(teams, 8, noShuffle);
  const seen = [...pools.values()].flat();
  assert.equal(seen.length, 19);
  assert.equal(new Set(seen).size, 19);
});

test("advanced teams are seeded ahead of beginner teams within a pool deal", () => {
  const teams = [
    { id: "b1", level: "beginner" as const },
    { id: "a1", level: "advanced" as const },
    { id: "b2", level: "beginner" as const },
    { id: "a2", level: "advanced" as const },
  ];
  const pools = assignPools(teams, 8, noShuffle);
  // Only one pool (4 teams, poolSize 8) — order within it should be advanced-first.
  const pool = pools.get("A")!;
  assert.deepEqual(pool.slice(0, 2).sort(), ["a1", "a2"]);
});

test("empty roster produces no pools", () => {
  assert.equal(assignPools([], 8, noShuffle).size, 0);
});

test("a pool of 8 gets all 28 round-robin matches, 7 per team", () => {
  const teamIds = Array.from({ length: 8 }, (_, i) => `t${i}`);
  const matches = generateRoundRobinMatches(teamIds);
  assert.equal(matches.length, 28);

  const played = new Map<string, number>();
  for (const m of matches) {
    played.set(m.teamAId, (played.get(m.teamAId) ?? 0) + 1);
    played.set(m.teamBId, (played.get(m.teamBId) ?? 0) + 1);
  }
  for (const id of teamIds) assert.equal(played.get(id), 7);
});

test("a pool of 7 gets 21 matches, 6 per team", () => {
  const teamIds = Array.from({ length: 7 }, (_, i) => `t${i}`);
  const matches = generateRoundRobinMatches(teamIds);
  assert.equal(matches.length, 21);
});

test("no duplicate pairings and no team plays itself", () => {
  const teamIds = ["a", "b", "c", "d"];
  const matches = generateRoundRobinMatches(teamIds);
  const seen = new Set<string>();
  for (const m of matches) {
    assert.notEqual(m.teamAId, m.teamBId);
    const key = [m.teamAId, m.teamBId].sort().join("-");
    assert.equal(seen.has(key), false, `duplicate pairing ${key}`);
    seen.add(key);
  }
});
