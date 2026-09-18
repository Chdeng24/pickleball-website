import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import { Trophy } from "lucide-react";
import { db, schema } from "@/db";
import { getSessionUser, type SessionUser } from "@/lib/session";
import { isActiveMember } from "@/lib/access";
import { Kicker } from "@/components/ui/kicker";
import { MemberShell } from "@/components/site/member-shell";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { EventsCalendar } from "@/components/site/events-calendar";

export const metadata: Metadata = { title: "Events" };

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
      <div className="space-y-10">
        <div>
          <Kicker>Calendar</Kicker>
          <h1 className="mt-3 font-display text-3xl font-extrabold uppercase text-navy-900 sm:text-4xl">
            Upcoming events
          </h1>
          {tournamentsLink}
        </div>
        <EventsCalendar events={events} rsvpByEvent={rsvpByEvent} />
      </div>
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
          <div className="space-y-10">
            <div>
              <Kicker>Calendar</Kicker>
              <h1 className="mt-3 font-display text-3xl font-extrabold uppercase text-navy-900 sm:text-4xl">
                Upcoming events
              </h1>
              <p className="mt-3 text-sm text-ink/60">
                Practices, Socials, and Fundraising Events{" "}
                <Link href="/login" className="font-semibold text-navy-800 underline underline-offset-2">
                  Sign in
                </Link>{" "}
                to RSVP.
              </p>
            </div>
            <EventsCalendar events={events} />
          </div>
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
