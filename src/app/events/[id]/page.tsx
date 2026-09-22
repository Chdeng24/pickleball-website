import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { CalendarDays, MapPin } from "lucide-react";
import { db, schema } from "@/db";
import { getSessionUser } from "@/lib/session";
import { isActiveMember } from "@/lib/access";
import { formatEventWhen } from "@/lib/dates";
import { checkRsvpWindow } from "@/lib/rsvp-logic";
import { listRsvps } from "@/lib/rsvp";
import { Kicker } from "@/components/ui/kicker";
import { MemberShell } from "@/components/site/member-shell";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { RsvpControl } from "./rsvp-control";
import { AttendeeList, type Attendee } from "./attendee-list";

export async function generateMetadata({
  params,
}: PageProps<"/events/[id]">): Promise<Metadata> {
  const { id } = await params;
  const [event] = await db().select({ title: schema.events.title }).from(schema.events).where(eq(schema.events.id, id));
  return { title: event?.title ?? "Event" };
}

export default async function EventDetailPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  const user = await getSessionUser();

  const [event] = await db().select().from(schema.events).where(eq(schema.events.id, id));
  if (!event || !event.published) notFound();

  // One read serves the count, this viewer's own row, and the public list —
  // `listRsvps` already drops cancelled rows and orders confirmed-then-waitlist.
  const rows = await listRsvps(id);
  const pick = (status: "confirmed" | "waitlist"): Attendee[] =>
    rows
      .filter((r) => r.status === status)
      .map((r) => ({ id: r.id, position: r.position, name: r.member.name, email: r.member.email }));

  const confirmed = pick("confirmed");
  const waitlist = pick("waitlist");
  const confirmedCount = confirmed.length;

  const myRsvpRow = user ? rows.find((r) => r.memberId === user.id) : undefined;
  const myRsvp = myRsvpRow
    ? { status: myRsvpRow.status as "confirmed" | "waitlist", position: myRsvpRow.position }
    : null;

  const gate = checkRsvpWindow(event, new Date());
  const windowState = gate.ok ? "open" : gate.reason === "not_open" || gate.reason === "past" ? gate.reason : "not_published";

  const body = (
    <div className="mx-auto max-w-xl">
      <Kicker>{event.type}</Kicker>
      <h1 className="mt-3 font-display text-3xl font-extrabold uppercase text-navy-900 sm:text-4xl">
        {event.title}
      </h1>

      <dl className="mt-6 space-y-3 text-sm text-ink/70">
        <div className="flex items-center gap-2.5">
          <CalendarDays size={17} className="text-gold-500" />
          <dd>{formatEventWhen(event.startsAt, event.endsAt)}</dd>
        </div>
        <div className="flex items-center gap-2.5">
          <MapPin size={17} className="text-gold-500" />
          <dd>{event.location}</dd>
        </div>
      </dl>

      {event.description && (
        <p className="mt-6 leading-relaxed text-ink/70">{event.description}</p>
      )}

      <div className="mt-10">
        <RsvpControl
          eventId={event.id}
          capacity={event.capacity}
          confirmedCount={confirmedCount}
          myRsvp={myRsvp}
          windowState={windowState}
        />
      </div>

      <AttendeeList
        confirmed={confirmed}
        waitlist={waitlist}
        visibility={user ? "full" : "abbreviated"}
      />
    </div>
  );

  if (user && isActiveMember(user)) {
    return <MemberShell user={user}>{body}</MemberShell>;
  }

  return (
    <>
      <Header user={user} />
      <main className="flex-1 pt-28 pb-20 sm:pt-32">{body}</main>
      <Footer />
    </>
  );
}
