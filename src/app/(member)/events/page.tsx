import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte } from "drizzle-orm";
import { MapPin, Users } from "lucide-react";
import { db, schema } from "@/db";
import { getSessionUser } from "@/lib/session";
import { formatEventTime, groupByDay } from "@/lib/dates";
import { Kicker } from "@/components/ui/kicker";

export const metadata: Metadata = { title: "Events" };

/**
 * Mobile agenda list, grouped by day — this is the primary surface, since
 * RSVPs happen on a phone between classes. A month grid is out of MVP scope.
 */
export default async function MemberEventsPage() {
  const user = await getSessionUser();
  const now = new Date();

  const events = await db()
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.published, true), gte(schema.events.startsAt, now)))
    .orderBy(asc(schema.events.startsAt));

  const myRsvps = user
    ? await db()
        .select({ eventId: schema.rsvps.eventId, status: schema.rsvps.status, position: schema.rsvps.position })
        .from(schema.rsvps)
        .where(eq(schema.rsvps.memberId, user.id))
    : [];
  const rsvpByEvent = new Map(myRsvps.map((r) => [r.eventId, r]));

  const grouped = groupByDay(events);

  return (
    <div className="space-y-10">
      <div>
        <Kicker>Calendar</Kicker>
        <h1 className="mt-3 font-display text-3xl font-extrabold uppercase text-navy-900 sm:text-4xl">
          Upcoming events
        </h1>
      </div>

      {grouped.length === 0 && (
        <div className="border-2 border-dashed border-navy-900/15 bg-white p-10 text-center text-ink/50">
          Nothing on the calendar yet — check back soon.
        </div>
      )}

      {grouped.map(([day, dayEvents]) => (
        <section key={day}>
          <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-ink/45">
            {day}
          </h2>
          <ul className="mt-4 space-y-3">
            {dayEvents.map((event) => {
              const mine = rsvpByEvent.get(event.id);
              return (
                <li key={event.id}>
                  <Link
                    href={`/events/${event.id}`}
                    className="flex items-center justify-between gap-4 border-2 border-navy-900/10 bg-white p-5 transition-colors hover:border-navy-900"
                  >
                    <div className="min-w-0">
                      <p className="font-display text-base font-bold uppercase text-navy-900">
                        {event.title}
                      </p>
                      <p className="mt-1 text-sm text-ink/60">{formatEventTime(event.startsAt)}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink/45">
                        <MapPin size={12} /> {event.location}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {mine?.status === "confirmed" && (
                        <span className="bg-navy-900 px-2.5 py-1 text-xs font-bold uppercase text-gold-500">
                          You&apos;re in
                        </span>
                      )}
                      {mine?.status === "waitlist" && (
                        <span className="bg-ink/10 px-2.5 py-1 text-xs font-bold uppercase text-ink/60">
                          Waitlist #{mine.position}
                        </span>
                      )}
                      {!mine && event.capacity !== null && (
                        <span className="flex items-center gap-1 text-xs text-ink/40">
                          <Users size={12} /> cap {event.capacity}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
