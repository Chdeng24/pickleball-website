import { test } from "node:test";
import assert from "node:assert/strict";
import { canSignIn, initialAccess, isAdmin, isExec } from "./access.ts";

test("accepts a verified berkeley account", () => {
  assert.equal(canSignIn({ email: "chdeng@berkeley.edu", emailVerified: true }), true);
});

test("accepts a verified non-berkeley account — roster/pending decides access, not domain", () => {
  assert.equal(canSignIn({ email: "randomguy@gmail.com", emailVerified: true }), true);
});

test("rejects an unverified email", () => {
  assert.equal(canSignIn({ email: "chdeng@berkeley.edu", emailVerified: false }), false);
});

test("rejects a missing email", () => {
  assert.equal(canSignIn({ email: null, emailVerified: true }), false);
});

const roles = {
  allowedDomain: "berkeley.edu",
  adminEmails: ["chdeng@berkeley.edu", "pickleballatberkeley@gmail.com"],
  execEmails: ["prez@berkeley.edu"],
};

test("strict mode: a berkeley email on the roster is approved", () => {
  const a = initialAccess({ email: "member@berkeley.edu", onRoster: true, rosterMode: "strict", ...roles });
  assert.deepEqual(a, { role: "member", status: "approved", onRoster: true });
});

test("strict mode: off-roster student signs in but stays pending", () => {
  const a = initialAccess({ email: "stranger@berkeley.edu", onRoster: false, rosterMode: "strict", ...roles });
  assert.equal(a.status, "pending");
});

test("strict mode: a non-berkeley email on the roster still needs approval — being on the list isn't enough on its own", () => {
  const a = initialAccess({ email: "coach@gmail.com", onRoster: true, rosterMode: "strict", ...roles });
  assert.equal(a.status, "pending");
});

test("strict mode: a non-berkeley email off the roster stays pending too", () => {
  const a = initialAccess({ email: "randomguy@gmail.com", onRoster: false, rosterMode: "strict", ...roles });
  assert.equal(a.status, "pending");
});

test("strict mode: matching case-insensitively — Berkeley.EDU still counts as the domain", () => {
  const a = initialAccess({ email: "Member@Berkeley.EDU", onRoster: true, rosterMode: "strict", ...roles });
  assert.equal(a.status, "approved");
});

test("open mode: off-roster student is approved", () => {
  const a = initialAccess({ email: "stranger@berkeley.edu", onRoster: false, rosterMode: "open", ...roles });
  assert.equal(a.status, "approved");
});

test("admins are approved even when absent from the roster", () => {
  const a = initialAccess({ email: "chdeng@berkeley.edu", onRoster: false, rosterMode: "strict", ...roles });
  assert.equal(a.role, "admin");
  assert.equal(a.status, "approved");
  assert.ok(isAdmin(a) && isExec(a));
});

test("exec is exec but not admin", () => {
  const a = initialAccess({ email: "prez@berkeley.edu", onRoster: false, rosterMode: "strict", ...roles });
  assert.equal(a.role, "exec");
  assert.ok(isExec(a));
  assert.equal(isAdmin(a), false);
});

test("role matching is case insensitive", () => {
  const a = initialAccess({ email: "ChDeng@Berkeley.edu", onRoster: false, rosterMode: "strict", ...roles });
  assert.equal(a.role, "admin");
});
