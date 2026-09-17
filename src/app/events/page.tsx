import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import { MapPin, Trophy, Users } from "lucide-react";
import { db, schema } from "@/db";
import { getSessionUser, type SessionUser } from "@/lib/session";
import { isActiveMember } from "@/lib/access";
import { formatEventTime, groupByDay } from "@/lib/dates";
import { Kicker } from "@/components/ui/kicker";
import { MemberShell } from "@/components/site/member-shell";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";

export const metadata: Metadata = { title: "Events" };

type EventRow = typeof schema.events.$inferSelect;
type RsvpRow = { status: "confirmed" | "waitlist" | "cancelled"; position: number };

/**
 * Mobile agenda list, grouped by day — this is the primary surface, since
 * RSVPs happen on a phone between classes. A month grid is out of MVP scope.
 */
function Agenda({
  events,
  rsvpByEvent,
  heading,
  subhead,
}: {
  events: EventRow[];
  rsvpByEvent: Map<string, RsvpRow>;
  heading: string;
  subhead?: React.ReactNode;
}) {
  const grouped = groupByDay(events);

  return (
    <div className="space-y-10">
      <div>
        <Kicker>Calendar</Kicker>
        <h1 className="mt-3 font-display text-3xl font-extrabold uppercase text-navy-900 sm:text-4xl">
          {heading}
        </h1>
        {subhead}
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

const tournamentsLink = (
  <Link
    href="/tournaments"
    className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800 underline underline-offset-2"
  >
    <Trophy size={14} /> Looking for tournaments? See the Tournaments tab.
  </Link>
);

async function MemberEventsView({ user }: { user: SessionUser }) {
  const now = new Date();

  // Tournaments (infrequent, self-contained) get their own tab instead of
  // being buried between weekly practices — see /tournaments.
  const events = await db()
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.published, true),
        ne(schema.events.type, "tournament"),
        gte(schema.events.startsAt, now),
      ),
    )
    .orderBy(asc(schema.events.startsAt));

  const myRsvps = await db()
    .select({ eventId: schema.rsvps.eventId, status: schema.rsvps.status, position: schema.rsvps.position })
    .from(schema.rsvps)
    .where(eq(schema.rsvps.memberId, user.id));
  const rsvpByEvent = new Map(myRsvps.map((r) => [r.eventId, r]));

  return (
    <MemberShell user={user}>
      <Agenda events={events} rsvpByEvent={rsvpByEvent} heading="Upcoming events" subhead={tournamentsLink} />
    </MemberShell>
  );
}

/**
 * Anyone (signed in or not) can see practices, socials, and fundraisers —
 * transparency on what the club actually does, not just its marketing pitch.
 * Tournaments stay member-area-only (see /tournaments); RSVPing still
 * requires signing in.
 */
async function PublicEventsView({ user }: { user: SessionUser | null }) {
  const now = new Date();

  const events = await db()
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.published, true),
        inArray(schema.events.type, ["practice", "social", "fundraiser"]),
        gte(schema.events.startsAt, now),
      ),
    )
    .orderBy(asc(schema.events.startsAt));

  return (
    <>
      <Header user={user} />
      <main className="flex-1 pt-28 sm:pt-32">
        <div className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
          <Agenda
            events={events}
            rsvpByEvent={new Map()}
            heading="Upcoming events"
            subhead={
              <p className="mt-3 text-sm text-ink/60">
                Practices, Socials, and Fundraising Events{" "}
                <Link href="/login" className="font-semibold text-navy-800 underline underline-offset-2">
                  Sign in
                </Link>{" "}
                to RSVP.
              </p>
            }
          />
        </div>
      </main>
      <Footer />
    </>
  );
}

export default async function EventsPage() {
  const user = await getSessionUser();
  if (user && isActiveMember(user)) return <MemberEventsView user={user} />;
  return <PublicEventsView user={user} />;
}
