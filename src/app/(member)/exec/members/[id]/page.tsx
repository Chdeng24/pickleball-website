import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { requireExec } from "@/lib/session";
import { isAdmin } from "@/lib/access";
import { db, schema } from "@/db";
import { formatEventWhen } from "@/lib/dates";
import { NoteForm } from "./note-form";
import { RoleSelect } from "./role-select";
import { CompetitiveToggle } from "./competitive-toggle";

export const metadata: Metadata = { title: "Member Profile" };

export default async function MemberDetailPage({ params }: PageProps<"/exec/members/[id]">) {
  const viewer = await requireExec();
  const { id } = await params;

  const [member] = await db().select().from(schema.users).where(eq(schema.users.id, id));
  if (!member) notFound();

  // member_notes are exec/admin-only — this page is itself gated by requireExec()
  // above, and the member-facing profile page never queries this table at all.
  const notes = await db()
    .select({ note: schema.memberNotes, author: schema.users })
    .from(schema.memberNotes)
    .leftJoin(schema.users, eq(schema.memberNotes.authorId, schema.users.id))
    .where(eq(schema.memberNotes.memberId, id))
    .orderBy(desc(schema.memberNotes.createdAt));

  const rsvpHistory = await db()
    .select({ rsvp: schema.rsvps, event: schema.events })
    .from(schema.rsvps)
    .innerJoin(schema.events, eq(schema.rsvps.eventId, schema.events.id))
    .where(eq(schema.rsvps.memberId, id))
    .orderBy(desc(schema.events.startsAt))
    .limit(10);

  return (
    <div className="space-y-10">
      <Link
        href="/exec/members"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800 underline underline-offset-2"
      >
        <ArrowLeft size={14} /> Back to members
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold uppercase text-navy-900">
            {member.name ?? member.email}
          </h1>
          <p className="mt-1 text-sm text-ink/50">{member.email}</p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink/50">Role</span>
            {isAdmin(viewer) ? (
              <RoleSelect memberId={member.id} role={member.role} />
            ) : (
              <span className="capitalize font-semibold text-navy-900">{member.role}</span>
            )}
          </div>
          <CompetitiveToggle memberId={member.id} on={member.onCompetitiveTeam} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Status" value={member.status} />
        <Stat label="Derived level" value={member.derivedLevel} />
        <Stat label="On roster" value={member.onRoster ? "Yes" : "No"} />
        <Stat label="Joined" value={member.createdAt.toLocaleDateString("en-US")} />
      </dl>

      <section>
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink/50">
          RSVP history
        </h2>
        {rsvpHistory.length === 0 ? (
          <p className="mt-3 text-sm text-ink/40">No RSVPs yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-navy-900/5 border-2 border-navy-900/10 bg-white">
            {rsvpHistory.map((r) => (
              <li key={r.rsvp.id} className="flex items-center justify-between p-4 text-sm">
                <span className="font-medium text-navy-900">{r.event.title}</span>
                <span className="text-ink/50">{formatEventWhen(r.event.startsAt, r.event.endsAt)}</span>
                <span className="capitalize text-ink/60">{r.rsvp.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink/50">
          Exec notes <span className="normal-case text-ink/35">— never shown to the member</span>
        </h2>
        <div className="mt-4 space-y-4">
          <NoteForm memberId={member.id} />
          <ul className="space-y-3">
            {notes.map(({ note, author }) => (
              <li key={note.id} className="border-2 border-navy-900/10 bg-white p-4">
                <p className="text-sm text-ink/80">{note.body}</p>
                <p className="mt-2 text-xs text-ink/40">
                  {author?.name ?? author?.email ?? "Unknown"} · {note.createdAt.toLocaleDateString("en-US")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-navy-900/10 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/40">{label}</p>
      <p className="mt-1 font-display text-lg font-bold capitalize text-navy-900">{value}</p>
    </div>
  );
}
