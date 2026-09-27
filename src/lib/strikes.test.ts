import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STRIKE_LIMIT,
  canRecordAttendance,
  countStrikes,
  isMarkable,
  isStrike,
  strikeState,
  strikesRemaining,
  tracksAttendance,
  type AttendanceRecord,
} from "./strikes.ts";

const row = (
  status: AttendanceRecord["status"],
  attendance: AttendanceRecord["attendance"],
): AttendanceRecord => ({ status, attendance });

test("a confirmed no-show is a strike", () => {
  assert.equal(isStrike(row("confirmed", "no_show")), true);
});

test("turning up is never a strike", () => {
  assert.equal(isStrike(row("confirmed", "present")), false);
});

test("an unmarked session is not a strike — silence is not guilt", () => {
  assert.equal(isStrike(row("confirmed", "unmarked")), false);
});

test("cancelling in advance is never a strike, however it was marked", () => {
  for (const a of ["unmarked", "present", "no_show"] as const) {
    assert.equal(isStrike(row("cancelled", a)), false, `cancelled + ${a}`);
  }
});

test("a waitlisted member who never got a spot cannot be struck", () => {
  assert.equal(isStrike(row("waitlist", "no_show")), false);
});

test("countStrikes totals only the qualifying rows", () => {
  assert.equal(
    countStrikes([
      row("confirmed", "no_show"),
      row("confirmed", "present"),
      row("cancelled", "no_show"),
      row("waitlist", "no_show"),
      row("confirmed", "no_show"),
      row("confirmed", "unmarked"),
    ]),
    2,
  );
});

test("countStrikes of an empty history is zero", () => {
  assert.equal(countStrikes([]), 0);
});

test("strikeState: clear, then warning, then flagged at the limit", () => {
  assert.equal(strikeState(0), "clear");
  assert.equal(strikeState(1), "warning");
  assert.equal(strikeState(STRIKE_LIMIT), "flagged");
});

test("strikeState stays flagged beyond the limit", () => {
  assert.equal(strikeState(STRIKE_LIMIT + 3), "flagged");
});

test("strikesRemaining counts down and never goes negative", () => {
  assert.equal(strikesRemaining(0), 2);
  assert.equal(strikesRemaining(1), 1);
  assert.equal(strikesRemaining(2), 0);
  assert.equal(strikesRemaining(9), 0);
});

const practice = (startsAt: string) => ({ type: "practice" as const, startsAt: new Date(startsAt) });

test("attendance cannot be recorded before the session starts", () => {
  const now = new Date("2026-09-26T21:00:00Z");
  assert.equal(canRecordAttendance(practice("2026-09-26T22:00:00Z"), now), false);
});

test("attendance can be recorded once the session has started or ended", () => {
  const now = new Date("2026-09-26T21:00:00Z");
  assert.equal(canRecordAttendance(practice("2026-09-26T21:00:00Z"), now), true);
  assert.equal(canRecordAttendance(practice("2026-09-20T19:00:00Z"), now), true);
});

test("only practices take attendance — an uncapped social never produces a strike", () => {
  const now = new Date("2026-09-26T21:00:00Z");
  const startsAt = new Date("2026-09-20T19:00:00Z");
  assert.equal(tracksAttendance({ type: "practice" }), true);
  for (const type of ["social", "fundraiser", "tournament"] as const) {
    assert.equal(tracksAttendance({ type }), false, type);
    assert.equal(canRecordAttendance({ type, startsAt }, now), false, type);
  }
});

test("only confirmed spots are markable — bulk no-show can't reach a canceller", () => {
  assert.equal(isMarkable({ status: "confirmed" }), true);
  assert.equal(isMarkable({ status: "waitlist" }), false);
  assert.equal(isMarkable({ status: "cancelled" }), false);
});
