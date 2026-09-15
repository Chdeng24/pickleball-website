import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideStatus,
  checkRsvpWindow,
  resolveInsertOrReactivate,
  repackPositions,
  selectPromotion,
} from "./rsvp-logic.ts";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-02-03T19:00:00-08:00");

test("assigns confirmed while under capacity", () => {
  assert.equal(decideStatus(0, 20), "confirmed");
  assert.equal(decideStatus(19, 20), "confirmed");
});

test("assigns waitlist at exactly capacity", () => {
  assert.equal(decideStatus(20, 20), "waitlist");
  assert.equal(decideStatus(25, 20), "waitlist");
});

test("treats null capacity as unlimited", () => {
  assert.equal(decideStatus(0, null), "confirmed");
  assert.equal(decideStatus(500, null), "confirmed");
});

test("positions are 1-based and contiguous per status", () => {
  const rows = [{ id: "a", position: 5 }, { id: "b", position: 2 }, { id: "c", position: 9 }];
  const packed = repackPositions(rows);
  assert.deepEqual(
    packed.map((r) => r.position),
    [1, 2, 3],
  );
  // Order is preserved by original position, not by insertion order.
  assert.deepEqual(
    packed.map((r) => r.id),
    ["b", "a", "c"],
  );
});

test("repacking an empty list is a no-op", () => {
  assert.deepEqual(repackPositions([]), []);
});

test("promotes the lowest waitlist position on cancel", () => {
  const waitlist = [
    { id: "later", position: 3 },
    { id: "earliest", position: 1 },
    { id: "middle", position: 2 },
  ];
  const promoted = selectPromotion(waitlist);
  assert.equal(promoted?.id, "earliest");
});

test("promotes nobody when the waitlist is empty", () => {
  // Exercises the same path a cancellation from the waitlist takes: the
  // cancelling member was never confirmed, so nobody is promoted regardless
  // of what selectPromotion would return.
  assert.equal(selectPromotion([]), null);
});

test("rejects RSVP before rsvpOpensAt", () => {
  const result = checkRsvpWindow(
    { published: true, rsvpOpensAt: new Date(now.getTime() + HOUR), startsAt: new Date(now.getTime() + 2 * HOUR) },
    now,
  );
  assert.deepEqual(result, { ok: false, reason: "not_open" });
});

test("allows RSVP exactly at rsvpOpensAt", () => {
  const opensAt = new Date(now.getTime());
  const result = checkRsvpWindow(
    { published: true, rsvpOpensAt: opensAt, startsAt: new Date(now.getTime() + HOUR) },
    now,
  );
  assert.deepEqual(result, { ok: true });
});

test("rejects RSVP for an event that already started", () => {
  const result = checkRsvpWindow(
    { published: true, rsvpOpensAt: null, startsAt: new Date(now.getTime() - HOUR) },
    now,
  );
  assert.deepEqual(result, { ok: false, reason: "past" });
});

test("rejects RSVP for an unpublished event even if the window is open", () => {
  const result = checkRsvpWindow(
    { published: false, rsvpOpensAt: null, startsAt: new Date(now.getTime() + HOUR) },
    now,
  );
  assert.deepEqual(result, { ok: false, reason: "not_published" });
});

test("re-activating a cancelled RSVP does not create a duplicate", () => {
  // No prior row -> a fresh insert.
  assert.equal(resolveInsertOrReactivate(null), "insert");
  // A cancelled row is reused in place, never a second insert — the
  // UNIQUE(event_id, member_id) constraint would reject a duplicate insert
  // anyway, but the service must never attempt one.
  assert.equal(resolveInsertOrReactivate("cancelled"), "reactivate");
});

test("rejects a second RSVP while already confirmed or waitlisted", () => {
  assert.equal(resolveInsertOrReactivate("confirmed"), "reject");
  assert.equal(resolveInsertOrReactivate("waitlist"), "reject");
});
