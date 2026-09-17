import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMatchScore } from "./matchscore.ts";

test("a clean 2-0 sweep is valid, team A wins", () => {
  const r = checkMatchScore([
    [11, 5],
    [11, 7],
  ]);
  assert.deepEqual(r, { ok: true, winner: "A" });
});

test("a full 3-game match decides on the rubber game", () => {
  const r = checkMatchScore([
    [11, 5],
    [8, 11],
    [11, 9],
  ]);
  assert.deepEqual(r, { ok: true, winner: "A" });
});

test("team B can win 2-0 too", () => {
  const r = checkMatchScore([
    [5, 11],
    [7, 11],
  ]);
  assert.deepEqual(r, { ok: true, winner: "B" });
});

test("deuce game must be won by 2, not 1", () => {
  const r = checkMatchScore([
    [12, 11],
    [11, 7],
  ]);
  assert.equal(r.ok, false);
});

test("a genuine deuce game (13-11) is valid", () => {
  const r = checkMatchScore([
    [13, 11],
    [11, 6],
  ]);
  assert.equal(r.ok, true);
});

test("a game below 11 with no deuce margin is rejected", () => {
  const r = checkMatchScore([
    [9, 5],
    [11, 4],
  ]);
  assert.equal(r.ok, false);
});

test("a tied game is rejected", () => {
  const r = checkMatchScore([
    [11, 11],
    [11, 7],
  ]);
  assert.equal(r.ok, false);
});

test("rejects fewer than 2 games", () => {
  const r = checkMatchScore([[11, 5]]);
  assert.equal(r.ok, false);
});

test("rejects more than 3 games", () => {
  const r = checkMatchScore([
    [11, 5],
    [5, 11],
    [11, 5],
    [5, 11],
  ]);
  assert.equal(r.ok, false);
});

test("rejects 2 games with a split (1-1) — not enough to decide it", () => {
  const r = checkMatchScore([
    [11, 5],
    [5, 11],
  ]);
  assert.equal(r.ok, false);
});

test("rejects a 3-game report where one side won all 3 (inconsistent, should only need 2)", () => {
  const r = checkMatchScore([
    [11, 5],
    [11, 7],
    [11, 9],
  ]);
  assert.equal(r.ok, false);
});

test("rejects negative or non-integer scores", () => {
  assert.equal(
    checkMatchScore([
      [11, -3],
      [11, 5],
    ]).ok,
    false,
  );
  assert.equal(
    checkMatchScore([
      [11.5, 5],
      [11, 5],
    ]).ok,
    false,
  );
});
