import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { requireExec } from "@/lib/session";
import { isAdmin } from "@/lib/access";
import { db, schema } from "@/db";
import { computeStandings } from "@/lib/standings";
import { confirmedPoolMatches } from "@/lib/tournament";
import {
  MoveTeamPoolSelect,
  WithdrawTeamButton,
  GenerateDraftButton,
  PublishDrawButton,
  ResolveDisputeForm,
} from "./team-actions";

export const metadata: Metadata = { title: "Tournament" };

export default async function ExecTournamentDetailPage({ params }: PageProps<"/exec/tournaments/[id]">) {
  const viewer = await requireExec();
  const { id } = await params;

  const [tournament] = await db().select().from(schema.tournaments).where(eq(schema.tournaments.id, id));
  if (!tournament) notFound();

  const teams = await db().query.tmTeams.findMany({
    where: eq(schema.tmTeams.tournamentId, id),
    with: { members: { with: { member: true } } },
  });

  const matches = await db()
    .select()
    .from(schema.matches)
    .where(and(eq(schema.matches.tournamentId, id), eq(schema.matches.stage, "pool")));

  const disputedReports = await db()
    .select({ report: schema.matchReports, match: schema.matches })
    .from(schema.matchReports)
    .innerJoin(schema.matches, eq(schema.matchReports.matchId, schema.matches.id))
    .where(and(eq(schema.matches.tournamentId, id), eq(schema.matches.status, "disputed")));

  const teamName = (teamId: string | null) => teams.find((t) => t.id === teamId)?.name ?? "—";
  const confirmedMatches = await confirmedPoolMatches(id);

  const pools = [...new Set(teams.map((t) => t.pool).filter((p): p is string => Boolean(p)))].sort();
  const isDraft = tournament.status === "pools" && !tournament.poolsAnnouncedAt;
  const isLive = Boolean(tournament.poolsAnnouncedAt);

  const registeredTeams = teams.filter((t) => t.status === "registered" && !t.pool && tournament.status === "registration");

  return (
    <div className="space-y-10">
      <Link
        href="/exec/tournaments"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-800 underline underline-offset-2"
      >
        <ArrowLeft size={14} /> Back to tournaments
      </Link>

      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase text-navy-900">{tournament.name}</h1>
        <p className="mt-2 text-sm capitalize text-ink/60">
          {tournament.division} · {tournament.eligibility === "competitive_only" ? "Competitive Team only" : "All members"} ·{" "}
          {tournament.status}
          {isLive ? " · live" : ""}
        </p>
      </div>

      {tournament.status === "registration" && (
        <section>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink/50">
            Registered teams ({registeredTeams.length})
          </h2>
          {registeredTeams.length === 0 ? (
            <p className="mt-3 text-sm text-ink/40">Nobody yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-navy-900/5 border-2 border-navy-900/10 bg-white">
              {registeredTeams.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-semibold text-navy-900">{t.name}</p>
                    <p className="text-xs text-ink/50">
                      {t.members.map((m) => `${m.member.name ?? m.member.email} (${m.inviteStatus})`).join(" & ")}
                    </p>
                  </div>
                  <WithdrawTeamButton teamId={t.id} />
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5">
            <GenerateDraftButton tournamentId={tournament.id} />
          </div>
        </section>
      )}

      {(isDraft || isLive) && (
        <section>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink/50">
            {isDraft ? "Draft pools (not sent yet)" : "Pools"}
          </h2>

          {pools.length === 0 ? (
            <p className="mt-3 text-sm text-ink/40">No draw generated yet.</p>
          ) : (
            <div className="mt-4 space-y-8">
              {pools.map((pool) => {
                const poolTeams = teams.filter((t) => t.pool === pool);
                const poolMatches = matches.filter((m) => m.pool === pool);
                const standings = isLive
                  ? computeStandings(
                      poolTeams.map((t) => t.id),
                      confirmedMatches.filter((m) => m.pool === pool),
                    )
                  : null;

                const playedCount = poolMatches.filter((m) => m.status === "confirmed").length;

                return (
                  <div key={pool}>
                    <h3 className="font-display text-lg font-extrabold uppercase text-navy-900">
                      Pool {pool}
                      {isLive && (
                        <span className="ml-2 text-xs font-normal normal-case text-ink/40">
                          {playedCount}/{poolMatches.length} matches played
                        </span>
                      )}
                    </h3>
                    <ul className="mt-2 divide-y divide-navy-900/5 border-2 border-navy-900/10 bg-white">
                      {poolTeams.map((t) => {
                        const standing = standings?.find((s) => s.teamId === t.id);
                        return (
                          <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                            <div>
                              <p className="text-sm font-semibold text-navy-900">
                                {t.name}
                                {standing && (
                                  <span className="ml-2 text-xs font-normal text-ink/50">
                                    {standing.wins}-{standing.losses} · rank {standing.rank}
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              {isDraft && <MoveTeamPoolSelect teamId={t.id} currentPool={t.pool} />}
                              <WithdrawTeamButton teamId={t.id} />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {isDraft && (
            <div className="mt-6 flex flex-wrap gap-3">
              <GenerateDraftButton tournamentId={tournament.id} />
              <PublishDrawButton tournamentId={tournament.id} />
            </div>
          )}
        </section>
      )}

      {isAdmin(viewer) && disputedReports.length > 0 && (
        <section>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-red-600">
            Disputed scores ({disputedReports.length})
          </h2>
          <ul className="mt-3 space-y-3">
            {disputedReports.map(({ report, match }) => (
              <li key={report.id} className="border-2 border-red-300 bg-red-50 p-4">
                <p className="text-sm text-navy-900">
                  {teamName(match.teamAId)} vs {teamName(match.teamBId)} — reported{" "}
                  {report.games.map(([a, b]) => `${a}-${b}`).join(", ")}, winner claimed:{" "}
                  {teamName(report.winnerTeamId)}
                </p>
                <p className="mt-1 text-xs text-red-700">Dispute reason: {report.disputeReason}</p>
                <div className="mt-3">
                  <ResolveDisputeForm
                    reportId={report.id}
                    teamAId={match.teamAId!}
                    teamAName={teamName(match.teamAId)}
                    teamBId={match.teamBId!}
                    teamBName={teamName(match.teamBId)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
