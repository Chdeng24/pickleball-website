import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { CalendarDays, MapPin } from "lucide-react";
import { db, schema } from "@/db";
import { getSessionUser } from "@/lib/session";
import { formatEventWhen } from "@/lib/dates";
import { checkRsvpWindow } from "@/lib/rsvp-logic";
import { Kicker } from "@/components/ui/kicker";
import { RsvpControl } from "./rsvp-control";

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

  const confirmedCount = await db().$count(
    schema.rsvps,
    and(eq(schema.rsvps.eventId, id), eq(schema.rsvps.status, "confirmed")),
  );

  const myRsvpRow = user
    ? (
        await db()
          .select({ status: schema.rsvps.status, position: schema.rsvps.position })
          .from(schema.rsvps)
          .where(and(eq(schema.rsvps.eventId, id), eq(schema.rsvps.memberId, user.id)))
      )[0]
    : undefined;

  const myRsvp =
    myRsvpRow && myRsvpRow.status !== "cancelled"
      ? { status: myRsvpRow.status as "confirmed" | "waitlist", position: myRsvpRow.position }
      : null;

  const gate = checkRsvpWindow(event, new Date());
  const windowState = gate.ok ? "open" : gate.reason === "not_open" || gate.reason === "past" ? gate.reason : "not_published";

  return (
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
    </div>
  );
}
