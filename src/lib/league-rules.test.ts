import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultTeamName,
  firstName,
  hasRoom,
  holdsSpot,
  isDrawReady,
  isRegistrationOpen,
  leagueCardState,
  onDomain,
  parseEmailList,
  partnerOf,
  partnerProblem,
  sortLeagues,
  spotsLeft,
  teamReadiness,
  type MembershipView,
} from "./league-rules.ts";

const now = new Date("2026-09-20T18:00:00Z");
const closes = new Date("2026-09-27T06:59:59.999Z");

const league = {
  id: "L1",
  status: "registration" as const,
  registrationClosesAt: closes,
  eligibility: "all" as const,
  poolsAnnouncedAt: null,
  maxPlayers: 32,
};

function membership(over: Partial<MembershipView>): MembershipView {
  return {
    tournamentId: "L1",
    tournamentName: "Beginner League",
    tournamentStatus: "registration",
    teamId: "T1",
    teamStatus: "registered",
    teamPool: null,
    inviteStatus: "accepted",
    ...over,
  };
}

/* ── capacity ─────────────────────────────────────────────────────────── */

test("accepted and pending players hold a spot; declined and withdrawn teams don't", () => {
  assert.equal(holdsSpot("accepted", "registered"), true);
  assert.equal(holdsSpot("pending", "registered"), true);
  assert.equal(holdsSpot("declined", "registered"), false);
  assert.equal(holdsSpot("accepted", "withdrawn"), false);
});

test("a pair fits with exactly 2 spots left, not with 1", () => {
  assert.equal(hasRoom(30, 2, 32), true);
  assert.equal(hasRoom(31, 2, 32), false);
  assert.equal(hasRoom(31, 1, 32), true);
});

test("null cap means unlimited", () => {
  assert.equal(hasRoom(10_000, 2, null), true);
  assert.equal(spotsLeft(10_000, null), null);
});

test("spotsLeft never goes negative if exec lowers the cap below current signups", () => {
  assert.equal(spotsLeft(40, 32), 0);
});

/* ── registration window ──────────────────────────────────────────────── */

test("registration is open before the deadline and closed after", () => {
  assert.equal(isRegistrationOpen(league, now), true);
  assert.equal(isRegistrationOpen(league, new Date("2026-09-27T07:00:00Z")), false);
});

test("registration is closed once the draw has been generated, whatever the clock says", () => {
  assert.equal(isRegistrationOpen({ ...league, status: "pools" }, now), false);
});

/* ── email parsing for the exec paste box ─────────────────────────────── */

test("parses one-per-line, commas, and mixed casing, de-duplicated", () => {
  const { emails } = parseEmailList("A@Berkeley.edu\nb@berkeley.edu, c@gmail.com\na@berkeley.edu");
  assert.deepEqual(emails.sort(), ["a@berkeley.edu", "b@berkeley.edu", "c@gmail.com"]);
});

test("survives a raw copy of the Google Contacts page", () => {
  const pasted = `drag_indicator

a.aidenlin@berkeley.edu

a.aidenlin@berkeley.edu
drag_indicator

Aaron Charles-Song Nguyen

airrock85@berkeley.edu`;
  const { emails, rejected } = parseEmailList(pasted);
  assert.deepEqual(emails.sort(), ["a.aidenlin@berkeley.edu", "airrock85@berkeley.edu"]);
  assert.deepEqual(rejected, []);
});

test("parses a CSV export row", () => {
  const { emails } = parseEmailList(`name,email\n"Lam, Sienna",slam27@berkeley.edu`);
  assert.deepEqual(emails, ["slam27@berkeley.edu"]);
});

test("reports lines that look like a mistyped email", () => {
  const { emails, rejected } = parseEmailList("good@berkeley.edu\nbroken@berkeley");
  assert.deepEqual(emails, ["good@berkeley.edu"]);
  assert.deepEqual(rejected, ["broken@berkeley"]);
});

test("domain match is exact — no lookalikes", () => {
  assert.equal(onDomain("Me@Berkeley.EDU", "berkeley.edu"), true);
  assert.equal(onDomain("me@notberkeley.edu", "berkeley.edu"), false);
  assert.equal(onDomain("me@gmail.com", "berkeley.edu"), false);
});

/* ── partner checks ───────────────────────────────────────────────────── */

const okPartner = { id: "P", status: "approved" as const, onCompetitiveTeam: false };

test("partner checks, in order", () => {
  const base = { selfId: "ME", requiresComp: false, committedLeague: null };
  assert.equal(partnerProblem({ ...base, partner: null }), "no_account");
  assert.equal(partnerProblem({ ...base, partner: { ...okPartner, id: "ME" } }), "self");
  assert.equal(partnerProblem({ ...base, partner: { ...okPartner, status: "pending" } }), "not_approved");
  assert.equal(partnerProblem({ ...base, partner: { ...okPartner, status: "blocked" } }), "not_approved");
  assert.equal(partnerProblem({ ...base, requiresComp: true, partner: okPartner }), "not_comp");
  assert.equal(partnerProblem({ ...base, committedLeague: "Advanced League", partner: okPartner }), "committed");
  assert.equal(partnerProblem({ ...base, partner: okPartner }), null);
});

test("a comp partner is fine for the comp league", () => {
  assert.equal(
    partnerProblem({
      selfId: "ME",
      requiresComp: true,
      committedLeague: null,
      partner: { ...okPartner, onCompetitiveTeam: true },
    }),
    null,
  );
});

/* ── team readiness ───────────────────────────────────────────────────── */

test("only two confirmed players make a team draw-ready", () => {
  assert.equal(isDrawReady([{ inviteStatus: "accepted" }, { inviteStatus: "accepted" }]), true);
  assert.equal(isDrawReady([{ inviteStatus: "accepted" }, { inviteStatus: "pending" }]), false);
  assert.equal(isDrawReady([{ inviteStatus: "accepted" }]), false);
  assert.equal(isDrawReady([{ inviteStatus: "accepted" }, { inviteStatus: "declined" }]), false);
  // An old declined invite left on the team doesn't disqualify a now-complete pair.
  assert.equal(
    isDrawReady([{ inviteStatus: "accepted" }, { inviteStatus: "accepted" }, { inviteStatus: "declined" }]),
    true,
  );
});

test("readiness labels", () => {
  assert.equal(teamReadiness([{ inviteStatus: "accepted" }, { inviteStatus: "accepted" }]), "ready");
  assert.equal(teamReadiness([{ inviteStatus: "accepted" }, { inviteStatus: "pending" }]), "waiting_on_partner");
  assert.equal(teamReadiness([{ inviteStatus: "accepted" }, { inviteStatus: "declined" }]), "needs_partner");
  assert.equal(teamReadiness([{ inviteStatus: "accepted" }]), "needs_partner");
});

test("partnerOf prefers the live partner over an old declined invite", () => {
  const members = [
    { memberId: "ME", isCaptain: true, inviteStatus: "accepted" as const, name: "Caleb Deng", email: null },
    { memberId: "X", isCaptain: false, inviteStatus: "declined" as const, name: "Xavier", email: null },
    { memberId: "Y", isCaptain: false, inviteStatus: "pending" as const, name: "Yara", email: null },
  ];
  assert.equal(partnerOf(members, "ME")?.memberId, "Y");
});

/* ── names and ordering ───────────────────────────────────────────────── */

test("team names fall back to the email when there's no display name", () => {
  assert.equal(firstName({ name: null, email: "slam27@berkeley.edu" }), "slam27");
  assert.equal(defaultTeamName({ name: "Caleb Deng", email: null }, { name: "Sienna Lam", email: null }), "Caleb & Sienna");
  assert.equal(defaultTeamName({ name: "Caleb Deng", email: null }), "Caleb's team");
});

test("leagues sort Beginner, Advanced, Competitive", () => {
  const sorted = sortLeagues([
    { division: "competitive" as const, name: "Comp" },
    { division: "beginner" as const, name: "Beg" },
    { division: "advanced" as const, name: "Adv" },
  ]);
  assert.deepEqual(sorted.map((l) => l.name), ["Beg", "Adv", "Comp"]);
});

/* ── card state ───────────────────────────────────────────────────────── */

const card = (over: Partial<Parameters<typeof leagueCardState>[0]>) =>
  leagueCardState({ league, memberships: [], isComp: false, spotsTaken: 0, now, ...over });

test("a member with nothing going on can register", () => {
  assert.deepEqual(card({}), { kind: "can_register" });
});

test("a full league says full", () => {
  assert.deepEqual(card({ spotsTaken: 32 }), { kind: "full" });
});

test("non-comp members see the comp league as not eligible", () => {
  assert.deepEqual(card({ league: { ...league, eligibility: "competitive_only" } }), { kind: "not_eligible" });
  assert.deepEqual(card({ league: { ...league, eligibility: "competitive_only" }, isComp: true }), {
    kind: "can_register",
  });
});

test("on a team here, during registration", () => {
  assert.deepEqual(card({ memberships: [membership({})] }), { kind: "on_team", teamId: "T1", phase: "registration" });
});

test("one league per person: committed elsewhere blocks this card", () => {
  const other = membership({ tournamentId: "L2", tournamentName: "Advanced League" });
  assert.deepEqual(card({ memberships: [other] }), { kind: "committed_elsewhere", leagueName: "Advanced League" });
});

test("a finished league from last semester doesn't count against one-league-per-person", () => {
  const old = membership({ tournamentId: "OLD", tournamentStatus: "complete" });
  assert.deepEqual(card({ memberships: [old] }), { kind: "can_register" });
});

test("a withdrawn team doesn't count as being on a team", () => {
  assert.deepEqual(card({ memberships: [membership({ teamStatus: "withdrawn" })] }), { kind: "can_register" });
});

test("a declined invite doesn't show as being on the team (the old findFirst bug)", () => {
  assert.deepEqual(card({ memberships: [membership({ inviteStatus: "declined" })] }), { kind: "can_register" });
});

test("pending invites show as an invite, and can still be answered after the deadline until the draw", () => {
  const invites = [membership({ inviteStatus: "pending", teamId: "T1" }), membership({ inviteStatus: "pending", teamId: "T2" })];
  assert.deepEqual(card({ memberships: invites }), { kind: "invited", teamIds: ["T1", "T2"] });
  assert.deepEqual(card({ memberships: invites, now: new Date("2026-10-01T00:00:00Z") }), {
    kind: "invited",
    teamIds: ["T1", "T2"],
  });
});

test("once the draw exists, an unanswered invite is just closed", () => {
  const invites = [membership({ inviteStatus: "pending", tournamentStatus: "pools" })];
  assert.deepEqual(card({ league: { ...league, status: "pools" }, memberships: invites }), { kind: "closed" });
});

test("phases after registration: drafting, live, and not drawn", () => {
  const drafting = { ...league, status: "pools" as const };
  const live = { ...drafting, poolsAnnouncedAt: now };
  const inPool = membership({ tournamentStatus: "pools", teamPool: "A" });
  const noPool = membership({ tournamentStatus: "pools", teamPool: null });

  assert.equal((card({ league: drafting, memberships: [inPool] }) as { phase: string }).phase, "drafting");
  assert.equal((card({ league: live, memberships: [inPool] }) as { phase: string }).phase, "live");
  assert.equal((card({ league: live, memberships: [noPool] }) as { phase: string }).phase, "not_drawn");
});
