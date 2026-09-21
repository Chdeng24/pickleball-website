import type { Metadata } from "next";
import Image from "next/image";
import { desc, eq } from "drizzle-orm";
import { requireMember } from "@/lib/session";
import { db, schema } from "@/db";
import { formatEventWhen } from "@/lib/dates";
import { Kicker } from "@/components/ui/kicker";
import { SignOutButton } from "@/components/site/sign-out-button";
import { DuprForm } from "./dupr-form";
import { skillLabel } from "@/lib/derive-level";

export const metadata: Metadata = { title: "Profile" };

/**
 * The member's own page. Deliberately never touches `member_notes` — those
 * are exec-only observations and must not leak here even by accident. See
 * `/exec/members/[id]` for the exec-facing view that does include them.
 */
export default async function ProfilePage() {
  const user = await requireMember();

  const rsvpHistory = await db()
    .select({ rsvp: schema.rsvps, event: schema.events })
    .from(schema.rsvps)
    .innerJoin(schema.events, eq(schema.rsvps.eventId, schema.events.id))
    .where(eq(schema.rsvps.memberId, user.id))
    .orderBy(desc(schema.events.startsAt))
    .limit(10);

  return (
    <div className="mx-auto max-w-lg space-y-10">
      <div className="flex items-center gap-4">
        {user.image && (
          <Image src={user.image} alt="" width={64} height={64} className="h-16 w-16" />
        )}
        <div>
          <h1 className="font-display text-2xl font-extrabold uppercase text-navy-900">
            {user.name ?? user.email}
          </h1>
          <p className="text-sm text-ink/50">{user.email}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <div className="border-2 border-navy-900/10 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Skill level</p>
          <p className="mt-1 font-display text-lg font-bold text-navy-900">{skillLabel(user)}</p>
          <p className="mt-1 text-xs text-ink/40">
            {user.onCompetitiveTeam
              ? "You're on the Competitive Team."
              : "Set automatically from your most recent practice RSVP."}
          </p>
        </div>
        <div className="border-2 border-navy-900/10 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-ink/40">Role</p>
          <p className="mt-1 font-display text-lg font-bold capitalize text-navy-900">{user.role}</p>
        </div>
      </dl>

      <DuprForm initialUrl={user.duprUrl} />

      <section>
        <Kicker>Your history</Kicker>
        {rsvpHistory.length === 0 ? (
          <p className="mt-4 text-sm text-ink/40">No RSVPs yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-navy-900/5 border-2 border-navy-900/10 bg-white">
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

      <SignOutButton className="text-sm text-ink/50 underline-offset-4 hover:text-ink hover:underline" />
    </div>
  );
}
