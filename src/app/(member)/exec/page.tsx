import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { CalendarDays, Users } from "lucide-react";
import { requireExec } from "@/lib/session";
import { db, schema } from "@/db";

export const metadata: Metadata = { title: "Exec" };

export default async function ExecHomePage() {
  await requireExec();

  const pendingCount = await db().$count(schema.users, eq(schema.users.status, "pending"));

  const cards = [
    {
      href: "/exec/events",
      icon: CalendarDays,
      title: "Events",
      body: "Create practices and socials, manage RSVPs.",
    },
    {
      href: "/exec/members",
      icon: Users,
      title: "Members",
      body: pendingCount > 0 ? `${pendingCount} waiting for approval` : "Roster and exec notes",
      badge: pendingCount > 0 ? pendingCount : undefined,
    },
  ];

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl font-extrabold uppercase text-navy-900">Exec</h1>
      <div className="grid gap-5 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="relative border-2 border-navy-900/10 bg-white p-6 transition-colors hover:border-navy-900"
          >
            {c.badge !== undefined && (
              <span className="absolute right-4 top-4 flex h-6 min-w-6 items-center justify-center bg-gold-500 px-1.5 text-xs font-bold text-navy-900">
                {c.badge}
              </span>
            )}
            <c.icon size={24} className="text-navy-800" />
            <h2 className="mt-4 font-display text-lg font-extrabold uppercase text-navy-900">
              {c.title}
            </h2>
            <p className="mt-1 text-sm text-ink/60">{c.body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
