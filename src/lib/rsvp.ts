import "server-only";
import { and, asc, eq, ne } from "drizzle-orm";
import { withTransaction } from "@/db/pool";
import { db, schema } from "@/db";
import {
  RsvpError,
  checkRsvpWindow,
  decideStatus,
  repackPositions,
  resolveInsertOrReactivate,
  selectPromotion,
} from "./rsvp-logic";

export { RsvpError } from "./rsvp-logic";
export type { RsvpErrorReason } from "./rsvp-logic";

/**
 * RSVP a member to an event, respecting capacity.
 *
 * This is the highest-risk code in the project. "First 20 to RSVP" is a race:
 * if 40 people tap at 8:00:00 PM, a naive count-then-insert can admit more
 * than 20 and someone shows up to a full court. The whole decision runs
 * inside one transaction that locks the event row with `SELECT ... FOR
 * UPDATE`, so concurrent RSVPs for the same event serialize instead of racing.
 *
 * Returns the resulting status and the member's 1-based position within it.
 */
export async function rsvp(
  eventId: string,
  memberId: string,
): Promise<{ status: "confirmed" | "waitlist"; position: number }> {
  return withTransaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .for("update");
    if (!event) throw new RsvpError("not_found");

    const gate = checkRsvpWindow(event, new Date());
    if (!gate.ok) throw new RsvpError(gate.reason);

    const [existing] = await tx
      .select()
      .from(schema.rsvps)
      .where(and(eq(schema.rsvps.eventId, eventId), eq(schema.rsvps.memberId, memberId)));

    const action = resolveInsertOrReactivate(existing?.status ?? null);
    if (action === "reject") throw new RsvpError("already_rsvpd");

    const confirmedCount = await tx.$count(
      schema.rsvps,
      and(eq(schema.rsvps.eventId, eventId), eq(schema.rsvps.status, "confirmed")),
    );
    const status = decideStatus(confirmedCount, event.capacity);

    const sameStatusCount = await tx.$count(
      schema.rsvps,
      and(eq(schema.rsvps.eventId, eventId), eq(schema.rsvps.status, status)),
    );
    const position = sameStatusCount + 1;

    if (action === "insert") {
      await tx.insert(schema.rsvps).values({ eventId, memberId, status, position });
    } else {
      // Reactivating a cancelled row — update in place. The UNIQUE(event_id,
      // member_id) constraint means this can never collide with a fresh insert.
      await tx
        .update(schema.rsvps)
        .set({ status, position })
        .where(and(eq(schema.rsvps.eventId, eventId), eq(schema.rsvps.memberId, memberId)));
    }

    return { status, position };
  });
}

/**
 * Cancel a member's RSVP. If they were confirmed, promotes the earliest
 * waitlisted member into their slot and returns that member so the caller can
 * email them — email sending itself happens outside this transaction (D1/D2).
 */
export async function cancelRsvp(
  eventId: string,
  memberId: string,
): Promise<{ promoted: { id: string; email: string; name: string | null } | null }> {
  return withTransaction(async (tx) => {
    await tx.select().from(schema.events).where(eq(schema.events.id, eventId)).for("update");

    const [existing] = await tx
      .select()
      .from(schema.rsvps)
      .where(and(eq(schema.rsvps.eventId, eventId), eq(schema.rsvps.memberId, memberId)));

    if (!existing || existing.status === "cancelled") throw new RsvpError("not_rsvpd");

    const wasConfirmed = existing.status === "confirmed";

    await tx
      .update(schema.rsvps)
      .set({ status: "cancelled" })
      .where(eq(schema.rsvps.id, existing.id));

    // Close the gap left in whichever list the cancelled row came out of.
    const remaining = await tx
      .select()
      .from(schema.rsvps)
      .where(
        and(
          eq(schema.rsvps.eventId, eventId),
          eq(schema.rsvps.status, existing.status),
          ne(schema.rsvps.id, existing.id),
        ),
      )
      .orderBy(asc(schema.rsvps.position));

    for (const row of repackPositions(remaining)) {
      await tx.update(schema.rsvps).set({ position: row.position }).where(eq(schema.rsvps.id, row.id));
    }

    if (!wasConfirmed) return { promoted: null };

    // A confirmed slot opened up — pull the earliest waitlisted member in.
    const waitlist = await tx
      .select()
      .from(schema.rsvps)
      .where(and(eq(schema.rsvps.eventId, eventId), eq(schema.rsvps.status, "waitlist")))
      .orderBy(asc(schema.rsvps.position));

    const promotee = selectPromotion(waitlist);
    if (!promotee) return { promoted: null };

    const confirmedCount = await tx.$count(
      schema.rsvps,
      and(eq(schema.rsvps.eventId, eventId), eq(schema.rsvps.status, "confirmed")),
    );

    await tx
      .update(schema.rsvps)
      .set({ status: "confirmed", position: confirmedCount + 1 })
      .where(eq(schema.rsvps.id, promotee.id));

    const stillWaitlisted = waitlist.filter((r) => r.id !== promotee.id);
    for (const row of repackPositions(stillWaitlisted)) {
      await tx.update(schema.rsvps).set({ position: row.position }).where(eq(schema.rsvps.id, row.id));
    }

    const [promotedUser] = await tx
      .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, promotee.memberId));

    return { promoted: promotedUser ?? null };
  });
}

export type RsvpWithMember = typeof schema.rsvps.$inferSelect & {
  member: { id: string; name: string | null; email: string; image: string | null };
};

/** Confirmed first (by position), then waitlist (by position). */
export async function listRsvps(eventId: string): Promise<RsvpWithMember[]> {
  const rows = await db()
    .select({ rsvp: schema.rsvps, member: schema.users })
    .from(schema.rsvps)
    .innerJoin(schema.users, eq(schema.rsvps.memberId, schema.users.id))
    .where(and(eq(schema.rsvps.eventId, eventId), ne(schema.rsvps.status, "cancelled")));

  const order = { confirmed: 0, waitlist: 1 } as const;
  return rows
    .map((r) => ({ ...r.rsvp, member: r.member }))
    .sort(
      (a, b) =>
        order[a.status as "confirmed" | "waitlist"] - order[b.status as "confirmed" | "waitlist"] ||
        a.position - b.position,
    );
}

/**
 * Recompute and persist derived skill level from a member's full RSVP
 * history. Called after any RSVP confirm or cancel — cheap at this scale, and
 * simplest to reason about (always a fresh full recompute, never a delta).
 */
export async function refreshDerivedLevel(memberId: string): Promise<void> {
  const { deriveLevel } = await import("./derive-level");

  const rows = await db()
    .select({
      level: schema.events.level,
      status: schema.rsvps.status,
      startsAt: schema.events.startsAt,
    })
    .from(schema.rsvps)
    .innerJoin(schema.events, eq(schema.rsvps.eventId, schema.events.id))
    .where(eq(schema.rsvps.memberId, memberId));

  const [current] = await db()
    .select({ derivedLevel: schema.users.derivedLevel })
    .from(schema.users)
    .where(eq(schema.users.id, memberId));

  const computed = deriveLevel(rows);
  // Never regress a known level back to unknown — a member who only shows up
  // to a social afterward should keep their last known practice level.
  const next = computed === "unknown" ? (current?.derivedLevel ?? "unknown") : computed;

  if (next !== current?.derivedLevel) {
    await db().update(schema.users).set({ derivedLevel: next }).where(eq(schema.users.id, memberId));
  }
}
