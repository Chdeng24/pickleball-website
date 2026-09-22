import { test } from "node:test";
import assert from "node:assert/strict";
import { attendeeName } from "./display-name.ts";

const email = "oski@berkeley.edu";

test("full visibility keeps the whole name", () => {
  assert.equal(attendeeName({ name: "Oski Bear", email }, "full"), "Oski Bear");
});

test("abbreviated visibility shortens the last name to an initial", () => {
  assert.equal(attendeeName({ name: "Oski Bear", email }, "abbreviated"), "Oski B.");
});

test("middle names stay, only the final surname is cut", () => {
  assert.equal(attendeeName({ name: "Ana Maria Cruz", email }, "abbreviated"), "Ana Maria C.");
});

test("a single-word name is left alone", () => {
  assert.equal(attendeeName({ name: "Oski", email }, "abbreviated"), "Oski");
});

test("stray whitespace does not produce a blank initial", () => {
  assert.equal(attendeeName({ name: "  Oski   Bear  ", email }, "abbreviated"), "Oski B.");
});

test("no display name: members see the email local part, the public sees nothing", () => {
  assert.equal(attendeeName({ name: null, email }, "full"), "oski");
  assert.equal(attendeeName({ name: "   ", email }, "abbreviated"), "Member");
});

test("an email is never exposed to the public list", () => {
  assert.ok(!attendeeName({ name: null, email }, "abbreviated").includes("@"));
});
