import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { withTransaction, type Tx } from "@/db/pool";
import { db, schema } from "@/db";
import {
  RsvpError,
  checkCancelWindow,
  checkRsvpWindow,
  decideStatus,
  repackPositions,
  resolveInsertOrReactivate,
  selectPromotion,
} from "./rsvp-logic";
import type { AttendanceState } from "./strikes";

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
  return withTransaction((tx) => rsvpTx(tx, eventId, memberId));
}

/**
 * The body of `rsvp`, taking a caller-supplied transaction.
 *
 * Split out so `npm run test:rsvp` can drive it against the real database
 * inside a transaction it always rolls back — the same pattern the league
 * sign-up code uses. Production always reaches it through `rsvp` above.
 */
export async function rsvpTx(
  tx: Tx,
  eventId: string,
  memberId: string,
): Promise<{ status: "confirmed" | "waitlist"; position: number }> {
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
  return withTransaction((tx) => cancelRsvpTx(tx, eventId, memberId));
}

/** The body of `cancelRsvp`, taking a caller-supplied transaction. See `rsvpTx`. */
export async function cancelRsvpTx(
  tx: Tx,
  eventId: string,
  memberId: string,
): Promise<{ promoted: { id: string; email: string; name: string | null } | null }> {
  const [event] = await tx
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .for("update");
  if (!event) throw new RsvpError("not_found");

  const gate = checkCancelWindow(event, new Date());
  if (!gate.ok) throw new RsvpError(gate.reason);

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

/**
 * Record one member's attendance. The `status = 'confirmed'` guard sits in the
 * UPDATE itself, not just in the caller's pre-check, so nothing that loses a
 * race can mark a row that isn't holding a confirmed spot. Returns whether a
 * row was updated.
 */
export async function setAttendanceTx(
  tx: Tx,
  rsvpId: string,
  next: AttendanceState,
  execId: string,
): Promise<boolean> {
  const updated = await tx
    .update(schema.rsvps)
    .set({
      attendance: next,
      checkedInAt: next === "present" ? new Date() : null,
      attendanceMarkedBy: next === "unmarked" ? null : execId,
    })
    .where(and(eq(schema.rsvps.id, rsvpId), eq(schema.rsvps.status, "confirmed")))
    .returning({ id: schema.rsvps.id });
  return updated.length > 0;
}

/**
 * Mark every confirmed, still-unmarked RSVP for a session as a no-show.
 *
 * One UPDATE whose WHERE Postgres re-checks against the latest row version, so
 * a check-in that commits first is never overwritten, and one that commits
 * after simply wins (they were there). Waitlisted and cancelled rows are
 * unreachable. Returns how many rows it marked.
 */
export async function markRemainingNoShowTx(tx: Tx, eventId: string, execId: string): Promise<number> {
  const updated = await tx
    .update(schema.rsvps)
    .set({ attendance: "no_show", checkedInAt: null, attendanceMarkedBy: execId })
    .where(
      and(
        eq(schema.rsvps.eventId, eventId),
        eq(schema.rsvps.status, "confirmed"),
        eq(schema.rsvps.attendance, "unmarked"),
      ),
    )
    .returning({ id: schema.rsvps.id });
  return updated.length;
}

/** Reset a whole session back to unmarked — the undo for marking the wrong event. */
export async function clearAttendanceTx(tx: Tx, eventId: string): Promise<void> {
  await tx
    .update(schema.rsvps)
    .set({ attendance: "unmarked", checkedInAt: null, attendanceMarkedBy: null })
    .where(eq(schema.rsvps.eventId, eventId));
}

/**
 * Strike counts for a set of members, in one query.
 *
 * Derived from attendance every time it's read — see `src/lib/strikes.ts` for
 * why there is no stored counter. Practices only, matching `tracksAttendance`. Exec-only data: no member-facing page calls
 * this.
 */
export async function strikeCounts(memberIds: string[]): Promise<Map<string, number>> {
  if (memberIds.length === 0) return new Map();

  const rows = await db()
    .select({ memberId: schema.rsvps.memberId, strikes: sql<number>`count(*)::int` })
    .from(schema.rsvps)
    .innerJoin(schema.events, eq(schema.rsvps.eventId, schema.events.id))
    .where(
      and(
        inArray(schema.rsvps.memberId, memberIds),
        eq(schema.events.type, "practice"),
        eq(schema.rsvps.status, "confirmed"),
        eq(schema.rsvps.attendance, "no_show"),
      ),
    )
    .groupBy(schema.rsvps.memberId);

  return new Map(rows.map((r) => [r.memberId, r.strikes]));
}

/** Every no-show on a member's record, newest first — the evidence behind their strikes. */
export async function strikeHistory(memberId: string) {
  return db()
    .select({
      rsvpId: schema.rsvps.id,
      eventId: schema.events.id,
      title: schema.events.title,
      startsAt: schema.events.startsAt,
    })
    .from(schema.rsvps)
    .innerJoin(schema.events, eq(schema.rsvps.eventId, schema.events.id))
    .where(
      and(
        eq(schema.rsvps.memberId, memberId),
        eq(schema.events.type, "practice"),
        eq(schema.rsvps.status, "confirmed"),
        eq(schema.rsvps.attendance, "no_show"),
      ),
    )
    .orderBy(desc(schema.events.startsAt));
}
