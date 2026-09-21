/**
 * Edge-case checks for Pickleball League sign-ups, run against the REAL
 * database:
 *
 *   npm run test:league
 *
 * Every scenario runs inside its own transaction that is always rolled back,
 * and creates its own throwaway league + users — real leagues and members
 * are never read, locked, or changed. Safe to run any time, including while
 * people are signing up.
 *
 * Covers what goes wrong in real life: double-clicks, refreshing after a
 * submit, stale tabs (acting on an invite/team that changed), the last spot,
 * the deadline minute, and one-league-per-person.
 */
import assert from "node:assert/strict";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Tx } from "../src/db/pool";
import {
  AlreadyDone,
  LeagueError,
  invitePartnerTx,
  leaveLeagueTx,
  pairFreeAgentsTx,
  registerForLeagueTx,
  respondToInviteTx,
} from "../src/lib/league";
import { withdrawTeamTx } from "../src/lib/tournament";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — run via `npm run test:league`.");
  process.exit(1);
}

class Rollback extends Error {}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const conn = drizzle(pool, { schema });

const HOUR = 3_600_000;
const tag = `edge-${Date.now().toString(36)}`;
let n = 0;

async function makeUser(tx: Tx, opts: { status?: "approved" | "pending"; comp?: boolean; name?: string } = {}) {
  const i = ++n;
  const [u] = await tx
    .insert(schema.users)
    .values({
      name: opts.name ?? `Edge Tester${i}`,
      email: `${tag}-${i}@berkeley.edu`,
      status: opts.status ?? "approved",
      onCompetitiveTeam: opts.comp ?? false,
    })
    .returning();
  return u;
}

async function makeLeague(tx: Tx, opts: Partial<typeof schema.tournaments.$inferInsert> = {}) {
  const [l] = await tx
    .insert(schema.tournaments)
    .values({
      name: `${tag} League`,
      kind: "im_semester",
      division: "beginner",
      status: "registration",
      registrationClosesAt: new Date(Date.now() + 24 * HOUR),
      maxPlayers: 8,
      poolSize: 8,
      advancePerPool: 2,
      ...opts,
    })
    .returning();
  return l;
}

async function rows(tx: Tx, teamId: string) {
  return tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, teamId));
}

async function spots(tx: Tx, tournamentId: string) {
  const all = await tx
    .select({ status: schema.tmTeamMembers.inviteStatus, teamStatus: schema.tmTeams.status })
    .from(schema.tmTeamMembers)
    .innerJoin(schema.tmTeams, eq(schema.tmTeamMembers.teamId, schema.tmTeams.id))
    .where(eq(schema.tmTeams.tournamentId, tournamentId));
  return all.filter((r) => r.teamStatus !== "withdrawn" && r.status !== "declined").length;
}

/** Asserts `p` rejects with a LeagueError (a friendly message, not a crash) and returns it. */
async function friendly(p: Promise<unknown>, kind: typeof LeagueError = LeagueError): Promise<LeagueError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof kind, `expected ${kind.name}, got ${e instanceof Error ? `${e.constructor.name}: ${e.message}` : e}`);
    return e as LeagueError;
  }
  assert.fail(`expected a ${kind.name}, but it succeeded`);
}

/** A failed statement aborts a Postgres transaction, so each expected failure runs in a savepoint. */
function sp<T>(tx: Tx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx.transaction(fn) as Promise<T>;
}

const scenarios: [string, (tx: Tx) => Promise<void>][] = [
  [
    "double-click Sign up: second submit is a no-op success, one team only",
    async (tx) => {
      const league = await makeLeague(tx);
      const me = await makeUser(tx);
      await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id });
      await friendly(sp(tx, (t) => registerForLeagueTx(t, { tournamentId: league.id, userId: me.id })), AlreadyDone);
      assert.equal(await spots(tx, league.id), 1);
    },
  ],
  [
    "refresh-resubmit with a partner doesn't create a second team or second invite",
    async (tx) => {
      const league = await makeLeague(tx);
      const [me, partner] = [await makeUser(tx), await makeUser(tx)];
      await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id, partnerEmail: partner.email });
      await friendly(
        sp(tx, (t) => registerForLeagueTx(t, { tournamentId: league.id, userId: me.id, partnerEmail: partner.email })),
        AlreadyDone,
      );
      assert.equal(await spots(tx, league.id), 2);
    },
  ],
  [
    "partner email typed in a different case still matches their account",
    async (tx) => {
      const league = await makeLeague(tx);
      const [me, partner] = [await makeUser(tx), await makeUser(tx)];
      const r = await registerForLeagueTx(tx, {
        tournamentId: league.id,
        userId: me.id,
        partnerEmail: `  ${partner.email.toUpperCase()} `,
      });
      assert.equal(r.partner?.id, partner.id);
    },
  ],
  [
    "double-click Accept: second click is a no-op success",
    async (tx) => {
      const league = await makeLeague(tx);
      const [me, partner] = [await makeUser(tx), await makeUser(tx)];
      const { teamId } = await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id, partnerEmail: partner.email });
      await respondToInviteTx(tx, { teamId, userId: partner.id, accept: true });
      await friendly(sp(tx, (t) => respondToInviteTx(t, { teamId, userId: partner.id, accept: true })), AlreadyDone);
      const members = await rows(tx, teamId);
      assert.equal(members.filter((m) => m.inviteStatus === "accepted").length, 2);
    },
  ],
  [
    "double-click Decline: second click is a no-op success",
    async (tx) => {
      const league = await makeLeague(tx);
      const [me, partner] = [await makeUser(tx), await makeUser(tx)];
      const { teamId } = await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id, partnerEmail: partner.email });
      await respondToInviteTx(tx, { teamId, userId: partner.id, accept: false });
      await friendly(sp(tx, (t) => respondToInviteTx(t, { teamId, userId: partner.id, accept: false })), AlreadyDone);
      assert.equal(await spots(tx, league.id), 1);
    },
  ],
  [
    "stale tab: accepting an invite the captain already replaced is a clear error",
    async (tx) => {
      const league = await makeLeague(tx);
      const [me, first, second] = [await makeUser(tx), await makeUser(tx), await makeUser(tx)];
      const { teamId } = await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id, partnerEmail: first.email });
      await invitePartnerTx(tx, { teamId, userId: me.id, partnerEmail: second.email });
      const e = await friendly(sp(tx, (t) => respondToInviteTx(t, { teamId, userId: first.id, accept: true })));
      assert.match(e.message, /no longer open/);
      assert.equal(await spots(tx, league.id), 2, "replacing an invite hands over the spot, not adds one");
    },
  ],
  [
    "stale tab: accepting after the captain left (team withdrawn) is a clear error",
    async (tx) => {
      const league = await makeLeague(tx);
      const [me, partner] = [await makeUser(tx), await makeUser(tx)];
      const { teamId } = await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id, partnerEmail: partner.email });
      await leaveLeagueTx(tx, { teamId, userId: me.id });
      await friendly(sp(tx, (t) => respondToInviteTx(t, { teamId, userId: partner.id, accept: true })));
      assert.equal(await spots(tx, league.id), 0);
    },
  ],
  [
    "double-click Leave: second click is a no-op success, spot freed once",
    async (tx) => {
      const league = await makeLeague(tx);
      const me = await makeUser(tx);
      const { teamId } = await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id });
      await leaveLeagueTx(tx, { teamId, userId: me.id });
      await friendly(sp(tx, (t) => leaveLeagueTx(t, { teamId, userId: me.id })), AlreadyDone);
      assert.equal(await spots(tx, league.id), 0);
    },
  ],
  [
    "leave then sign up again works (and the old team stays withdrawn)",
    async (tx) => {
      const league = await makeLeague(tx);
      const me = await makeUser(tx);
      const first = await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id });
      await leaveLeagueTx(tx, { teamId: first.teamId, userId: me.id });
      const again = await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id });
      assert.notEqual(again.teamId, first.teamId);
      assert.equal(await spots(tx, league.id), 1);
    },
  ],
  [
    "stale tab: leaving a team exec just merged away is a clear error, not a crash",
    async (tx) => {
      const league = await makeLeague(tx);
      const [a, b] = [await makeUser(tx), await makeUser(tx)];
      const ta = await registerForLeagueTx(tx, { tournamentId: league.id, userId: a.id });
      const tb = await registerForLeagueTx(tx, { tournamentId: league.id, userId: b.id });
      await pairFreeAgentsTx(tx, { teamAId: ta.teamId, teamBId: tb.teamId });
      const e = await friendly(sp(tx, (t) => leaveLeagueTx(t, { teamId: tb.teamId, userId: b.id })));
      assert.ok(!(e instanceof AlreadyDone), "must not claim they left — they're still on the merged team");
      assert.equal(await spots(tx, league.id), 2);
    },
  ],
  [
    "last spot: a pair is told to go solo, a solo player gets it, the next person sees Full",
    async (tx) => {
      const league = await makeLeague(tx, { maxPlayers: 3 });
      const [a, b, c, d, e] = [await makeUser(tx), await makeUser(tx), await makeUser(tx), await makeUser(tx), await makeUser(tx)];
      await registerForLeagueTx(tx, { tournamentId: league.id, userId: a.id, partnerEmail: b.email });
      const pair = await friendly(sp(tx, (t) => registerForLeagueTx(t, { tournamentId: league.id, userId: c.id, partnerEmail: d.email })));
      assert.match(pair.message, /Only 1 spot left/);
      await registerForLeagueTx(tx, { tournamentId: league.id, userId: c.id });
      const full = await friendly(sp(tx, (t) => registerForLeagueTx(t, { tournamentId: league.id, userId: e.id })));
      assert.match(full.message, /full/);
      assert.equal(await spots(tx, league.id), 3);
    },
  ],
  [
    "a declined invite frees its spot for the next person",
    async (tx) => {
      const league = await makeLeague(tx, { maxPlayers: 2 });
      const [a, b, c] = [await makeUser(tx), await makeUser(tx), await makeUser(tx)];
      const { teamId } = await registerForLeagueTx(tx, { tournamentId: league.id, userId: a.id, partnerEmail: b.email });
      await friendly(sp(tx, (t) => registerForLeagueTx(t, { tournamentId: league.id, userId: c.id })));
      await respondToInviteTx(tx, { teamId, userId: b.id, accept: false });
      await registerForLeagueTx(tx, { tournamentId: league.id, userId: c.id });
    },
  ],
  [
    "deadline: open through 11:59 PM, closed right after — for sign-up and invites",
    async (tx) => {
      const me = await makeUser(tx);
      const open = await makeLeague(tx, { registrationClosesAt: new Date(Date.now() + 60_000) });
      const { teamId } = await registerForLeagueTx(tx, { tournamentId: open.id, userId: me.id });
      await tx
        .update(schema.tournaments)
        .set({ registrationClosesAt: new Date(Date.now() - 1) })
        .where(eq(schema.tournaments.id, open.id));
      const other = await makeUser(tx);
      await friendly(sp(tx, (t) => registerForLeagueTx(t, { tournamentId: open.id, userId: other.id })));
      await friendly(sp(tx, (t) => invitePartnerTx(t, { teamId, userId: me.id, partnerEmail: other.email })));
    },
  ],
  [
    "an invite sent before the deadline can still be accepted after it (until the draw)",
    async (tx) => {
      const league = await makeLeague(tx);
      const [me, partner] = [await makeUser(tx), await makeUser(tx)];
      const { teamId } = await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id, partnerEmail: partner.email });
      await tx
        .update(schema.tournaments)
        .set({ registrationClosesAt: new Date(Date.now() - 1) })
        .where(eq(schema.tournaments.id, league.id));
      await respondToInviteTx(tx, { teamId, userId: partner.id, accept: true });
    },
  ],
  [
    "one league per person: second league is refused with a readable reason",
    async (tx) => {
      const [l1, l2] = [await makeLeague(tx), await makeLeague(tx, { division: "advanced" })];
      const me = await makeUser(tx);
      await registerForLeagueTx(tx, { tournamentId: l1.id, userId: me.id });
      const e = await friendly(sp(tx, (t) => registerForLeagueTx(t, { tournamentId: l2.id, userId: me.id })));
      assert.match(e.message, /one league per person/);
    },
  ],
  [
    "accepting one invite auto-declines the others; the other captain's spot frees up",
    async (tx) => {
      const [l1, l2] = [await makeLeague(tx), await makeLeague(tx, { division: "advanced" })];
      const [cap1, cap2, me] = [await makeUser(tx), await makeUser(tx), await makeUser(tx)];
      const t1 = await registerForLeagueTx(tx, { tournamentId: l1.id, userId: cap1.id, partnerEmail: me.email });
      const t2 = await registerForLeagueTx(tx, { tournamentId: l2.id, userId: cap2.id, partnerEmail: me.email });
      await respondToInviteTx(tx, { teamId: t1.teamId, userId: me.id, accept: true });
      const [other] = (await rows(tx, t2.teamId)).filter((m) => m.memberId === me.id);
      assert.equal(other.inviteStatus, "declined");
      assert.equal(await spots(tx, l2.id), 1);
      await friendly(sp(tx, (t) => respondToInviteTx(t, { teamId: t2.teamId, userId: me.id, accept: true })));
    },
  ],
  [
    "comp league: non-comp player and non-comp partner are both refused",
    async (tx) => {
      const league = await makeLeague(tx, { division: "competitive", eligibility: "competitive_only" });
      const [social, comp] = [await makeUser(tx), await makeUser(tx, { comp: true })];
      await friendly(sp(tx, (t) => registerForLeagueTx(t, { tournamentId: league.id, userId: social.id })));
      await friendly(
        sp(tx, (t) => registerForLeagueTx(t, { tournamentId: league.id, userId: comp.id, partnerEmail: social.email })),
      );
      await registerForLeagueTx(tx, { tournamentId: league.id, userId: comp.id });
    },
  ],
  [
    "bad partner input: self, unknown email, pending account — all friendly errors",
    async (tx) => {
      const league = await makeLeague(tx);
      const me = await makeUser(tx);
      const pending = await makeUser(tx, { status: "pending" });
      for (const partnerEmail of [me.email, `${tag}-nobody@berkeley.edu`, pending.email]) {
        await friendly(sp(tx, (t) => registerForLeagueTx(t, { tournamentId: league.id, userId: me.id, partnerEmail })));
      }
      assert.equal(await spots(tx, league.id), 0);
    },
  ],
  [
    "pending (unapproved) member can't sign up even with a forged request",
    async (tx) => {
      const league = await makeLeague(tx);
      const pending = await makeUser(tx, { status: "pending" });
      await friendly(sp(tx, (t) => registerForLeagueTx(t, { tournamentId: league.id, userId: pending.id })));
    },
  ],
  [
    "league deleted or not a league: friendly error, not a crash",
    async (tx) => {
      const me = await makeUser(tx);
      await friendly(
        sp(tx, (t) => registerForLeagueTx(t, { tournamentId: "00000000-0000-4000-8000-000000000000", userId: me.id })),
      );
    },
  ],
  [
    "exec withdraws a team while the partner's invite is still open: invite closes, spots free",
    async (tx) => {
      const league = await makeLeague(tx);
      const [me, partner] = [await makeUser(tx), await makeUser(tx)];
      const { teamId } = await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id, partnerEmail: partner.email });
      await withdrawTeamTx(tx, teamId);
      assert.equal(await spots(tx, league.id), 0);
      await friendly(sp(tx, (t) => respondToInviteTx(t, { teamId, userId: partner.id, accept: true })));
      await friendly(sp(tx, (t) => leaveLeagueTx(t, { teamId, userId: me.id })), AlreadyDone);
    },
  ],
  [
    "after the draw, members can't leave or sign up (exec handles it)",
    async (tx) => {
      const league = await makeLeague(tx);
      const me = await makeUser(tx);
      const { teamId } = await registerForLeagueTx(tx, { tournamentId: league.id, userId: me.id });
      await tx.update(schema.tournaments).set({ status: "pools" }).where(eq(schema.tournaments.id, league.id));
      const e = await friendly(sp(tx, (t) => leaveLeagueTx(t, { teamId, userId: me.id })));
      assert.match(e.message, /draw has already been made/);
      const [still] = await tx
        .select()
        .from(schema.tmTeamMembers)
        .where(and(eq(schema.tmTeamMembers.teamId, teamId), eq(schema.tmTeamMembers.memberId, me.id)));
      assert.equal(still.inviteStatus, "accepted");
    },
  ],
];

async function main() {
  let failed = 0;
  for (const [name, run] of scenarios) {
    try {
      await conn.transaction(async (tx) => {
        await run(tx);
        throw new Rollback();
      });
    } catch (e) {
      if (e instanceof Rollback) {
        console.log(`  ✓ ${name}`);
        continue;
      }
      failed++;
      console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
    }
  }

  // Belt and braces: every scenario rolled back, so nothing tagged should exist.
  const leftovers = await conn
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, `${tag}-1@berkeley.edu`));
  await pool.end();

  console.log(`\n${scenarios.length - failed}/${scenarios.length} passed${leftovers.length ? " — WARNING: test rows leaked" : ""}`);
  process.exit(failed || leftovers.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
