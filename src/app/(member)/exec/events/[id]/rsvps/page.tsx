import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { requireExec } from "@/lib/session";
import { db, schema } from "@/db";
import { listRsvps, strikeCounts } from "@/lib/rsvp";
import {
  canRecordAttendance,
  isMarkable,
  tracksAttendance,
  type AttendanceState,
} from "@/lib/strikes";
import { attendanceCopy } from "@/lib/content";
import { formatEventWhen } from "@/lib/dates";
import { StrikeBadge } from "@/components/site/strike-badge";
import {
  AttendanceToggle,
  NotMarkable,
  SessionActions,
} from "./attendance-controls";

export const metadata: Metadata = { title: "Event RSVPs" };

export default async function EventRsvpsPage({
  params,
}: PageProps<"/exec/events/[id]/rsvps">) {
  await requireExec();
  const { id } = await params;

  const [event] = await db()
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, id));
  if (!event) notFound();

  const rows = await listRsvps(id);
  const confirmed = rows.filter((r) => r.status === "confirmed");
  const waitlist = rows.filter((r) => r.status === "waitlist");

  // Exec-only: the strike each attendee is already carrying, so whoever is
  // taking attendance can see they're about to push someone to the limit.
  const strikes = await strikeCounts(rows.map((r) => r.member.id));

  const tracked = tracksAttendance(event);
  const open = canRecordAttendance(event, new Date());
  const present = confirmed.filter((r) => r.attendance === "present").length;
  const noShow = confirmed.filter((r) => r.attendance === "no_show").length;
  const unmarked = confirmed.filter((r) => r.attendance === "unmarked").length;

  return (
    <div className="space-y-10">
      <Link
        href="/exec/events"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800 underline underline-offset-2"
      >
        <ArrowLeft size={14} /> Back to events
      </Link>

      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase text-navy-900">
          {event.title}
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          {formatEventWhen(event.startsAt, event.endsAt)}
        </p>
        <p className="mt-1 text-sm text-ink/60">
          {confirmed.length}
          {event.capacity !== null ? ` / ${event.capacity}` : ""} confirmed
          {waitlist.length > 0 ? ` · ${waitlist.length} waitlisted` : ""}
        </p>
      </div>

      {tracked && (
        <section className="border-2 border-navy-900/10 bg-white p-5">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-navy-900">
            Check-in
          </h2>
          {open ? (
            <>
              <p className="mt-2 text-sm text-ink/60">
                {attendanceCopy.markRemainingHint}
              </p>
              <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <Tally label={attendanceCopy.present} value={present} />
                <Tally label={attendanceCopy.noShow} value={noShow} />
                <Tally label={attendanceCopy.unmarked} value={unmarked} />
              </dl>
              <div className="mt-5">
                <SessionActions
                  eventId={event.id}
                  unmarkedCount={unmarked}
                  disabled={!open}
                />
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink/50">
              {attendanceCopy.notStartedYet}
            </p>
          )}
          <p className="mt-5 border-t border-navy-900/5 pt-4 text-xs leading-relaxed text-ink/45">
            {attendanceCopy.policy}
          </p>
        </section>
      )}

      <RsvpTable
        title="Confirmed"
        rows={confirmed}
        strikes={strikes}
        markable={tracked}
        attendanceOpen={open}
      />
      {waitlist.length > 0 && (
        <RsvpTable
          title="Waitlist"
          rows={waitlist}
          strikes={strikes}
          markable={tracked}
          attendanceOpen={open}
        />
      )}
    </div>
  );
}

function Tally({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-ink/40">
        {label}
      </dt>
      <dd className="font-display text-xl font-bold text-navy-900">{value}</dd>
    </div>
  );
}

function RsvpTable({
  title,
  rows,
  strikes,
  markable,
  attendanceOpen,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof listRsvps>>;
  strikes: Map<string, number>;
  markable: boolean;
  attendanceOpen: boolean;
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
            <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
              <span className="w-7 shrink-0 text-sm font-bold text-ink/40">
                {r.position}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-navy-900">
                  <Link
                    href={`/exec/members/${r.member.id}`}
                    className="hover:underline"
                  >
                    {r.member.name ?? r.member.email}
                  </Link>
                  <StrikeBadge strikes={strikes.get(r.member.id) ?? 0} />
                </p>
                <p className="text-xs text-ink/50">{r.member.email}</p>
              </div>
              {!markable ? null : isMarkable(r) ? (
                <AttendanceToggle
                  rsvpId={r.id}
                  attendance={r.attendance as AttendanceState}
                  disabled={!attendanceOpen}
                />
              ) : (
                <NotMarkable />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
