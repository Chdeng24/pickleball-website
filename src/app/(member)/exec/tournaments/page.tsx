import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { requireExec } from "@/lib/session";
import { db, schema } from "@/db";
import { CreateTournamentForm } from "./create-form";

export const metadata: Metadata = { title: "Manage Tournaments" };

export default async function ExecTournamentsPage() {
  await requireExec();

  const tournaments = await db().select().from(schema.tournaments).orderBy(desc(schema.tournaments.createdAt));

  return (
    <div className="space-y-12">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase text-navy-900">
          Manage tournaments
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          One-day club tournaments are just events — create those from{" "}
          <Link href="/exec/events" className="underline">
            Manage events
          </Link>
          . This page is for the Pickleball League — Beginner, Advanced, and
          Competitive-only divisions all live here.
        </p>
      </div>

      <details className="border-2 border-navy-900/10 bg-white open:pb-6">
        <summary className="cursor-pointer p-5 font-display text-sm font-bold uppercase tracking-wide text-navy-900">
          + New Pickleball League division
        </summary>
        <div className="px-5">
          <CreateTournamentForm />
        </div>
      </details>

      {tournaments.length === 0 ? (
        <div className="border-2 border-dashed border-navy-900/15 bg-white p-8 text-center text-sm text-ink/50">
          No tournaments yet.
        </div>
      ) : (
        <ul className="divide-y divide-navy-900/5 border-2 border-navy-900/10 bg-white">
          {tournaments.map((t) => (
            <li key={t.id}>
              <Link
                href={`/exec/tournaments/${t.id}`}
                className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-chalk"
              >
                <div>
                  <p className="font-display text-base font-bold uppercase text-navy-900">{t.name}</p>
                  <p className="mt-1 text-sm capitalize text-ink/60">
                    {t.division} · {t.eligibility === "competitive_only" ? "Competitive Team only" : "All members"}
                  </p>
                </div>
                <span className="shrink-0 bg-navy-900/5 px-2.5 py-1 text-xs font-bold uppercase text-navy-900">
                  {t.status}
                  {t.poolsAnnouncedAt ? " · live" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
