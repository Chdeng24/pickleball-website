import "server-only";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { sendEventReminder } from "@/lib/email";

/**
 * Sends the 24h-before reminder to every confirmed RSVP on events starting in
 * roughly the next day. Meant to be triggered on a schedule (see
 * /api/cron/event-reminders) — the caller decides how often it runs, this
 * just needs to run at least once inside the window below.
 *
 * Idempotent: each event is atomically claimed with an
 * `UPDATE ... WHERE reminder_24h_sent_at IS NULL` before any email goes out,
 * so an overlapping or retried run can never double-send.
 */
export async function sendDueEventReminders(): Promise<{ eventsNotified: number; emailsSent: number }> {
  const now = new Date();
  // Wide window (not exactly 24h) because the trigger firing this isn't
  // guaranteed to run every hour on the dot — better to catch an event late
  // within a day of it than to miss it entirely.
  const windowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 28 * 60 * 60 * 1000);

  const due = await db()
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.published, true),
        isNull(schema.events.reminder24hSentAt),
        gte(schema.events.startsAt, windowStart),
        lte(schema.events.startsAt, windowEnd),
      ),
    );

  let eventsNotified = 0;
  let emailsSent = 0;

  for (const { id: eventId } of due) {
    const claimed = await db()
      .update(schema.events)
      .set({ reminder24hSentAt: now })
      .where(and(eq(schema.events.id, eventId), isNull(schema.events.reminder24hSentAt)))
      .returning();
    const event = claimed[0];
    if (!event) continue; // another run already claimed this event

    const attendees = await db()
      .select({ email: schema.users.email, name: schema.users.name })
      .from(schema.rsvps)
      .innerJoin(schema.users, eq(schema.rsvps.memberId, schema.users.id))
      .where(and(eq(schema.rsvps.eventId, eventId), eq(schema.rsvps.status, "confirmed")));

    eventsNotified++;
    for (const attendee of attendees) {
      if (!attendee.email) continue;
      await sendEventReminder({ email: attendee.email, name: attendee.name }, event).catch((err) =>
        console.error("event reminder email failed", err),
      );
      emailsSent++;
    }
  }

  return { eventsNotified, emailsSent };
}
