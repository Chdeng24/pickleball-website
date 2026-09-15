import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, and } from "drizzle-orm";
import { requireExec } from "@/lib/session";
import { db, schema } from "@/db";
import { formatEventWhen } from "@/lib/dates";
import { EventForm } from "./event-form";
import { EventRowActions } from "./event-row-actions";

export const metadata: Metadata = { title: "Manage Events" };

export default async function ExecEventsPage() {
  await requireExec();

  const events = await db().select().from(schema.events).orderBy(desc(schema.events.startsAt));

  const counts = await Promise.all(
    events.map((e) =>
      db().$count(schema.rsvps, and(eq(schema.rsvps.eventId, e.id), eq(schema.rsvps.status, "confirmed"))),
    ),
  );

  return (
    <div className="space-y-12">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase text-navy-900">
          Manage events
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          Create practices, socials, and tournaments. Members only see events
          you&apos;ve published.
        </p>
      </div>

      <details className="border-2 border-navy-900/10 bg-white open:pb-6">
        <summary className="cursor-pointer p-5 font-display text-sm font-bold uppercase tracking-wide text-navy-900">
          + New event
        </summary>
        <div className="px-5">
          <EventForm />
        </div>
      </details>

      <div className="overflow-x-auto border-2 border-navy-900/10 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b-2 border-navy-900/10 text-xs font-bold uppercase tracking-wide text-ink/50">
            <tr>
              <th className="p-4">Title</th>
              <th className="p-4">When</th>
              <th className="p-4">RSVPs</th>
              <th className="p-4">Status</th>
              <th className="p-4" />
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-ink/50">
                  No events yet — create one above.
                </td>
              </tr>
            )}
            {events.map((event, i) => (
              <tr key={event.id} className="border-b border-navy-900/5 last:border-0">
                <td className="p-4">
                  <Link
                    href={`/exec/events/${event.id}/edit`}
                    className="font-semibold text-navy-900 hover:underline"
                  >
                    {event.title}
                  </Link>
                  <p className="text-xs uppercase tracking-wide text-ink/40">{event.type}</p>
                </td>
                <td className="p-4 text-ink/70">{formatEventWhen(event.startsAt, event.endsAt)}</td>
                <td className="p-4">
                  <Link href={`/exec/events/${event.id}/rsvps`} className="text-navy-800 hover:underline">
                    {counts[i]}
                    {event.capacity !== null ? ` / ${event.capacity}` : ""}
                  </Link>
                </td>
                <td className="p-4">
                  <span
                    className={
                      event.published
                        ? "bg-green-100 px-2 py-1 text-xs font-bold uppercase text-green-700"
                        : "bg-ink/5 px-2 py-1 text-xs font-bold uppercase text-ink/50"
                    }
                  >
                    {event.published ? "Published" : "Draft"}
                  </span>
                </td>
                <td className="p-4">
                  <EventRowActions id={event.id} published={event.published} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
