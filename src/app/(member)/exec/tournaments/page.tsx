import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireExec } from "@/lib/session";
import { db, schema } from "@/db";
import { formatDeadline } from "@/lib/dates";
import { spotsTakenByLeague } from "@/lib/league";
import { LeagueForm } from "./league-form";

export const metadata: Metadata = { title: "Manage Tournaments" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  registration: "Registration open",
  pools: "Draw in progress",
  knockout: "Playoffs",
  complete: "Ended",
};

export default async function ExecTournamentsPage() {
  await requireExec();

  const leagues = await db()
    .select()
    .from(schema.tournaments)
    .where(eq(schema.tournaments.kind, "im_semester"))
    .orderBy(desc(schema.tournaments.createdAt));
  const taken = await spotsTakenByLeague(leagues.map((l) => l.id));

  return (
    <div className="space-y-12">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase text-navy-900">Manage leagues</h1>
        <p className="mt-2 text-sm text-ink/60">
          One-day club tournaments are just events — create those from{" "}
          <Link href="/exec/events" className="underline">
            Manage events
          </Link>
          . This page is for the Pickleball League — Beginner, Advanced, and Competitive divisions all
          live here.
        </p>
      </div>

      <details className="border-2 border-navy-900/10 bg-white open:pb-6">
        <summary className="cursor-pointer p-5 font-display text-sm font-bold uppercase tracking-wide text-navy-900">
          + New league
        </summary>
        <div className="px-5">
          <LeagueForm />
        </div>
      </details>

      {leagues.length === 0 ? (
        <div className="border-2 border-dashed border-navy-900/15 bg-white p-8 text-center text-sm text-ink/50">
          No leagues yet.
        </div>
      ) : (
        <ul className="divide-y divide-navy-900/5 border-2 border-navy-900/10 bg-white">
          {leagues.map((l) => {
            const n = taken.get(l.id) ?? 0;
            const status = l.status === "pools" && l.poolsAnnouncedAt ? "Live" : STATUS_LABEL[l.status];
            return (
              <li key={l.id}>
                <Link
                  href={`/exec/tournaments/${l.id}`}
                  className="flex flex-wrap items-center justify-between gap-4 p-5 transition-colors hover:bg-chalk"
                >
                  <div>
                    <p className="font-display text-base font-bold uppercase text-navy-900">{l.name}</p>
                    <p className="mt-1 text-sm capitalize text-ink/60">
                      {l.division} · {l.eligibility === "competitive_only" ? "Competitive Team only" : "Any member"}
                    </p>
                    <p className="mt-0.5 text-xs text-ink/45">
                      {n}
                      {l.maxPlayers ? ` / ${l.maxPlayers}` : ""} players
                      {l.registrationClosesAt ? ` · closes ${formatDeadline(l.registrationClosesAt)}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 bg-navy-900/5 px-2.5 py-1 text-xs font-bold uppercase text-navy-900">
                    {status}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
