import { test } from "node:test";
import assert from "node:assert/strict";
import { canSignIn, initialAccess, isAdmin, isExec } from "./access.ts";

const gate = {
  allowedDomain: "berkeley.edu",
  allowlist: ["pickleballatberkeley@gmail.com"],
};

test("accepts a verified berkeley account", () => {
  assert.equal(
    canSignIn({ email: "chdeng@berkeley.edu", emailVerified: true, hd: "berkeley.edu", ...gate }),
    true,
  );
});

test("rejects a gmail account that is not allowlisted", () => {
  assert.equal(
    canSignIn({ email: "randomguy@gmail.com", emailVerified: true, hd: undefined, ...gate }),
    false,
  );
});

test("accepts the club gmail via the allowlist", () => {
  assert.equal(
    canSignIn({
      email: "PickleballAtBerkeley@gmail.com",
      emailVerified: true,
      hd: undefined,
      ...gate,
    }),
    true,
  );
});

test("rejects a spoofed address whose hd claim is missing", () => {
  // Someone crafting an @berkeley.edu-looking address without the real
  // hosted-domain claim must not get through.
  assert.equal(
    canSignIn({ email: "attacker@berkeley.edu", emailVerified: true, hd: "evil.com", ...gate }),
    false,
  );
});

test("rejects an unverified email", () => {
  assert.equal(
    canSignIn({ email: "chdeng@berkeley.edu", emailVerified: false, hd: "berkeley.edu", ...gate }),
    false,
  );
});

test("rejects a lookalike domain", () => {
  assert.equal(
    canSignIn({
      email: "someone@notberkeley.edu",
      emailVerified: true,
      hd: "notberkeley.edu",
      ...gate,
    }),
    false,
  );
});

const roles = {
  adminEmails: ["chdeng@berkeley.edu", "pickleballatberkeley@gmail.com"],
  execEmails: ["prez@berkeley.edu"],
};

test("strict mode: roster email is approved", () => {
  const a = initialAccess({ email: "member@berkeley.edu", onRoster: true, rosterMode: "strict", ...roles });
  assert.deepEqual(a, { role: "member", status: "approved", onRoster: true });
});

test("strict mode: off-roster student signs in but stays pending", () => {
  const a = initialAccess({ email: "stranger@berkeley.edu", onRoster: false, rosterMode: "strict", ...roles });
  assert.equal(a.status, "pending");
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
