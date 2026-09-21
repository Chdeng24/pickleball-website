import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveLevel, nextDerivedLevel, skillLabel, type LevelSignal } from "./derive-level.ts";

const d = (iso: string) => new Date(iso);

test("returns unknown with no signals", () => {
  assert.equal(deriveLevel([]), "unknown");
});

test("most recent attended practice wins", () => {
  const signals: LevelSignal[] = [
    { level: "beginner", status: "confirmed", startsAt: d("2026-01-01") },
    { level: "advanced", status: "confirmed", startsAt: d("2026-02-01") },
  ];
  assert.equal(deriveLevel(signals), "advanced");
});

test("ignores socials (level unknown) even if most recent", () => {
  const signals: LevelSignal[] = [
    { level: "beginner", status: "confirmed", startsAt: d("2026-01-01") },
    { level: "unknown", status: "confirmed", startsAt: d("2026-03-01") }, // a social
  ];
  assert.equal(deriveLevel(signals), "beginner");
});

test("ignores cancelled RSVPs", () => {
  const signals: LevelSignal[] = [
    { level: "beginner", status: "confirmed", startsAt: d("2026-01-01") },
    { level: "advanced", status: "cancelled", startsAt: d("2026-02-01") },
  ];
  assert.equal(deriveLevel(signals), "beginner");
});

test("a waitlisted practice still counts as a signal", () => {
  const signals: LevelSignal[] = [{ level: "advanced", status: "waitlist", startsAt: d("2026-01-01") }];
  assert.equal(deriveLevel(signals), "advanced");
});

test("nextDerivedLevel never regresses a known level to unknown", () => {
  const onlySocial: LevelSignal[] = [{ level: "unknown", status: "confirmed", startsAt: d("2026-03-01") }];
  assert.equal(nextDerivedLevel("advanced", onlySocial), "advanced");
});

test("nextDerivedLevel updates when a newer practice signal exists", () => {
  const signals: LevelSignal[] = [{ level: "beginner", status: "confirmed", startsAt: d("2026-04-01") }];
  assert.equal(nextDerivedLevel("advanced", signals), "beginner");
});

test("skill label: Comp Team wins over any practice level", () => {
  assert.equal(skillLabel({ onCompetitiveTeam: true, derivedLevel: "unknown" }), "Comp");
  assert.equal(skillLabel({ onCompetitiveTeam: true, derivedLevel: "beginner" }), "Comp");
});

test("skill label: everyone else is Social, TBD until their first practice", () => {
  assert.equal(skillLabel({ onCompetitiveTeam: false, derivedLevel: "unknown" }), "Social · TBD");
  assert.equal(skillLabel({ onCompetitiveTeam: false, derivedLevel: "beginner" }), "Social · Beginner");
  assert.equal(skillLabel({ onCompetitiveTeam: false, derivedLevel: "advanced" }), "Social · Advanced");
});
