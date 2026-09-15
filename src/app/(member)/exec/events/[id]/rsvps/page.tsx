import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireExec } from "@/lib/session";
import { db, schema } from "@/db";
import { listRsvps } from "@/lib/rsvp";

export const metadata: Metadata = { title: "Event RSVPs" };

export default async function EventRsvpsPage({ params }: PageProps<"/exec/events/[id]/rsvps">) {
  await requireExec();
  const { id } = await params;

  const [event] = await db().select().from(schema.events).where(eq(schema.events.id, id));
  if (!event) notFound();

  const rows = await listRsvps(id);
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const waitlist = rows.filter((r) => r.status === "waitlist");

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase text-navy-900">
          {event.title}
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          {confirmed.length}
          {event.capacity !== null ? ` / ${event.capacity}` : ""} confirmed
          {waitlist.length > 0 ? ` · ${waitlist.length} waitlisted` : ""}
        </p>
      </div>

      <RsvpTable title="Confirmed" rows={confirmed} />
      {waitlist.length > 0 && <RsvpTable title="Waitlist" rows={waitlist} />}
    </div>
  );
}

function RsvpTable({
  title,
  rows,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof listRsvps>>;
}) {
  return (
    <div>
      <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink/50">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink/40">Nobody yet.</p>
      ) : (
        <ol className="mt-3 divide-y divide-navy-900/5 border-2 border-navy-900/10 bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 p-4">
              <span className="w-7 shrink-0 text-sm font-bold text-ink/40">{r.position}</span>
              <div>
                <p className="text-sm font-semibold text-navy-900">{r.member.name ?? r.member.email}</p>
                <p className="text-xs text-ink/50">{r.member.email}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
