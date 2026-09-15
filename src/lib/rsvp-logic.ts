/**
 * Pure RSVP decision logic — zero DB or Next.js imports on purpose, so this
 * file (and only this file) is directly runnable by `node --test`. The
 * transactional service in `rsvp.ts` imports from here and wires these
 * decisions to reads/writes inside the capacity-lock transaction.
 */

export type RsvpErrorReason =
  | "not_found"
  | "not_published"
  | "not_open"
  | "past"
  | "already_rsvpd"
  | "not_rsvpd";

export class RsvpError extends Error {
  // An explicit field, not a constructor parameter property — Node's native
  // TypeScript type-stripping (used by `node --test` on this file) erases
  // types but does not lower parameter-property syntax.
  reason: RsvpErrorReason;

  constructor(reason: RsvpErrorReason) {
    super(reason);
    this.name = "RsvpError";
    this.reason = reason;
  }
}

/** null capacity = unlimited (socials, fundraisers). */
export function decideStatus(
  confirmedCount: number,
  capacity: number | null,
): "confirmed" | "waitlist" {
  if (capacity === null) return "confirmed";
  return confirmedCount < capacity ? "confirmed" : "waitlist";
}

export type RsvpWindowEvent = {
  published: boolean;
  rsvpOpensAt: Date | null;
  startsAt: Date;
};

/** Every gate an RSVP attempt must clear, evaluated inside the row lock. */
export function checkRsvpWindow(
  event: RsvpWindowEvent,
  now: Date,
): { ok: true } | { ok: false; reason: RsvpErrorReason } {
  if (!event.published) return { ok: false, reason: "not_published" };
  if (event.rsvpOpensAt && event.rsvpOpensAt > now) return { ok: false, reason: "not_open" };
  if (event.startsAt <= now) return { ok: false, reason: "past" };
  return { ok: true };
}

/** What to do about a prior RSVP row for this member on this event, if any. */
export function resolveInsertOrReactivate(
  existingStatus: "confirmed" | "waitlist" | "cancelled" | null,
): "insert" | "reactivate" | "reject" {
  if (existingStatus === null) return "insert";
  if (existingStatus === "cancelled") return "reactivate";
  return "reject"; // already confirmed or waitlisted — not a duplicate signup
}

/** Reassign 1-based, contiguous positions in existing order. Pure and stable. */
export function repackPositions<T extends { position: number }>(rows: T[]): T[] {
  return [...rows]
    .sort((a, b) => a.position - b.position)
    .map((row, i) => ({ ...row, position: i + 1 }));
}

/** The next person off the waitlist — lowest position, i.e. earliest signup. */
export function selectPromotion<T extends { position: number }>(waitlist: T[]): T | null {
  if (waitlist.length === 0) return null;
  return waitlist.reduce((earliest, row) => (row.position < earliest.position ? row : earliest));
}
