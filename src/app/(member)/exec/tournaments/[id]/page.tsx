import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireExec } from "@/lib/session";
import { isAdmin } from "@/lib/access";
import { db, schema } from "@/db";
import { spotsTakenByLeague, teamMembers } from "@/lib/league";
import { loadLeagueView, type ViewMatch } from "@/lib/league-view";
import { isRegistrationOpen, teamReadiness, type Readiness } from "@/lib/league-rules";
import { formatDeadline, utcToLaInputValue } from "@/lib/dates";
import { OVERDUE_GRACE_MS, playoffRounds, recommendedPlayoffTeams, scheduleBy, weekOf, weekRange } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { Bracket, StandingsTable, WeekSchedule } from "@/components/site/league-tables";
import { LeagueForm } from "../league-form";
import {
  AddTeamForm,
  DiscardDraftButton,
  EndLeagueButton,
  FillSlotForm,
  GenerateDraftButton,
  MakePlayoffsButton,
  MatchOverride,
  PairTeamForm,
  PublishDrawButton,
  RandomPairButton,
  ResendSchedulesButton,
  ResolveDisputeForm,
  ScrapPlayoffsButton,
  SwapSelect,
  WithdrawTeamButton,
} from "./team-actions";

export const metadata: Metadata = { title: "League" };

const READINESS: Record<Readiness, { label: string; className: string }> = {
  ready: { label: "Ready", className: "bg-navy-900 text-gold-500" },
  waiting_on_partner: { label: "Waiting on partner", className: "bg-gold-500/20 text-navy-900" },
  needs_partner: { label: "Needs a partner", className: "bg-red-50 text-red-700" },
};

const INVITE_LABEL = { accepted: "", pending: " (invited)", declined: " (declined)" } as const;

function Heading({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "alert" }) {
  return (
    <h2 className={cn("font-display text-sm font-bold uppercase tracking-wide", tone === "alert" ? "text-red-700" : "text-ink/50")}>
      {children}
    </h2>
  );
}

export default async function ExecLeagueDetailPage({ params }: PageProps<"/exec/tournaments/[id]">) {
  const viewer = await requireExec();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [league] = await db().select().from(schema.tournaments).where(eq(schema.tournaments.id, id));
  if (!league) notFound();

  const view = await loadLeagueView(league);
  const members = await teamMembers(view.teams.map((t) => t.id));
  const taken = (await spotsTakenByLeague([id])).get(id) ?? 0;

  const now = new Date();
  const isRegistration = league.status === "registration";
  const isDraft = league.status === "pools" && !league.poolsAnnouncedAt;
  const isLive = Boolean(league.poolsAnnouncedAt) && league.status !== "complete";
  const isKnockout = league.status === "knockout";
  const isEnded = league.status === "complete";
  const season = view.season;

  const activeTeams = view.teams
    .filter((t) => t.status !== "withdrawn" && !t.isPlaceholder)
    .map((t) => {
      const roster = members.filter((m) => m.teamId === t.id);
      return { ...t, roster, readiness: teamReadiness(roster) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const withdrawn = view.teams.filter((t) => t.status === "withdrawn" && !t.isPlaceholder);
  const openSlots = view.teams.filter((t) => t.isPlaceholder && t.status !== "withdrawn");

  const who = (roster: typeof members) => roster.map((m) => `${m.name ?? m.email}${INVITE_LABEL[m.inviteStatus]}`).join(" & ");

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

  const scheduled = activeTeams.filter((t) => t.pool);
  const unscheduled = activeTeams.filter((t) => !t.pool);
  const unscheduledReady = unscheduled.filter((t) => t.readiness === "ready");
  // Exec can also hand-place a one-player team (someone playing solo by choice).
  const placeable = unscheduled
    .filter((t) => t.readiness !== "waiting_on_partner")
    .map((t) => ({ id: t.id, label: t.readiness === "ready" ? t.name : `${t.name} (solo — plays alone)` }));
  const readyCount = activeTeams.filter((t) => t.readiness === "ready").length;
  const stillOpenByDate = league.registrationClosesAt && league.registrationClosesAt > now;

  const currentWeek = season ? weekOf(season.seasonStartsOn, now) : 0;
  const disputed = view.matches.filter((m) => m.status === "disputed");
  const needsAttention = view.matches.filter(
    (m) =>
      !view.isBye(m) &&
      m.teamAId &&
      m.teamBId &&
      m.status === "pending" &&
      m.dueBy &&
      now.getTime() > m.dueBy.getTime() + (m.stage === "knockout" ? 0 : OVERDUE_GRACE_MS),
  );

  // Past Wednesday's cut-off with no time posted — exec's call whether that's a strike.
  const noTime = view.matches.filter(
    (m) => !view.isBye(m) && m.teamAId && m.teamBId && m.status === "pending" && !m.scheduledAt && m.dueBy && now > scheduleBy(m.dueBy) && now <= m.dueBy,
  );

  let playoffPlan: string | null = null;
  if (season) {
    try {
      playoffPlan = playoffRounds(season)
        .map((r) => `${r.name} by ${formatDeadline(r.dueBy)}`)
        .join(" → ");
    } catch (e) {
      playoffPlan = e instanceof Error ? `⚠ ${e.message}` : null;
    }
  }
  const suggested = season ? recommendedPlayoffTeams(scheduled.length || readyCount, season) : null;

  const badge = isEnded
    ? "Ended"
    : isKnockout
      ? "Playoffs"
      : isLive
        ? currentWeek >= 1
          ? `Live — week ${currentWeek}`
          : "Live — starts soon"
        : isDraft
          ? "Draft schedule — members can't see it yet"
          : isRegistrationOpen(league, now)
            ? "Registration open"
            : "Registration closed — ready to draw";

  const override = (m: ViewMatch) =>
    isLive ? (
      <MatchOverride
        matchId={m.id}
        teamAName={view.name(m.teamAId)}
        teamBName={view.name(m.teamBId)}
        knockout={m.stage === "knockout"}
        pending={m.status === "pending"}
      />
    ) : null;

  const swapOptions = (teamId: string) => [
    ...scheduled.filter((t) => t.id !== teamId).map((t) => ({ id: t.id, label: t.name })),
    ...openSlots.map((t) => ({ id: t.id, label: `${t.name} (empty)` })),
    ...placeable.map((t) => ({ id: t.id, label: `${t.label} (not scheduled — replaces)` })),
  ];
  const bracketTeams = view.knockout.length
    ? [...new Set(view.knockout.filter((m) => m.round === 1).flatMap((m) => [m.teamAId, m.teamBId]))].filter((x): x is string => Boolean(x))
    : [];
  const bracketStarted = view.knockout.some((m) => m.status !== "pending");

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
          {league.registrationClosesAt && isRegistration && (
            <span className="bg-navy-900/5 px-2.5 py-1 font-bold uppercase text-navy-900">Closes {formatDeadline(league.registrationClosesAt)}</span>
          )}
          {season && (
            <span className="bg-navy-900/5 px-2.5 py-1 font-bold uppercase text-navy-900">
              Week 1: {weekRange(season.seasonStartsOn, 1)} · {season.roundRobinWeeks} weeks + {season.catchupWeeks} catch-up · Top{" "}
              {season.playoffTeams} playoffs
            </span>
          )}
        </div>
        {playoffPlan && <p className="mt-2 text-xs text-ink/55">Playoffs: {playoffPlan}</p>}
        {suggested && suggested !== league.playoffTeams && !isKnockout && !isEnded && (
          <p className="mt-1 text-xs text-ink/55">
            Suggested playoff size for {scheduled.length || readyCount} teams: top {suggested} (about a third of the league, fits before the final).
            Change it in Settings.
          </p>
        )}
      </div>

      <details className="border-2 border-navy-900/10 bg-white open:pb-6">
        <summary className="cursor-pointer p-5 font-display text-sm font-bold uppercase tracking-wide text-navy-900">
          Settings — name, cap, deadline, season dates, playoffs
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
              autoconfirmHours: league.autoconfirmHours,
              registrationClosesAtInput: league.registrationClosesAt ? utcToLaInputValue(league.registrationClosesAt) : "",
              seasonStartsOn: league.seasonStartsOn,
              roundRobinWeeks: league.roundRobinWeeks,
              catchupWeeks: league.catchupWeeks,
              playoffTeams: league.playoffTeams,
              finalOn: league.finalOn,
            }}
          />
        </div>
      </details>

      {/* ── Registration: pair free agents, then draw ── */}
      {isRegistration && (
        <section className="space-y-5">
          <div>
            <Heading>
              Teams ({activeTeams.length}) · {readyCount} ready for the draw
            </Heading>
            <p className="mt-1 text-xs text-ink/45">
              Step 1: after registration closes, randomly pair the free agents. Step 2: generate the draft schedule. Step 3: check it, swap
              anything you want, publish.
            </p>
          </div>

          {soloTeams.length > 1 && (
            <div>
              {stillOpenByDate ? (
                <p className="text-xs text-ink/50">
                  {soloTeams.length} free agents. Random pairing unlocks when registration closes ({formatDeadline(league.registrationClosesAt!)}).
                </p>
              ) : (
                <RandomPairButton tournamentId={league.id} count={soloTeams.length} />
              )}
            </div>
          )}

          {activeTeams.length === 0 ? (
            <p className="border-2 border-dashed border-navy-900/15 bg-white p-8 text-center text-sm text-ink/50">Nobody has registered yet.</p>
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
                    <WithdrawTeamButton teamId={t.id} scheduled={false} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {season ? (
            <GenerateDraftButton
              tournamentId={league.id}
              regenerate={false}
              teamCount={readyCount}
              closesText={stillOpenByDate && league.registrationClosesAt ? formatDeadline(league.registrationClosesAt) : null}
            />
          ) : (
            <p className="text-sm text-red-700">Set the season dates in Settings before drawing.</p>
          )}
        </section>
      )}

      {/* ── Needs attention (live) ── */}
      {isLive && noTime.length > 0 && (
        <section className="space-y-2">
          <Heading tone="alert">Missed Wednesday&apos;s cut-off — no match time posted ({noTime.length})</Heading>
          <p className="text-xs text-ink/45">Both teams were emailed Thursday morning. These still have until Sunday 11:59 PM to play and report.</p>
          <ul className="divide-y divide-red-100 border-2 border-red-200 bg-white">
            {noTime.map((m) => (
              <li key={m.id} className="p-3 text-sm text-navy-900">
                <span className="text-xs font-bold uppercase text-ink/45">{view.label(m)}</span> · {view.name(m.teamAId)} vs {view.name(m.teamBId)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {isLive && (needsAttention.length > 0 || disputed.length > 0) && (
        <section className="space-y-3">
          <Heading tone="alert">Needs attention ({needsAttention.length + disputed.length})</Heading>
          {needsAttention.length > 0 && (
            <ul className="divide-y divide-red-100 border-2 border-red-200 bg-white">
              {needsAttention.map((m) => (
                <li key={m.id} className="p-3 text-sm">
                  <p className="text-navy-900">
                    <span className="text-xs font-bold uppercase text-ink/45">{view.label(m)}</span> · {view.name(m.teamAId)} vs{" "}
                    {view.name(m.teamBId)} — past due, not reported
                    {m.stage === "knockout" ? " (playoff: pick a winner)" : ""}
                  </p>
                  <div className="mt-2">{override(m)}</div>
                </li>
              ))}
            </ul>
          )}
          {disputed.length > 0 && (
            <ul className="space-y-3">
              {disputed.map((m) => {
                const report = view.reportByMatch.get(m.id);
                if (!report) return null;
                return (
                  <li key={m.id} className="border-2 border-red-300 bg-red-50 p-4">
                    <p className="text-sm text-navy-900">
                      {view.name(m.teamAId)} vs {view.name(m.teamBId)} — reported {report.games.map(([a, b]) => `${a}-${b}`).join(", ")}, winner
                      claimed: {view.name(report.winnerTeamId)}
                    </p>
                    <p className="mt-1 text-xs text-red-700">Dispute reason: {report.disputeReason}</p>
                    {isAdmin(viewer) && m.teamAId && m.teamBId ? (
                      <div className="mt-3">
                        <ResolveDisputeForm
                          reportId={report.id}
                          teamAId={m.teamAId}
                          teamAName={view.name(m.teamAId)}
                          teamBId={m.teamBId}
                          teamBName={view.name(m.teamBId)}
                        />
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-ink/55">Waiting on an admin.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* ── Playoffs ── */}
      {isLive && (
        <section className="space-y-4">
          <Heading>Playoffs</Heading>
          {view.knockout.length > 0 ? (
            <>
              <Bracket view={view} actions={override} />
              {!bracketStarted && (
                <div className="flex flex-wrap items-start gap-4">
                  <div className="space-y-2">
                    <p className="text-xs text-ink/50">Swap a team in the bracket (e.g. you broke a tie differently):</p>
                    <div className="flex flex-wrap gap-2">
                      {bracketTeams.map((tid) => (
                        <SwapSelect
                          key={tid}
                          teamId={tid}
                          label={`Swap ${view.name(tid)}…`}
                          options={scheduled.filter((t) => t.id !== tid).map((t) => ({ id: t.id, label: t.name }))}
                        />
                      ))}
                    </div>
                  </div>
                  <MakePlayoffsButton tournamentId={league.id} size={league.playoffTeams} regenerate />
                  <ScrapPlayoffsButton tournamentId={league.id} />
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-ink/55">
                When the round robin and catch-up week are done (every match settled), seed the top {league.playoffTeams} into the bracket.
              </p>
              <MakePlayoffsButton tournamentId={league.id} size={league.playoffTeams} regenerate={false} />
            </div>
          )}
        </section>
      )}

      {/* ── Standings + schedule (draft and live) ── */}
      {(isDraft || isLive || isEnded) && (
        <section className="space-y-6">
          {!isDraft && (
            <div>
              <Heading>Standings</Heading>
              <div className="mt-3">
                <StandingsTable view={view} playoffTeams={league.playoffTeams} />
              </div>
            </div>
          )}

          <div>
            <Heading>{isDraft ? "Draft schedule — only exec can see this" : "Schedule"}</Heading>
            {isLive && <p className="mt-1 text-xs text-ink/45">Use &quot;Edit result&quot; on any match to enter a score, award a forfeit, reopen it, or give it another week.</p>}
            <div className="mt-3 space-y-4">
              {view.weeks.map((w) =>
                isLive && w !== currentWeek ? (
                  <details key={w} open={w === currentWeek - 1}>
                    <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-navy-800">
                      Week {w}
                      {season ? ` · ${weekRange(season.seasonStartsOn, w)}` : ""}
                      {w < currentWeek ? ` · ${view.pool.filter((m) => m.round === w && (m.status === "confirmed" || m.status === "forfeited")).length} settled` : ""}
                    </summary>
                    <div className="mt-2">
                      <WeekSchedule view={view} week={w} actions={override} />
                    </div>
                  </details>
                ) : (
                  <WeekSchedule key={w} view={view} week={w} actions={isLive ? override : undefined} />
                ),
              )}
            </div>
          </div>

          {!isEnded && (scheduled.length > 0 || openSlots.length > 0) && (
            <div>
              <Heading>Teams on the schedule ({scheduled.length})</Heading>
              {isDraft && <p className="mt-1 text-xs text-ink/45">Swap trades two teams&apos; entire schedules — nothing else moves.</p>}
              <ul className="mt-3 divide-y divide-navy-900/5 border-2 border-navy-900/10 bg-white">
                {openSlots.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 bg-gold-500/10 p-4">
                    <div>
                      <p className="text-sm font-semibold text-navy-900">{t.name}</p>
                      <p className="text-xs text-ink/55">Empty — opponents have a bye. A late team can take it over from this week on.</p>
                    </div>
                    <FillSlotForm placeholderId={t.id} options={placeable} />
                  </li>
                ))}
                {scheduled.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-navy-900">{t.name}</p>
                      <p className="mt-0.5 text-xs text-ink/50">{who(t.roster.filter((m) => m.inviteStatus === "accepted"))}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {isDraft && <SwapSelect teamId={t.id} options={swapOptions(t.id)} />}
                      <WithdrawTeamButton teamId={t.id} scheduled />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!isEnded && unscheduled.length > 0 && (
            <div>
              <Heading tone="alert">Not on the schedule ({unscheduled.length})</Heading>
              <p className="mt-1 text-xs text-ink/50">
                {openSlots.length > 0
                  ? "Give a complete team an open slot above. Solo players: pair them first."
                  : "No open slots. A late team can only join where there's an open slot — a withdrawal creates one."}
              </p>
              <ul className="mt-2 divide-y divide-navy-900/5 border-2 border-red-200 bg-white">
                {unscheduled.map((t) => (
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
                      {isDraft && t.readiness !== "waiting_on_partner" && <SwapSelect teamId={t.id} label="Replace…" options={scheduled.map((s) => ({ id: s.id, label: s.name }))} />}
                      {isDraft && soloTeams.some((s) => s.id === t.id) && <PairTeamForm teamId={t.id} options={pairOptions(t.id)} />}
                      <WithdrawTeamButton teamId={t.id} scheduled={false} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isDraft && (
            <div className="flex flex-wrap items-start gap-6 border-t-2 border-navy-900/10 pt-6">
              <PublishDrawButton tournamentId={league.id} leftOut={unscheduled.length} />
              <GenerateDraftButton tournamentId={league.id} regenerate teamCount={scheduled.length + unscheduledReady.length} closesText={null} />
              <DiscardDraftButton tournamentId={league.id} />
            </div>
          )}
        </section>
      )}

      {!isEnded && (
        <section className="space-y-2">
          <Heading>Add a team directly</Heading>
          <p className="text-xs text-ink/45">
            For a late sign-up or a re-pair. Both players must have signed in to the site once and not be on another team. They&apos;re
            confirmed immediately{isRegistration ? "" : ", then show under “Not on the schedule” until you give them an open slot"}.
          </p>
          <AddTeamForm tournamentId={league.id} />
        </section>
      )}

      {withdrawn.length > 0 && <p className="text-xs text-ink/40">Withdrawn: {withdrawn.map((t) => t.name).join(", ")}</p>}

      {isLive && (
        <div className="flex flex-wrap items-start gap-4 border-t-2 border-navy-900/10 pt-6">
          <ResendSchedulesButton
            tournamentId={league.id}
            players={scheduled.reduce((n, t) => n + t.roster.filter((m) => m.inviteStatus === "accepted").length, 0)}
          />
          <EndLeagueButton tournamentId={league.id} />
        </div>
      )}

      {isEnded && <p className="text-sm text-ink/50">This league has ended — it no longer shows on members&apos; Tournaments tab.</p>}
    </div>
  );
}
