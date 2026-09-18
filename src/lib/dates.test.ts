import { test } from "node:test";
import assert from "node:assert/strict";
import { laInputToUtc, utcToLaInputValue, formatEventWhen, pacificDateKey, pacificDateParts } from "./dates.ts";

test("converts a PST (winter) local input to the correct UTC instant", () => {
  // Feb 3 2026, 7:00 PM in Los Angeles is PST (UTC-8) -> 03:00 UTC next day.
  const utc = laInputToUtc("2026-02-03T19:00");
  assert.equal(utc.toISOString(), "2026-02-04T03:00:00.000Z");
});

test("converts a PDT (summer) local input to the correct UTC instant", () => {
  // Jul 14 2026, 7:00 PM in Los Angeles is PDT (UTC-7) -> 02:00 UTC next day.
  const utc = laInputToUtc("2026-07-14T19:00");
  assert.equal(utc.toISOString(), "2026-07-15T02:00:00.000Z");
});

test("round-trips through utcToLaInputValue", () => {
  const original = "2026-03-10T18:30";
  const utc = laInputToUtc(original);
  assert.equal(utcToLaInputValue(utc), original);
});

test("formatEventWhen labels the correct DST abbreviation", () => {
  const winter = laInputToUtc("2026-02-03T19:00");
  const summer = laInputToUtc("2026-07-14T19:00");
  assert.match(formatEventWhen(winter, winter), /PST/);
  assert.match(formatEventWhen(summer, summer), /PDT/);
});

test("pacificDateParts reads the Pacific calendar day, not the UTC one", () => {
  // 7pm Feb 3 in LA is already the next UTC day (03:00 UTC Feb 4) — the
  // calendar grid must place this event on Feb 3, not Feb 4.
  const utc = laInputToUtc("2026-02-03T19:00");
  assert.deepEqual(pacificDateParts(utc), { year: 2026, month: 2, day: 3 });
});

test("pacificDateKey is zero-padded and sortable", () => {
  const utc = laInputToUtc("2026-02-03T19:00");
  assert.equal(pacificDateKey(utc), "2026-02-03");
});

test("pacificDateKey agrees across two events on the same Pacific day", () => {
  const morning = laInputToUtc("2026-03-10T08:00");
  const night = laInputToUtc("2026-03-10T22:00");
  assert.equal(pacificDateKey(morning), pacificDateKey(night));
});
