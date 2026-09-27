import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { requireExec } from "@/lib/session";
import { db, schema } from "@/db";
import { PendingList } from "./pending-list";
import { RosterImport } from "./roster-import";
import { skillLabel } from "@/lib/derive-level";
import { strikeCounts } from "@/lib/rsvp";
import { strikeState } from "@/lib/strikes";
import { attendanceCopy } from "@/lib/content";
import { StrikeBadge } from "@/components/site/strike-badge";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  await requireExec();

  const pending = await db()
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, createdAt: schema.users.createdAt })
    .from(schema.users)
    .where(eq(schema.users.status, "pending"))
    .orderBy(asc(schema.users.createdAt));

  const roster = await db()
    .select()
    .from(schema.users)
    .where(eq(schema.users.status, "approved"))
    .orderBy(asc(schema.users.name));

  const [listStats] = await db()
    .select({
      total: sql<number>`count(*)::int`,
      comp: sql<number>`count(*) filter (where ${schema.rosterEmails.competitive})::int`,
    })
    .from(schema.rosterEmails);

  const compCount = roster.filter((m) => m.onCompetitiveTeam).length;

  // Exec-only. Never queried by any member-facing page.
  const strikes = await strikeCounts(roster.map((m) => m.id));
  const flagged = roster.filter((m) => strikeState(strikes.get(m.id) ?? 0) === "flagged");

  return (
    <div className="space-y-12">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase text-navy-900">Members</h1>
      </div>

      <section>
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink/50">
          Pending approval
        </h2>
        <div className="mt-4">
          <PendingList users={pending} />
        </div>
      </section>

      <section>
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink/50">
          Add to roster
        </h2>
        <p className="mt-1 text-xs text-ink/45">
          {listStats?.total ?? 0} emails on the roster list · {listStats?.comp ?? 0} marked Competitive Team
        </p>
        <div className="mt-4">
          <RosterImport />
        </div>
      </section>

      {flagged.length > 0 && (
        <section className="border-2 border-red-700 bg-red-50 p-5">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-red-800">
            At the strike limit ({flagged.length})
          </h2>
          <p className="mt-1 text-xs text-red-900/70">{attendanceCopy.policy}</p>
          <ul className="mt-4 space-y-2">
            {flagged.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 text-sm">
                <Link href={`/exec/members/${m.id}`} className="font-semibold text-navy-900 hover:underline">
                  {m.name ?? m.email}
                </Link>
                <StrikeBadge strikes={strikes.get(m.id) ?? 0} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink/50">
          Approved members ({roster.length}) · {compCount} Competitive Team
        </h2>
        <div className="mt-4 overflow-x-auto border-2 border-navy-900/10 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b-2 border-navy-900/10 text-xs font-bold uppercase tracking-wide text-ink/50">
              <tr>
                <th className="p-4">Name</th>
                <th className="p-4">Role</th>
                <th className="p-4">Level</th>
                <th className="p-4">{attendanceCopy.strikes}</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((m) => (
                <tr
                  key={m.id}
                  className={
                    strikeState(strikes.get(m.id) ?? 0) === "flagged"
                      ? "border-b border-navy-900/5 bg-red-50 last:border-0"
                      : "border-b border-navy-900/5 last:border-0"
                  }
                >
                  <td className="p-4">
                    <Link href={`/exec/members/${m.id}`} className="font-semibold text-navy-900 hover:underline">
                      {m.name ?? m.email}
                    </Link>
                    <p className="text-xs text-ink/45">{m.email}</p>
                  </td>
                  <td className="p-4 capitalize text-ink/70">{m.role}</td>
                  <td className="p-4 text-ink/70">
                    {m.onCompetitiveTeam ? (
                      <span className="bg-navy-900 px-2 py-0.5 text-xs font-bold uppercase text-gold-500">Comp</span>
                    ) : (
                      skillLabel(m)
                    )}
                  </td>
                  <td className="p-4">
                    <StrikeBadge strikes={strikes.get(m.id) ?? 0} showClear />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
