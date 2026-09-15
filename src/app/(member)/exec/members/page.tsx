import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { requireExec } from "@/lib/session";
import { db, schema } from "@/db";
import { PendingList } from "./pending-list";

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
          Roster ({roster.length})
        </h2>
        <div className="mt-4 overflow-x-auto border-2 border-navy-900/10 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b-2 border-navy-900/10 text-xs font-bold uppercase tracking-wide text-ink/50">
              <tr>
                <th className="p-4">Name</th>
                <th className="p-4">Role</th>
                <th className="p-4">Level</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((m) => (
                <tr key={m.id} className="border-b border-navy-900/5 last:border-0">
                  <td className="p-4">
                    <Link href={`/exec/members/${m.id}`} className="font-semibold text-navy-900 hover:underline">
                      {m.name ?? m.email}
                    </Link>
                    <p className="text-xs text-ink/45">{m.email}</p>
                  </td>
                  <td className="p-4 capitalize text-ink/70">{m.role}</td>
                  <td className="p-4 capitalize text-ink/70">{m.derivedLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
