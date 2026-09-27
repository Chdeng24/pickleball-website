/**
 * Strike policy — RSVP and don't turn up, and it counts against you.
 *
 * A practice has 20 spots. Someone who RSVPs and no-shows didn't just miss a
 * session; they held a spot another member wanted and nobody could take. Two
 * strikes and exec removes them from the club.
 *
 * Deliberately pure: strikes are DERIVED from attendance records, never stored
 * as a counter. That means the count can't drift out of sync with the history
 * behind it, and an exec who marks the wrong person fixes it by correcting the
 * attendance — the strike disappears with it. There is no separate "forgive a
 * strike" button because there doesn't need to be one.
 *
 * Zero DB or Next.js imports on purpose, so `node --test` runs this directly.
 */

/** Strikes at or above this and exec removes them from the club. */
export const STRIKE_LIMIT = 2;

export type AttendanceState = "unmarked" | "present" | "no_show";

export type AttendanceRecord = {
  status: "confirmed" | "waitlist" | "cancelled";
  attendance: AttendanceState;
};

/**
 * Only a no-show on a CONFIRMED spot is a strike.
 *
 * Waitlisted members never had a spot to waste, and someone who cancelled gave
 * their spot back in time for it to be reused — which is exactly the behaviour
 * the policy exists to encourage. Punishing a cancellation would teach members
 * to quietly not show up instead, which is strictly worse for the club.
 */
export function isStrike(row: AttendanceRecord): boolean {
  return row.status === "confirmed" && row.attendance === "no_show";
}

export function countStrikes(rows: AttendanceRecord[]): number {
  return rows.filter(isStrike).length;
}

export type StrikeState = "clear" | "warning" | "flagged";

/**
 * `warning` is one away from removal — the point at which an exec should say
 * something to them, while it's still fixable.
 */
export function strikeState(strikes: number): StrikeState {
  if (strikes >= STRIKE_LIMIT) return "flagged";
  if (strikes > 0) return "warning";
  return "clear";
}

/** How many more no-shows before removal. 0 means they're already at the limit. */
export function strikesRemaining(strikes: number): number {
  return Math.max(0, STRIKE_LIMIT - strikes);
}

export type EventType = "practice" | "social" | "fundraiser" | "tournament";

/**
 * Only practices take attendance. They're the capped sessions — a no-show at a
 * practice held a spot someone on the waitlist wanted. Socials and fundraisers
 * are uncapped, so nobody was kept out and there's nothing to strike.
 */
export function tracksAttendance(event: { type: EventType }): boolean {
  return event.type === "practice";
}

/**
 * Attendance is recorded after the fact, so there is nothing to mark until the
 * session has actually started. Guards the exec UI and re-checked server-side.
 */
export function canRecordAttendance(
  event: { type: EventType; startsAt: Date },
  now: Date,
): boolean {
  return tracksAttendance(event) && event.startsAt <= now;
}

/**
 * Which RSVPs an exec is expected to mark for a session.
 *
 * Only confirmed spots: a waitlisted member who never got in has nothing to
 * attend, and a cancelled RSVP is already resolved. This is also what the
 * "mark everyone else as a no-show" bulk action applies to — it must never be
 * able to reach someone who cancelled properly.
 */
export function isMarkable(row: { status: "confirmed" | "waitlist" | "cancelled" }): boolean {
  return row.status === "confirmed";
}
