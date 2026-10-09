import { test } from "node:test";
import assert from "node:assert/strict";
import {
  upcomingSaturday,
  laInputToUtc,
  utcToLaInputValue,
  formatEventWhen,
  pacificDateKey,
  pacificDateParts,
  laDeadlineToUtc,
  formatDeadline,
} from "./dates.ts";

test("league deadline: Sat Sep 26 2026 11:59 PM PDT stays open through 11:59:59.999", () => {
  const d = laDeadlineToUtc("2026-09-26T23:59");
  assert.equal(d.toISOString(), "2026-09-27T06:59:59.999Z");
});

test("deadline round-trips to the same datetime-local value for the edit form", () => {
  assert.equal(utcToLaInputValue(laDeadlineToUtc("2026-09-26T23:59")), "2026-09-26T23:59");
});

test("formatDeadline reads as a Pacific day + time", () => {
  assert.equal(formatDeadline(laDeadlineToUtc("2026-09-26T23:59")), "Sat, Sep 26 · 11:59 PM PDT");
});

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

test("upcomingSaturday: this Saturday until open play ends at 2 PM, then next week's", () => {
  assert.equal(upcomingSaturday(new Date("2026-10-08T20:00:00-07:00")), "Sat, Oct 10"); // Thursday
  assert.equal(upcomingSaturday(new Date("2026-10-10T11:00:00-07:00")), "Sat, Oct 10"); // Saturday morning
  assert.equal(upcomingSaturday(new Date("2026-10-10T13:59:00-07:00")), "Sat, Oct 10");
  assert.equal(upcomingSaturday(new Date("2026-10-10T14:00:00-07:00")), "Sat, Oct 17"); // over
  assert.equal(upcomingSaturday(new Date("2026-10-11T09:00:00-07:00")), "Sat, Oct 17"); // Sunday
  // Late Friday night in Berkeley is already Saturday in UTC — still Pacific's Saturday.
  assert.equal(upcomingSaturday(new Date("2026-10-09T23:30:00-07:00")), "Sat, Oct 10");
  // A later session (Advanced, 2–4 PM) stays on today until it ends.
  assert.equal(upcomingSaturday(new Date("2026-10-10T15:00:00-07:00"), "16:00"), "Sat, Oct 10");
  assert.equal(upcomingSaturday(new Date("2026-10-10T16:00:00-07:00"), "16:00"), "Sat, Oct 17");
  // Across the DST change and a month boundary.
  assert.equal(upcomingSaturday(new Date("2026-10-31T15:00:00-07:00")), "Sat, Nov 7");
});
