import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { requireExec } from "@/lib/session";
import { isAdmin } from "@/lib/access";
import { db, schema } from "@/db";
import { computeStandings } from "@/lib/standings";
import { confirmedPoolMatches } from "@/lib/tournament";
import { spotsTakenByLeague, teamMembers } from "@/lib/league";
import { isRegistrationOpen, teamReadiness, type Readiness } from "@/lib/league-rules";
import { formatDeadline, utcToLaInputValue } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { LeagueForm } from "../league-form";
import {
  DiscardDraftButton,
  EndLeagueButton,
  GenerateDraftButton,
  MoveTeamPoolSelect,
  PairTeamForm,
  PublishDrawButton,
  ResolveDisputeForm,
  WithdrawTeamButton,
} from "./team-actions";

export const metadata: Metadata = { title: "League" };

const READINESS: Record<Readiness, { label: string; className: string }> = {
  ready: { label: "Ready", className: "bg-navy-900 text-gold-500" },
  waiting_on_partner: { label: "Waiting on partner", className: "bg-gold-500/20 text-navy-900" },
  needs_partner: { label: "Needs a partner", className: "bg-red-50 text-red-700" },
};

const INVITE_LABEL = { accepted: "", pending: " (invited)", declined: " (declined)" } as const;

export default async function ExecLeagueDetailPage({ params }: PageProps<"/exec/tournaments/[id]">) {
  const viewer = await requireExec();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [league] = await db().select().from(schema.tournaments).where(eq(schema.tournaments.id, id));
  if (!league) notFound();

  const allTeams = await db().select().from(schema.tmTeams).where(eq(schema.tmTeams.tournamentId, id));
  const members = await teamMembers(allTeams.map((t) => t.id));
  const matches = await db()
    .select()
    .from(schema.matches)
    .where(and(eq(schema.matches.tournamentId, id), eq(schema.matches.stage, "pool")));
  const disputed = await db()
    .select({ report: schema.matchReports, match: schema.matches })
    .from(schema.matchReports)
    .innerJoin(schema.matches, eq(schema.matchReports.matchId, schema.matches.id))
    .where(and(eq(schema.matches.tournamentId, id), eq(schema.matches.status, "disputed")));
  const confirmed = await confirmedPoolMatches(id);
  const taken = (await spotsTakenByLeague([id])).get(id) ?? 0;

  const now = new Date();
  const isRegistration = league.status === "registration";
  const isDraft = league.status === "pools" && !league.poolsAnnouncedAt;
  const isLive = Boolean(league.poolsAnnouncedAt) && league.status !== "complete";
  const isEnded = league.status === "complete";

  const activeTeams = allTeams
    .filter((t) => t.status !== "withdrawn")
    .map((t) => {
      const roster = members.filter((m) => m.teamId === t.id);
      return { ...t, roster, readiness: teamReadiness(roster) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const withdrawn = allTeams.filter((t) => t.status === "withdrawn");

  const teamName = (teamId: string | null) => allTeams.find((t) => t.id === teamId)?.name ?? "—";
  const who = (roster: typeof members) =>
    roster.map((m) => `${m.name ?? m.email}${INVITE_LABEL[m.inviteStatus]}`).join(" & ");

  // Solo registrations with no invite out can be paired by exec.
  const soloTeams = activeTeams.filter(
    (t) => t.roster.filter((m) => m.inviteStatus === "accepted").length === 1 && !t.roster.some((m) => m.inviteStatus === "pending"),
  );
  const pairOptions = (teamId: string) =>
    soloTeams
      .filter((t) => t.id !== teamId)
      .map((t) => {
        const p = t.roster.find((m) => m.inviteStatus === "accepted");
        return { id: t.id, label: p ? `${p.name ?? p.email}` : t.name };
      });

  const pools = [...new Set(activeTeams.map((t) => t.pool).filter((p): p is string => Boolean(p)))].sort();
  const leftOut = activeTeams.filter((t) => !t.pool);
  const readyCount = activeTeams.filter((t) => t.readiness === "ready").length;
  const stillOpenByDate = league.registrationClosesAt && league.registrationClosesAt > now;

  const badge = isEnded
    ? "Ended"
    : isLive
      ? "Live"
      : isDraft
        ? "Draft draw — members can't see it yet"
        : isRegistrationOpen(league, now)
          ? "Registration open"
          : "Registration closed — ready to draw";

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-3xl font-extrabold uppercase text-navy-900">{league.name}</h1>
        <p className="mt-2 text-sm capitalize text-ink/60">
          {league.division} · {league.eligibility === "competitive_only" ? "Competitive Team only" : "Any member"}
          {league.location ? ` · ${league.location}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="bg-navy-900 px-2.5 py-1 font-bold uppercase text-white">{badge}</span>
          <span className="bg-navy-900/5 px-2.5 py-1 font-bold uppercase text-navy-900">
            {taken}
            {league.maxPlayers ? ` / ${league.maxPlayers}` : ""} players
          </span>
          {league.registrationClosesAt && (
            <span className="bg-navy-900/5 px-2.5 py-1 font-bold uppercase text-navy-900">
              Closes {formatDeadline(league.registrationClosesAt)}
            </span>
          )}
          <span className="bg-navy-900/5 px-2.5 py-1 font-bold uppercase text-navy-900">
            Pools of {league.poolSize} · top {league.advancePerPool} move up
          </span>
        </div>
      </div>

      <details className="border-2 border-navy-900/10 bg-white open:pb-6">
        <summary className="cursor-pointer p-5 font-display text-sm font-bold uppercase tracking-wide text-navy-900">
          Settings — name, cap, deadline, location, pools
        </summary>
        <div className="px-5">
          <LeagueForm
            defaults={{
              id: league.id,
              name: league.name,
              division: league.division,
              eligibility: league.eligibility,
              location: league.location,
              maxPlayers: league.maxPlayers,
              poolSize: league.poolSize,
              advancePerPool: league.advancePerPool,
              autoconfirmHours: league.autoconfirmHours,
              registrationClosesAtInput: league.registrationClosesAt ? utcToLaInputValue(league.registrationClosesAt) : "",
            }}
          />
          {league.status === "pools" && (
            <p className="mt-4 text-xs text-ink/50">
              Changing the deadline won&apos;t reopen registration while a draw exists — discard the draft first.
            </p>
          )}
        </div>
      </details>

      {isRegistration && (
        <section className="space-y-5">
          <div>
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink/50">
              Teams ({activeTeams.length}) · {readyCount} ready for the draw
            </h2>
            <p className="mt-1 text-xs text-ink/45">
              Only teams with two confirmed players get drawn. Pair up anyone flagged &quot;Needs a partner&quot;
              before you draw, or they sit out.
            </p>
          </div>

          {activeTeams.length === 0 ? (
            <p className="border-2 border-dashed border-navy-900/15 bg-white p-8 text-center text-sm text-ink/50">
              Nobody has registered yet.
            </p>
          ) : (
            <ul className="divide-y divide-navy-900/5 border-2 border-navy-900/10 bg-white">
              {activeTeams.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-navy-900">
                      {t.name}
                      <span className={cn("ml-2 px-2 py-0.5 text-[11px] font-bold uppercase", READINESS[t.readiness].className)}>
                        {READINESS[t.readiness].label}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink/50">{who(t.roster)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {soloTeams.some((s) => s.id === t.id) && <PairTeamForm teamId={t.id} options={pairOptions(t.id)} />}
                    <WithdrawTeamButton teamId={t.id} live={false} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <GenerateDraftButton
            tournamentId={league.id}
            regenerate={false}
            closesText={stillOpenByDate && league.registrationClosesAt ? formatDeadline(league.registrationClosesAt) : null}
          />
        </section>
      )}

      {(isDraft || isLive || isEnded) && (
        <section>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink/50">
            {isDraft ? "Draft pools — only exec can see these" : "Pools"}
          </h2>

          {pools.length === 0 ? (
            <p className="mt-3 text-sm text-ink/40">No pools.</p>
          ) : (
            <div className="mt-4 space-y-8">
              {pools.map((pool) => {
                const poolTeams = activeTeams.filter((t) => t.pool === pool);
                const poolMatches = matches.filter((m) => m.pool === pool);
                const played = poolMatches.filter((m) => m.status === "confirmed").length;
                const standings = computeStandings(
                  poolTeams.map((t) => t.id),
                  confirmed.filter((m) => m.pool === pool),
                );
                const ordered = isDraft ? poolTeams : standings.map((s) => poolTeams.find((t) => t.id === s.teamId)!).filter(Boolean);

                return (
                  <div key={pool}>
                    <h3 className="font-display text-lg font-extrabold uppercase text-navy-900">
                      Pool {pool}
                      <span className="ml-2 text-xs font-normal normal-case text-ink/40">
                        {poolTeams.length} teams · {isDraft ? `${poolMatches.length} matches` : `${played}/${poolMatches.length} played`}
                      </span>
                    </h3>
                    <ul className="mt-2 divide-y divide-navy-900/5 border-2 border-navy-900/10 bg-white">
                      {ordered.map((t, i) => {
                        const s = standings.find((x) => x.teamId === t.id);
                        const movesUp = !isDraft && i < league.advancePerPool;
                        return (
                          <li
                            key={t.id}
                            className={cn(
                              "flex flex-wrap items-center justify-between gap-3 p-4",
                              !isDraft && i === league.advancePerPool - 1 && "border-b-4 border-b-gold-500",
                            )}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-navy-900">
                                {!isDraft && s ? `${s.rank}. ` : ""}
                                {t.name}
                                {movesUp && (
                                  <span className="ml-2 bg-gold-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-navy-900">
                                    Moves up
                                  </span>
                                )}
                                {!isDraft && s?.tiebreak === "unresolved" && (
                                  <span className="ml-2 bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                                    Tie — exec decides
                                  </span>
                                )}
                              </p>
                              <p className="mt-0.5 text-xs text-ink/50">
                                {who(t.roster.filter((m) => m.inviteStatus === "accepted"))}
                                {!isDraft && s ? ` · ${s.wins}-${s.losses} · games ${s.gameDiff >= 0 ? "+" : ""}${s.gameDiff}` : ""}
                              </p>
                            </div>
                            {!isEnded && (
                              <div className="flex items-center gap-3">
                                {isDraft && <MoveTeamPoolSelect teamId={t.id} currentPool={t.pool} pools={pools} />}
                                <WithdrawTeamButton teamId={t.id} live={isLive} />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {isDraft && leftOut.length > 0 && (
            <div className="mt-8">
              <h3 className="font-display text-sm font-bold uppercase tracking-wide text-red-700">
                Not in the draw ({leftOut.length})
              </h3>
              <p className="mt-1 text-xs text-ink/50">
                Pair solo players, then drop the new team into a pool — or they sit out once you publish.
              </p>
              <ul className="mt-2 divide-y divide-navy-900/5 border-2 border-red-200 bg-white">
                {leftOut.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-sm font-semibold text-navy-900">
                        {t.name}
                        <span className={cn("ml-2 px-2 py-0.5 text-[11px] font-bold uppercase", READINESS[t.readiness].className)}>
                          {READINESS[t.readiness].label}
                        </span>
                      </p>
                      <p className="text-xs text-ink/50">{who(t.roster)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {t.readiness === "ready" && <MoveTeamPoolSelect teamId={t.id} currentPool={null} pools={pools} />}
                      {soloTeams.some((s) => s.id === t.id) && <PairTeamForm teamId={t.id} options={pairOptions(t.id)} />}
                      <WithdrawTeamButton teamId={t.id} live={false} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isDraft && (
            <div className="mt-6 flex flex-wrap items-start gap-3">
              <GenerateDraftButton tournamentId={league.id} regenerate closesText={null} />
              <PublishDrawButton tournamentId={league.id} leftOut={leftOut.length} />
              <DiscardDraftButton tournamentId={league.id} />
            </div>
          )}
        </section>
      )}

      {isAdmin(viewer) && disputed.length > 0 && (
        <section>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-red-600">
            Disputed scores ({disputed.length})
          </h2>
          <ul className="mt-3 space-y-3">
            {disputed.map(({ report, match }) => (
              <li key={report.id} className="border-2 border-red-300 bg-red-50 p-4">
                <p className="text-sm text-navy-900">
                  {teamName(match.teamAId)} vs {teamName(match.teamBId)} — reported{" "}
                  {report.games.map(([a, b]) => `${a}-${b}`).join(", ")}, winner claimed: {teamName(report.winnerTeamId)}
                </p>
                <p className="mt-1 text-xs text-red-700">Dispute reason: {report.disputeReason}</p>
                {match.teamAId && match.teamBId && (
                  <div className="mt-3">
                    <ResolveDisputeForm
                      reportId={report.id}
                      teamAId={match.teamAId}
                      teamAName={teamName(match.teamAId)}
                      teamBId={match.teamBId}
                      teamBName={teamName(match.teamBId)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isAdmin(viewer) && disputed.length > 0 && (
        <p className="text-sm text-red-700">
          {disputed.length} disputed score{disputed.length === 1 ? "" : "s"} waiting on an admin.
        </p>
      )}

      {withdrawn.length > 0 && (
        <p className="text-xs text-ink/40">
          Withdrawn: {withdrawn.map((t) => t.name).join(", ")}
        </p>
      )}

      {isLive && (
        <div className="border-t-2 border-navy-900/10 pt-6">
          <EndLeagueButton tournamentId={league.id} />
        </div>
      )}

      {isEnded && <p className="text-sm text-ink/50">This league has ended — it no longer shows on members&apos; Tournaments tab.</p>}
    </div>
  );
}
