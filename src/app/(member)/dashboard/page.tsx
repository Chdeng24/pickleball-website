import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte } from "drizzle-orm";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { db, schema } from "@/db";
import { getSessionUser } from "@/lib/session";
import { formatEventWhen } from "@/lib/dates";
import { Kicker } from "@/components/ui/kicker";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await getSessionUser();
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const now = new Date();

  // "Your next practice" — soonest future event this member is confirmed for.
  // A join (not the relational query API) so we can filter and order by the
  // joined event's startsAt directly, in one round trip.
  const nextRows = user
    ? await db()
        .select({ event: schema.events })
        .from(schema.rsvps)
        .innerJoin(schema.events, eq(schema.rsvps.eventId, schema.events.id))
        .where(
          and(
            eq(schema.rsvps.memberId, user.id),
            eq(schema.rsvps.status, "confirmed"),
            gte(schema.events.startsAt, now),
          ),
        )
        .orderBy(asc(schema.events.startsAt))
        .limit(1)
    : [];

  const nextEvent = nextRows[0]?.event ?? null;

  // "Open for RSVP" — published, upcoming, RSVP window already open.
  const openEvents = await db()
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.published, true), gte(schema.events.startsAt, now)))
    .orderBy(asc(schema.events.startsAt))
    .limit(6);

  const rsvpOpen = openEvents.filter((e) => !e.rsvpOpensAt || e.rsvpOpensAt <= now);

  return (
    <div className="space-y-12">
      <div>
        <Kicker>Welcome back</Kicker>
        <h1 className="mt-3 font-display text-3xl font-extrabold uppercase text-navy-900 sm:text-4xl">
          Hey, {firstName}
        </h1>
      </div>

      <section>
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-ink/50">
          Your next practice
        </h2>

        {nextEvent ? (
          <div className="mt-4 border-2 border-navy-900 bg-white p-6">
            <h3 className="font-display text-xl font-extrabold uppercase text-navy-900">
              {nextEvent.title}
            </h3>
            <dl className="mt-4 space-y-2 text-sm text-ink/70">
              <div className="flex items-center gap-2.5">
                <CalendarDays size={16} className="text-gold-500" />
                <dd>{formatEventWhen(nextEvent.startsAt, nextEvent.endsAt)}</dd>
              </div>
              <div className="flex items-center gap-2.5">
                <MapPin size={16} className="text-gold-500" />
                <dd>{nextEvent.location}</dd>
              </div>
            </dl>
            <Link
              href={`/events/${nextEvent.id}`}
              className="mt-6 flex h-10 w-full items-center justify-center border-2 border-navy-900/15 font-display text-xs font-bold uppercase tracking-[0.12em] text-navy-900 transition-colors hover:border-navy-900"
            >
              Manage RSVP
            </Link>
          </div>
        ) : (
          <div className="mt-4 border-2 border-dashed border-navy-900/15 bg-white p-8 text-center text-sm text-ink/50">
            You&apos;re not signed up for anything yet.{" "}
            <Link href="/events" className="font-semibold text-navy-800 underline underline-offset-2">
              Browse events
            </Link>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-display text-sm font-bold uppercase tracking-[0.14em] text-ink/50">
          Open for RSVP
        </h2>

        {rsvpOpen.length === 0 ? (
          <div className="mt-4 border-2 border-dashed border-navy-900/15 bg-white p-8 text-center text-sm text-ink/50">
            Nothing open right now — check back soon.
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {rsvpOpen.map((event) => (
              <li key={event.id}>
                <Link
                  href={`/events/${event.id}`}
                  className="flex items-center justify-between gap-4 border-2 border-navy-900/10 bg-white p-5 transition-colors hover:border-navy-900"
                >
                  <div>
                    <p className="font-display text-base font-bold uppercase text-navy-900">
                      {event.title}
                    </p>
                    <p className="mt-1 text-sm text-ink/60">
                      {formatEventWhen(event.startsAt, event.endsAt)}
                    </p>
                  </div>
                  {event.capacity !== null && (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink/45">
                      <Users size={14} /> cap {event.capacity}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
