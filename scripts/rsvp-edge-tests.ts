/**
 * Edge-case + stress checks for event RSVPs, run against the REAL database:
 *
 *   npm run test:rsvp
 *
 * Two halves, both safe to run at any time — including while members are
 * RSVPing:
 *
 *   1. Scenario tests. Each runs in its own transaction that is ALWAYS rolled
 *      back, on a throwaway event and throwaway users it creates itself. Real
 *      events and real members are never read, locked, or written.
 *
 *   2. A concurrency stress test. A race needs genuinely concurrent database
 *      sessions, which cannot see each other's uncommitted rows, so this half
 *      does commit — but only to a throwaway event and users it creates, all
 *      of them tagged `@rsvp-stress.invalid`, and it deletes them in a
 *      `finally` (plus sweeps up any leftovers from a killed run on startup).
 *      No real row is ever touched: every write is scoped to that event id.
 *
 * What it is defending: the "first 20 get in" promise, and the rule that
 * nobody who already RSVP'd ever silently loses their spot.
 */
import assert from "node:assert/strict";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, asc, eq, like, ne } from "drizzle-orm";
import * as schema from "../src/db/schema";
import type { Tx } from "../src/db/pool";
import { RsvpError, rsvpTx, cancelRsvpTx } from "../src/lib/rsvp";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — run via `npm run test:rsvp`.");
  process.exit(1);
}

class Rollback extends Error {}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const conn = drizzle(pool, { schema });

const HOUR = 3_600_000;
/** Never a real member: `.invalid` is reserved by RFC 2606 and can't be registered. */
const STRESS_DOMAIN = "rsvp-stress.invalid";
const tag = `rsvp-edge-${Date.now().toString(36)}`;
let n = 0;

async function makeUser(tx: Tx, name = `RSVP Tester${++n}`) {
  const [u] = await tx
    .insert(schema.users)
    .values({ name, email: `${tag}-${n}@${STRESS_DOMAIN}`, status: "approved" })
    .returning();
  return u;
}

async function makeEvent(tx: Tx, opts: Partial<typeof schema.events.$inferInsert> = {}) {
  const [e] = await tx
    .insert(schema.events)
    .values({
      type: "practice",
      title: `${tag} Practice`,
      level: "advanced",
      location: "Test Courts",
      startsAt: new Date(Date.now() + 48 * HOUR),
      endsAt: new Date(Date.now() + 50 * HOUR),
      capacity: 2,
      published: true,
      ...opts,
    })
    .returning();
  return e;
}

/** Every non-cancelled row for an event, in list order. */
async function live(tx: Tx, eventId: string) {
  return tx
    .select()
    .from(schema.rsvps)
    .where(and(eq(schema.rsvps.eventId, eventId), ne(schema.rsvps.status, "cancelled")))
    .orderBy(asc(schema.rsvps.position));
}

function ofStatus(rows: Awaited<ReturnType<typeof live>>, status: "confirmed" | "waitlist") {
  return rows.filter((r) => r.status === status);
}

/**
 * The invariant the whole feature rests on: within each list, positions are
 * 1..n with no gaps, no duplicates, and one row per member.
 */
function assertWellFormed(rows: Awaited<ReturnType<typeof live>>, label: string) {
  for (const status of ["confirmed", "waitlist"] as const) {
    const list = ofStatus(rows, status);
    const positions = list.map((r) => r.position).sort((a, b) => a - b);
    assert.deepEqual(
      positions,
      list.map((_, i) => i + 1),
      `${label}: ${status} positions should be 1..${list.length}, got ${positions.join(",")}`,
    );
  }
  const members = rows.map((r) => r.memberId);
  assert.equal(new Set(members).size, members.length, `${label}: a member appears twice`);
}

/** Asserts `p` rejects with a friendly RsvpError (a toast), not a crash (the error page). */
async function friendly(p: Promise<unknown>): Promise<RsvpError> {
  try {
    await p;
  } catch (e) {
    assert.ok(
      e instanceof RsvpError,
      `expected a friendly RsvpError, got ${e instanceof Error ? `${e.constructor.name}: ${e.message}` : e}`,
    );
    return e as RsvpError;
  }
  assert.fail("expected a friendly RsvpError, but it succeeded");
}

/** A failed statement aborts a Postgres transaction, so each expected failure runs in a savepoint. */
function sp<T>(tx: Tx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx.transaction(fn) as Promise<T>;
}

const scenarios: [string, (tx: Tx) => Promise<void>][] = [
  [
    "capacity holds: the 3rd person into a 2-spot event is waitlisted, not admitted",
    async (tx) => {
      const event = await makeEvent(tx);
      const [a, b, c] = [await makeUser(tx), await makeUser(tx), await makeUser(tx)];

      assert.deepEqual(await rsvpTx(tx, event.id, a.id), { status: "confirmed", position: 1 });
      assert.deepEqual(await rsvpTx(tx, event.id, b.id), { status: "confirmed", position: 2 });
      assert.deepEqual(await rsvpTx(tx, event.id, c.id), { status: "waitlist", position: 1 });

      const rows = await live(tx, event.id);
      assert.equal(ofStatus(rows, "confirmed").length, 2);
      assertWellFormed(rows, "after filling to capacity");
    },
  ],
  [
    "uncapped event (social): everyone is confirmed, nobody is ever waitlisted",
    async (tx) => {
      const event = await makeEvent(tx, { type: "social", capacity: null });
      for (let i = 0; i < 5; i++) {
        const u = await makeUser(tx);
        assert.equal((await rsvpTx(tx, event.id, u.id)).status, "confirmed");
      }
      assertWellFormed(await live(tx, event.id), "uncapped");
    },
  ],
  [
    "double-tap RSVP: the second is refused, and does NOT create a second row",
    async (tx) => {
      const event = await makeEvent(tx);
      const me = await makeUser(tx);
      await rsvpTx(tx, event.id, me.id);

      const e = await friendly(sp(tx, (t) => rsvpTx(t, event.id, me.id)));
      assert.equal(e.reason, "already_rsvpd");

      const rows = await live(tx, event.id);
      assert.equal(rows.length, 1, "double-tap must not duplicate the RSVP");
      assert.equal(rows[0].status, "confirmed");
    },
  ],
  [
    "stale tab: cancelling twice is refused the second time, nobody else is disturbed",
    async (tx) => {
      const event = await makeEvent(tx);
      const [me, other] = [await makeUser(tx), await makeUser(tx)];
      await rsvpTx(tx, event.id, me.id);
      await rsvpTx(tx, event.id, other.id);

      await cancelRsvpTx(tx, event.id, me.id);
      const e = await friendly(sp(tx, (t) => cancelRsvpTx(t, event.id, me.id)));
      assert.equal(e.reason, "not_rsvpd");

      const rows = await live(tx, event.id);
      assert.equal(rows.length, 1, "the other member's RSVP must survive");
      assert.equal(rows[0].memberId, other.id);
      assertWellFormed(rows, "after a double cancel");
    },
  ],
  [
    "cancel then change your mind: re-RSVP reuses the row, never a duplicate",
    async (tx) => {
      const event = await makeEvent(tx);
      const me = await makeUser(tx);
      await rsvpTx(tx, event.id, me.id);
      await cancelRsvpTx(tx, event.id, me.id);
      assert.deepEqual(await rsvpTx(tx, event.id, me.id), { status: "confirmed", position: 1 });

      const all = await tx.select().from(schema.rsvps).where(eq(schema.rsvps.eventId, event.id));
      assert.equal(all.length, 1, "re-RSVP must reactivate the existing row");
    },
  ],
  [
    "a confirmed cancel promotes the FIRST waitlister and repacks both lists",
    async (tx) => {
      const event = await makeEvent(tx);
      const [a, b, c, d] = [await makeUser(tx), await makeUser(tx), await makeUser(tx), await makeUser(tx)];
      for (const u of [a, b, c, d]) await rsvpTx(tx, event.id, u.id);
      // a,b confirmed · c,d waitlisted (1,2)

      const { promoted } = await cancelRsvpTx(tx, event.id, a.id);
      assert.equal(promoted?.id, c.id, "the earliest waitlister gets the spot");

      const rows = await live(tx, event.id);
      assertWellFormed(rows, "after a promotion");
      assert.deepEqual(
        ofStatus(rows, "confirmed").map((r) => r.memberId).sort(),
        [b.id, c.id].sort(),
      );
      const wl = ofStatus(rows, "waitlist");
      assert.deepEqual(wl.map((r) => [r.memberId, r.position]), [[d.id, 1]], "d moves up to waitlist #1");
    },
  ],
  [
    "a waitlisted cancel promotes nobody and leaves every confirmed spot alone",
    async (tx) => {
      const event = await makeEvent(tx);
      const [a, b, c, d] = [await makeUser(tx), await makeUser(tx), await makeUser(tx), await makeUser(tx)];
      for (const u of [a, b, c, d]) await rsvpTx(tx, event.id, u.id);

      const { promoted } = await cancelRsvpTx(tx, event.id, c.id);
      assert.equal(promoted, null, "cancelling off the waitlist must not promote anyone");

      const rows = await live(tx, event.id);
      assertWellFormed(rows, "after a waitlist cancel");
      assert.deepEqual(ofStatus(rows, "confirmed").map((r) => r.memberId).sort(), [a.id, b.id].sort());
      assert.deepEqual(ofStatus(rows, "waitlist").map((r) => [r.memberId, r.position]), [[d.id, 1]]);
    },
  ],
  [
    "a full cancel-out then re-fill leaves clean 1..n positions, no ghost rows",
    async (tx) => {
      const event = await makeEvent(tx, { capacity: 3 });
      const users = [await makeUser(tx), await makeUser(tx), await makeUser(tx)];
      for (const u of users) await rsvpTx(tx, event.id, u.id);
      for (const u of users) await cancelRsvpTx(tx, event.id, u.id);
      assert.deepEqual(await live(tx, event.id), [], "everyone is gone");

      for (const u of users) await rsvpTx(tx, event.id, u.id);
      const rows = await live(tx, event.id);
      assert.equal(rows.length, 3);
      assertWellFormed(rows, "after re-filling an emptied event");
    },
  ],
  [
    "closed windows are refused with a friendly reason and write nothing",
    async (tx) => {
      const me = await makeUser(tx);
      const cases: [string, Partial<typeof schema.events.$inferInsert>, string][] = [
        ["unpublished", { published: false }, "not_published"],
        ["RSVPs not open yet", { rsvpOpensAt: new Date(Date.now() + 24 * HOUR) }, "not_open"],
        [
          "already happened",
          { startsAt: new Date(Date.now() - 4 * HOUR), endsAt: new Date(Date.now() - 2 * HOUR) },
          "past",
        ],
      ];

      for (const [label, overrides, reason] of cases) {
        const event = await makeEvent(tx, overrides);
        const e = await friendly(sp(tx, (t) => rsvpTx(t, event.id, me.id)));
        assert.equal(e.reason, reason, label);
        assert.deepEqual(await live(tx, event.id), [], `${label}: refused RSVP must write nothing`);
      }
    },
  ],
  [
    "an event that was deleted under a stale tab is a friendly 'no', not a crash",
    async (tx) => {
      const me = await makeUser(tx);
      const e = await friendly(
        sp(tx, (t) => rsvpTx(t, "00000000-0000-0000-0000-000000000000", me.id)),
      );
      assert.equal(e.reason, "not_found");
    },
  ],
  [
    "a mid-transaction failure rolls back completely — no half-applied RSVP",
    async (tx) => {
      const event = await makeEvent(tx);
      const [a, b] = [await makeUser(tx), await makeUser(tx)];
      await rsvpTx(tx, event.id, a.id);

      // Simulates a dropped connection *after* the insert, inside the same
      // transaction: the savepoint unwinds and b's RSVP never existed.
      await assert.rejects(
        sp(tx, async (t) => {
          await rsvpTx(t, event.id, b.id);
          throw new Error("simulated DB drop mid-transaction");
        }),
        /simulated DB drop/,
      );

      const rows = await live(tx, event.id);
      assert.equal(rows.length, 1, "the failed RSVP must leave nothing behind");
      assert.equal(rows[0].memberId, a.id, "and must not disturb the RSVP that already existed");
    },
  ],
  [
    "one event's RSVPs are untouched by activity on another event",
    async (tx) => {
      const [e1, e2] = [await makeEvent(tx), await makeEvent(tx)];
      const [a, b] = [await makeUser(tx), await makeUser(tx)];
      await rsvpTx(tx, e1.id, a.id);
      await rsvpTx(tx, e1.id, b.id);

      await rsvpTx(tx, e2.id, a.id);
      await cancelRsvpTx(tx, e2.id, a.id);

      const rows = await live(tx, e1.id);
      assert.equal(rows.length, 2, "the other event's list must be untouched");
      assertWellFormed(rows, "cross-event isolation");
    },
  ],
  [
    "the same person can hold a spot at two different events at once",
    async (tx) => {
      const [e1, e2] = [await makeEvent(tx), await makeEvent(tx)];
      const me = await makeUser(tx);
      assert.equal((await rsvpTx(tx, e1.id, me.id)).status, "confirmed");
      assert.equal((await rsvpTx(tx, e2.id, me.id)).status, "confirmed");
    },
  ],
];

/**
 * The race: `CONTENDERS` people tap RSVP at the same instant on an event with
 * `CAPACITY` spots, each on its own connection, exactly as separate Workers
 * requests would. Exactly `CAPACITY` must get in. This is the half that has to
 * commit, so it runs on a throwaway event that is deleted afterwards.
 */
const CAPACITY = 20;
const CONTENDERS = 40;

async function stressRace(): Promise<boolean> {
  const [event] = await conn
    .insert(schema.events)
    .values({
      type: "practice",
      title: `${tag} STRESS (auto-deleted)`,
      level: "advanced",
      location: "Stress Test",
      startsAt: new Date(Date.now() + 48 * HOUR),
      endsAt: new Date(Date.now() + 50 * HOUR),
      capacity: CAPACITY,
      published: false, // never visible on the site, even for the seconds it exists
    })
    .returning();

  try {
    const users = await conn
      .insert(schema.users)
      .values(
        Array.from({ length: CONTENDERS }, (_, i) => ({
          name: `Stress Tester ${i + 1}`,
          email: `${tag}-stress-${i + 1}@${STRESS_DOMAIN}`,
          status: "approved" as const,
        })),
      )
      .returning();

    // `published: false` would refuse every RSVP, so flip it on only now that
    // the contenders exist — the window is under a second and the event is
    // unlisted (no link, title marked auto-deleted).
    await conn.update(schema.events).set({ published: true }).where(eq(schema.events.id, event.id));

    const settled = await Promise.allSettled(
      users.map((u) =>
        // A fresh pool per contender = a genuinely separate session, the way
        // 40 phones hitting the Worker at once would be.
        (async () => {
          const p = new Pool({ connectionString: process.env.DATABASE_URL });
          try {
            return await drizzle(p, { schema }).transaction((tx) => rsvpTx(tx as Tx, event.id, u.id));
          } finally {
            await p.end().catch(() => {});
          }
        })(),
      ),
    );

    const failures = settled.filter((r) => r.status === "rejected");
    const rows = await live(conn as unknown as Tx, event.id);
    const confirmed = ofStatus(rows, "confirmed");
    const waitlist = ofStatus(rows, "waitlist");

    const problems: string[] = [];
    if (failures.length) {
      problems.push(
        `${failures.length}/${CONTENDERS} RSVPs threw: ${
          (failures[0] as PromiseRejectedResult).reason?.message ?? "?"
        }`,
      );
    }
    if (confirmed.length !== CAPACITY) {
      problems.push(`expected exactly ${CAPACITY} confirmed, got ${confirmed.length} — OVERSOLD/UNDERSOLD`);
    }
    if (rows.length !== CONTENDERS) {
      problems.push(`expected ${CONTENDERS} rows total, got ${rows.length} — someone was dropped`);
    }
    try {
      assertWellFormed(rows, "after the race");
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }

    console.log(
      problems.length
        ? `  ✗ ${CONTENDERS} simultaneous RSVPs for ${CAPACITY} spots\n      ${problems.join("\n      ")}`
        : `  ✓ ${CONTENDERS} simultaneous RSVPs for ${CAPACITY} spots → ${confirmed.length} confirmed, ${waitlist.length} waitlisted, positions clean`,
    );
    return problems.length === 0;
  } finally {
    // Cascades to the rsvp rows. Scoped to this one event id and this one
    // reserved-domain email pattern — it cannot reach a real member.
    await conn.delete(schema.events).where(eq(schema.events.id, event.id));
    await conn.delete(schema.users).where(like(schema.users.email, `%@${STRESS_DOMAIN}`));
  }
}

async function main() {
  // Sweep up after any earlier run that was killed before its cleanup.
  await conn.delete(schema.users).where(like(schema.users.email, `%@${STRESS_DOMAIN}`));
  await conn.delete(schema.events).where(like(schema.events.title, "rsvp-edge-%STRESS (auto-deleted)"));

  let failed = 0;
  for (const [name, run] of scenarios) {
    try {
      await conn.transaction(async (tx) => {
        await run(tx);
        throw new Rollback();
      });
      failed++;
      console.log(`  ✗ ${name}\n      scenario did not roll back`);
    } catch (e) {
      if (e instanceof Rollback) {
        console.log(`  ✓ ${name}`);
        continue;
      }
      failed++;
      console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log("\n  stress test (commits to a throwaway event, then deletes it):");
  if (!(await stressRace())) failed++;

  // Belt and braces: nothing this script created may survive it.
  const leftovers = await conn
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(like(schema.users.email, `%@${STRESS_DOMAIN}`));
  await pool.end();

  const total = scenarios.length + 1;
  console.log(
    `\n${total - failed}/${total} passed${leftovers.length ? ` — WARNING: ${leftovers.length} test rows leaked` : ""}`,
  );
  process.exit(failed || leftovers.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
