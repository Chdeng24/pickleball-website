import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import { CalendarClock, Check, ClipboardCheck, Clock, MapPin, Trophy, Users } from "lucide-react";
import { Section } from "@/components/site/section";
import { TournamentCards } from "@/components/site/tournament-cards";
import { JoinCta } from "@/components/site/join-cta";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import { MemberShell } from "@/components/site/member-shell";
import { Kicker } from "@/components/ui/kicker";
import { Reveal } from "@/components/ui/reveal";
import { getSessionUser, type SessionUser } from "@/lib/session";
import { isActiveMember } from "@/lib/access";
import { db, schema } from "@/db";
import { formatDeadline, formatEventDay, formatEventWhen, utcToLaInputValue } from "@/lib/dates";
import { membershipsFor, spotsTakenByLeague, teamMembers } from "@/lib/league";
import { loadLeagueView, resultText, type LeagueView } from "@/lib/league-view";
import { FORFEIT_REASON, playoffRounds, regularSeasonEndsAt, scheduleBy, skipDecision, SKIP_LIMIT, weekOf } from "@/lib/schedule";
import { Bracket, StandingsTable, WeekSchedule } from "@/components/site/league-tables";
import {
  isRegistrationOpen,
  leagueCardState,
  partnerOf,
  sortLeagues,
  spotsLeft,
  teamReadiness,
  type MembershipView,
} from "@/lib/league-rules";
import { club, leagueInfo, leagueSteps } from "@/lib/content";
import { cn } from "@/lib/utils";
import { RegisterForm } from "./register-form";
import { InviteButtons } from "./invite-buttons";
import { InvitePartnerForm, LeaveLeagueButton } from "./team-controls";
import { ScoreReportForm, DisputeScoreButton, ConfirmScoreButton, SkipButton, PostTimeForm } from "./score-form";

export const metadata: Metadata = { title: "Tournaments" };

type League = typeof schema.tournaments.$inferSelect;

const STEP_ICONS = { users: Users, trophy: Trophy, calendar: CalendarClock, clipboard: ClipboardCheck } as const;

async function openLeagues(): Promise<League[]> {
  const rows = await db()
    .select()
    .from(schema.tournaments)
    .where(
      and(eq(schema.tournaments.kind, "im_semester"), inArray(schema.tournaments.status, ["registration", "pools", "knockout"])),
    );
  return sortLeagues(rows);
}

function HowItWorks({ tone }: { tone: "member" | "public" }) {
  return (
    <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {leagueSteps.map((step, i) => {
        const Icon = STEP_ICONS[step.icon];
        return (
          <Reveal key={step.title} delay={i * 0.08}>
            <li
              className={cn(
                "flex h-full flex-col border-t-4 border-gold-500 p-7",
                tone === "member" ? "bg-white" : "bg-chalk",
              )}
            >
              <Icon size={26} className="text-navy-800" />
              <span className="kicker mt-6 text-ink/40">Step {i + 1}</span>
              <h3 className="mt-2 font-display text-xl font-extrabold uppercase text-navy-900">{step.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ink/65">{step.body}</p>
            </li>
          </Reveal>
        );
      })}
    </ol>
  );
}

function LeagueMeta({ league, taken, now }: { league: League; taken: number; now: Date }) {
  const open = isRegistrationOpen(league, now);
  const left = spotsLeft(taken, league.maxPlayers);
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/55">
      {league.location && (
        <span className="inline-flex items-center gap-1">
          <MapPin size={12} /> {league.location}
        </span>
      )}
      {open && league.registrationClosesAt && (
        <span className="inline-flex items-center gap-1">
          <Clock size={12} /> Sign up by {formatDeadline(league.registrationClosesAt)}
        </span>
      )}
      {open && left !== null && (
        <span className="inline-flex items-center gap-1 font-semibold text-navy-900">
          <Users size={12} /> {left === 0 ? "Full" : `${left} of ${league.maxPlayers} spots left`}
        </span>
      )}
    </div>
  );
}

/** Tiny spots-left tag for the league jump buttons. */
function SpotsChip({ league, taken, now }: { league: League; taken: number; now: Date }) {
  if (!isRegistrationOpen(league, now)) return <span className="text-ink/45">Closed</span>;
  const left = spotsLeft(taken, league.maxPlayers);
  if (left === null) return <span className="bg-gold-500 px-1.5 py-0.5 text-[10px] text-navy-900">Open</span>;
  return (
    <span className={cn("px-1.5 py-0.5 text-[10px]", left === 0 ? "bg-navy-900/10 text-ink/60" : "bg-gold-500 text-navy-900")}>
      {left === 0 ? "Full" : `${left} left`}
    </span>
  );
}

/** League-wide view of a live season — standings, this week's matchups, the full schedule, and the bracket. Any member can see it. */
function LeagueLive({ league, view, highlight, now }: { league: League; view: LeagueView; highlight?: string; now: Date }) {
  const current = view.season ? weekOf(view.season.seasonStartsOn, now) : 0;
  const thisWeek = view.weeks.includes(current) ? current : null;
  return (
    <div className="space-y-6">
      {view.knockout.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/50">Playoffs</p>
          <Bracket view={view} highlight={highlight} />
        </div>
      )}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink/50">Standings</p>
        <StandingsTable view={view} playoffTeams={league.playoffTeams} highlight={highlight} />
      </div>
      {thisWeek && <WeekSchedule view={view} week={thisWeek} highlight={highlight} />}
      <details>
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-navy-800">Full schedule</summary>
        <div className="mt-3 space-y-4">
          {view.weeks.map((w) => (
            <WeekSchedule key={w} view={view} week={w} highlight={highlight} />
          ))}
        </div>
      </details>
    </div>
  );
}

/** "Week 3 of 7 · Top 8 make playoffs · Final Sat, Dec 12" */
function SeasonLine({ season, now }: { season: NonNullable<LeagueView["season"]>; now: Date }) {
  const week = weekOf(season.seasonStartsOn, now);
  let final: Date | null = null;
  try {
    final = playoffRounds(season).at(-1)?.dueBy ?? null;
  } catch {
    final = null;
  }
  const phase =
    week < 1
      ? "Week 1 starts Sunday"
      : week <= season.roundRobinWeeks
        ? `Week ${week} of ${season.roundRobinWeeks}`
        : week <= season.roundRobinWeeks + season.catchupWeeks
          ? "Catch-up week — makeups only"
          : "Playoffs";
  return (
    <p className="mt-1 text-xs font-semibold text-navy-900">
      {phase} · Top {season.playoffTeams} make playoffs{final ? ` · Final ${formatEventDay(final)}` : ""}
    </p>
  );
}

function SeasonRules() {
  return (
    <div className="space-y-1.5 border-l-4 border-navy-900/15 pl-4 text-xs leading-relaxed text-ink/60">
      <p>{leagueInfo.weekRule}</p>
      <p>
        {leagueInfo.courtBookingNote}{" "}
        <a href={leagueInfo.courtBookingUrl} target="_blank" rel="noreferrer" className="font-semibold text-navy-800 underline">
          Book a court
        </a>
        .
      </p>
      <p>{leagueInfo.scoreRule}</p>
      <p>{leagueInfo.outOfTownRule}</p>
      <p>{leagueInfo.noShowRule}</p>
    </div>
  );
}

/** Everyone holding a spot in a league — members only, names only (no emails). */
async function SignupList({ league, highlight }: { league: League; highlight?: string }) {
  const teams = await db()
    .select({ id: schema.tmTeams.id, name: schema.tmTeams.name })
    .from(schema.tmTeams)
    .where(and(eq(schema.tmTeams.tournamentId, league.id), ne(schema.tmTeams.status, "withdrawn")));
  const roster = await teamMembers(teams.map((t) => t.id));
  const label = (m: { name: string | null; email: string }) => m.name ?? m.email.split("@")[0];

  const rows = teams
    .map((t) => {
      const accepted = roster.filter((m) => m.teamId === t.id && m.inviteStatus === "accepted");
      const pending = roster.filter((m) => m.teamId === t.id && m.inviteStatus === "pending");
      const kind = accepted.length >= 2 ? "team" : pending.length > 0 ? "waiting" : "free_agent";
      return { team: t, accepted, pending, kind } as const;
    })
    .filter((r) => r.accepted.length > 0)
    .sort((a, b) => {
      const order = { team: 0, waiting: 1, free_agent: 2 };
      return order[a.kind] - order[b.kind] || a.team.name.localeCompare(b.team.name);
    });

  const count = (k: string) => rows.filter((r) => r.kind === k).length;
  if (rows.length === 0) return <p className="text-sm text-ink/50">Nobody yet — be the first.</p>;

  return (
    <div>
      <p className="text-xs text-ink/50">
        {count("team")} full team{count("team") === 1 ? "" : "s"} · {count("waiting")} waiting on a partner ·{" "}
        {count("free_agent")} free agent{count("free_agent") === 1 ? "" : "s"}
      </p>
      <ul className="mt-2 border-2 border-navy-900/10 bg-white">
        {rows.map(({ team, accepted, pending, kind }) => (
          <li
            key={team.id}
            className={cn(
              "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-navy-900/5 p-3 text-sm last:border-b-0",
              team.id === highlight && "bg-gold-500/10",
            )}
          >
            <span className="text-navy-900">
              <strong>{accepted.map(label).join(" & ")}</strong>
              {kind === "waiting" && <span className="text-ink/55"> — invited {pending.map(label).join(", ")}</span>}
              {kind === "team" && team.name !== accepted.map(label).join(" & ") && (
                <span className="text-ink/55"> · {team.name}</span>
              )}
            </span>
            <span
              className={cn(
                "shrink-0 px-1.5 py-0.5 text-[10px] font-bold uppercase",
                kind === "team" && "bg-navy-900 text-white",
                kind === "waiting" && "bg-navy-900/10 text-navy-900",
                kind === "free_agent" && "bg-gold-500 text-navy-900",
              )}
            >
              {kind === "team" ? "Team" : kind === "waiting" ? "Invite pending" : "Free agent"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

async function MyTeam({
  league,
  teamId,
  phase,
  user,
  now,
  view,
}: {
  league: League;
  teamId: string;
  phase: "registration" | "drafting" | "live" | "not_drawn";
  user: SessionUser;
  now: Date;
  view: LeagueView | null;
}) {
  const [team] = await db().select().from(schema.tmTeams).where(eq(schema.tmTeams.id, teamId));
  if (!team) return null;
  const roster = await teamMembers([teamId]);
  const partner = partnerOf(roster, user.id);
  const readiness = teamReadiness(roster);
  const partnerLabel = partner ? (partner.name ?? partner.email) : null;

  const partnerLine =
    partner?.inviteStatus === "accepted" ? (
      <span className="inline-flex items-center gap-1.5">
        <Check size={14} className="text-gold-500" /> Partner: <strong>{partnerLabel}</strong>
      </span>
    ) : partner?.inviteStatus === "pending" ? (
      <>Waiting on <strong>{partnerLabel}</strong> to accept your invite.</>
    ) : partner?.inviteStatus === "declined" ? (
      <><strong>{partnerLabel}</strong> declined — invite someone else.</>
    ) : phase === "live" ? (
      <>Playing solo.</>
    ) : (
      <>No partner yet — invite one, or exec will pair you with another solo player before the draw.</>
    );

  const canInvite = phase === "registration" && readiness !== "ready" && isRegistrationOpen(league, now);

  return (
    <div className="mt-4 space-y-4">
      <div className="border-l-4 border-gold-500 bg-chalk p-4">
        <p className="text-sm text-navy-900">
          You&apos;re in as <strong>{team.name}</strong>.
        </p>
        <p className="mt-1 text-sm text-ink/70">{partnerLine}</p>
      </div>

      {canInvite && <InvitePartnerForm teamId={team.id} replacing={partner?.inviteStatus === "pending"} />}

      {phase === "registration" && readiness !== "ready" && !isRegistrationOpen(league, now) && (
        <p className="text-sm text-ink/60">Registration has closed — exec will pair solo players before the draw.</p>
      )}

      {phase === "registration" && <LeaveLeagueButton teamId={team.id} hasPartner={partner?.inviteStatus === "accepted"} />}

      {phase === "drafting" && (
        <p className="text-sm text-ink/70">
          Registration&apos;s closed and exec is building the schedule. You&apos;ll get an email with your
          week-by-week opponents when it&apos;s published.
          {readiness !== "ready" && " Your team doesn't have two confirmed players yet, so it may sit out — message exec."}
        </p>
      )}

      {phase === "not_drawn" && (
        <p className="text-sm text-ink/70">
          Your team isn&apos;t on the schedule yet — exec will slot you in if there&apos;s an open spot. Reach out to
          exec at <a href={`mailto:${club.email}`} className="font-semibold underline">{club.email}</a>.
        </p>
      )}

      {phase === "live" && team.pool && view && <TeamSchedule view={view} teamId={team.id} now={now} />}
    </div>
  );
}

/** Your team's season, one card per match: who, when, contact, and the buttons for this week. */
function TeamSchedule({ view, teamId, now }: { view: LeagueView; teamId: string; now: Date }) {
  const mine = [...view.pool, ...view.knockout]
    .filter((m) => m.teamAId === teamId || m.teamBId === teamId)
    .sort((a, b) => (a.dueBy?.getTime() ?? 0) - (b.dueBy?.getTime() ?? 0));
  const myPlayers = new Set(view.players(teamId).map((p) => p.memberId));
  const upNext = mine.find((m) => m.status === "pending" && !view.isBye(m) && m.dueBy && m.dueBy >= now);
  const seasonEnd = view.season ? regularSeasonEndsAt(view.season) : null;
  const skipsUsed = view.pool.filter((m) => m.extendedForTeamId === teamId).length;
  const skipsLeft = Math.max(0, SKIP_LIMIT - skipsUsed);

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-bold uppercase tracking-wide text-ink/50">
        Your matches
        <span className={skipsLeft ? "text-ink/45" : "text-red-700"}>
          {skipsLeft ? `${skipsLeft} skip left this season` : "Skip used — any more skips are forfeits"}
        </span>
      </p>
      {mine.length === 0 && <p className="text-sm text-ink/50">No matches yet.</p>}
      {mine.map((m) => {
        const oppId = m.teamAId === teamId ? m.teamBId : m.teamAId;
        const bye = view.isBye(m);
        const report = view.reportByMatch.get(m.id);
        const reportedByUs = Boolean(report?.reportedBy && myPlayers.has(report.reportedBy));
        const known = Boolean(m.teamAId && m.teamBId);
        const skip = seasonEnd && !bye && known ? skipDecision(m, { teamId, skipsUsed }, now, seasonEnd) : null;
        const othersMakeup = Boolean(m.extendedForTeamId && m.extendedForTeamId !== teamId && m.status === "pending");
        const opponents = oppId && !bye ? view.players(oppId) : [];

        return (
          <div
            key={m.id}
            className={cn("border-2 bg-white p-3", m.id === upNext?.id ? "border-gold-500" : "border-navy-900/10", m.dueBy && m.dueBy < now && m.status !== "pending" && "opacity-75")}
          >
            <p className="flex flex-wrap items-center gap-x-2 text-[11px] font-bold uppercase tracking-wide text-ink/45">
              {view.label(m)}
              {m.id === upNext?.id && <span className="bg-gold-500 px-1.5 py-0.5 text-navy-900">Up next</span>}
            </p>
            <p className="mt-1 text-sm font-semibold text-navy-900">{bye ? "Bye — no match this week" : `vs ${view.name(oppId)}`}</p>
            {opponents.length > 0 && (
              <p className="mt-0.5 text-xs text-ink/55">
                {opponents.map((p, i) => (
                  <span key={p.memberId}>
                    {i > 0 && " & "}
                    {p.name ?? p.email}{" "}
                    <a href={`mailto:${p.email}`} className="text-navy-800 underline">
                      {p.email}
                    </a>
                  </span>
                ))}
              </p>
            )}
            {!bye && m.status !== "pending" && <p className="mt-1 text-xs text-ink/50">{resultText(view, m, teamId)}</p>}
            {!bye && m.status === "pending" && m.dueBy && known && (
              <p className="mt-1 text-xs text-ink/55">
                {m.scheduledAt ? (
                  <>
                    <Check size={12} className="mr-1 inline text-gold-500" />
                    Playing <strong className="text-navy-900">{formatDeadline(m.scheduledAt)}</strong>
                    {m.scheduledNote ? ` · ${m.scheduledNote}` : ""}
                  </>
                ) : (
                  <span className={now > scheduleBy(m.dueBy) ? "font-semibold text-red-700" : undefined}>
                    No time posted — due {formatDeadline(scheduleBy(m.dueBy))}
                  </span>
                )}
                {` · report by ${formatDeadline(m.dueBy)}`}
              </p>
            )}

            {othersMakeup && (
              <p className="mt-1 text-xs text-ink/55">
                Makeup — {view.name(oppId)} couldn&apos;t play the original week. If it isn&apos;t played by the deadline, they forfeit it.
              </p>
            )}
            {m.status === "pending" && m.extendedForTeamId === teamId && (
              <p className="mt-1 text-xs font-semibold text-red-700">Your team&apos;s makeup — if it isn&apos;t played by the deadline, it&apos;s a forfeit.</p>
            )}
            {m.status === "pending" && !bye && known && (
              <div className="mt-2 flex flex-wrap items-center gap-4">
                <PostTimeForm
                  matchId={m.id}
                  current={m.scheduledAt ? utcToLaInputValue(m.scheduledAt) : null}
                  currentNote={m.scheduledNote}
                />
                <ScoreReportForm matchId={m.id} teamAName={view.name(m.teamAId)} teamBName={view.name(m.teamBId)} />
                {skip && skip.kind !== "blocked" && (
                  <SkipButton
                    matchId={m.id}
                    consequence={skip.kind}
                    warning={skip.kind === "forfeit" ? FORFEIT_REASON[skip.reason] : undefined}
                    opponentName={view.name(oppId)}
                  />
                )}
              </div>
            )}
            {m.status === "reported" &&
              (reportedByUs ? (
                <p className="mt-2 text-xs text-ink/55">Waiting for {view.name(oppId)} to confirm — it confirms automatically unless they dispute it.</p>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  <ConfirmScoreButton matchId={m.id} />
                  <DisputeScoreButton matchId={m.id} />
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}

async function Invites({ teamIds }: { teamIds: string[] }) {
  const teams = await db()
    .select({ id: schema.tmTeams.id, name: schema.tmTeams.name })
    .from(schema.tmTeams)
    .where(inArray(schema.tmTeams.id, teamIds));
  const rosters = await teamMembers(teamIds);

  return (
    <div className="mt-4 space-y-3">
      {teams.map((t) => {
        const captain = rosters.find((m) => m.teamId === t.id && m.isCaptain) ?? rosters.find((m) => m.teamId === t.id && m.inviteStatus === "accepted");
        return (
          <div key={t.id} className="border-l-4 border-gold-500 bg-chalk p-4">
            <p className="text-sm text-navy-900">
              <strong>{captain?.name ?? captain?.email ?? "Someone"}</strong> invited you to team up as{" "}
              <strong>{t.name}</strong>.
            </p>
            <div className="mt-3">
              <InviteButtons teamId={t.id} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function LeagueCard({
  league,
  user,
  memberships,
  taken,
  now,
}: {
  league: League;
  user: SessionUser;
  memberships: MembershipView[];
  taken: number;
  now: Date;
}) {
  const state = leagueCardState({ league, memberships, isComp: user.onCompetitiveTeam, spotsTaken: taken, now });
  const live = Boolean(league.poolsAnnouncedAt);
  const view = live ? await loadLeagueView(league) : null;
  const highlight = state.kind === "on_team" ? state.teamId : undefined;

  return (
    <div id={`league-${league.id}`} className="scroll-mt-24 border-2 border-navy-900/10 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-extrabold uppercase text-navy-900">{league.name}</h3>
        <span className="bg-navy-900/5 px-2.5 py-1 text-xs font-bold uppercase text-navy-900">
          {league.division}
          {league.eligibility === "competitive_only" ? " · Competitive Team only" : ""}
        </span>
      </div>
      <LeagueMeta league={league} taken={taken} now={now} />
      {live && view?.season && <SeasonLine season={view.season} now={now} />}

      {state.kind === "on_team" && (
        <MyTeam league={league} teamId={state.teamId} phase={state.phase} user={user} now={now} view={view} />
      )}
      {state.kind === "invited" && <Invites teamIds={state.teamIds} />}
      {state.kind === "committed_elsewhere" && (
        <p className="mt-4 text-sm text-ink/60">
          You&apos;re signed up for the {state.leagueName} — it&apos;s one league per person. Leave that one first if you want
          to switch.
        </p>
      )}
      {state.kind === "can_register" && (
        <div className="mt-4">
          <RegisterForm tournamentId={league.id} leagueName={league.name} />
        </div>
      )}
      {state.kind === "full" && <p className="mt-4 text-sm font-semibold text-navy-900">This league is full.</p>}
      {state.kind === "not_eligible" && (
        <p className="mt-4 text-sm text-ink/60">
          This one&apos;s for Competitive Team members. On the comp team but can&apos;t sign up? Ask an exec to add you.
        </p>
      )}
      {state.kind === "closed" && !live && <p className="mt-4 text-sm text-ink/60">Registration is closed.</p>}

      {!live && (
        <details className="group mt-5">
          <summary className="inline-flex h-9 cursor-pointer list-none items-center border-2 border-navy-900/15 px-4 text-xs font-bold uppercase tracking-wide text-navy-900 hover:border-navy-900 [&::-webkit-details-marker]:hidden">
            <Users size={13} className="mr-2" />
            <span className="group-open:hidden">See who&apos;s signed up</span>
            <span className="hidden group-open:inline">Hide sign-ups</span>
          </summary>
          <div className="mt-3">
            <SignupList league={league} highlight={highlight} />
          </div>
        </details>
      )}

      {live && view && (
        <>
          <details className="mt-5" open={state.kind !== "on_team"}>
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-navy-800">
              Standings, schedule &amp; bracket
            </summary>
            <div className="mt-3">
              <LeagueLive league={league} view={view} highlight={highlight} now={now} />
            </div>
          </details>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-navy-800">League rules</summary>
            <div className="mt-3">
              <SeasonRules />
            </div>
          </details>
        </>
      )}
    </div>
  );
}

async function MemberTournamentsView({ user }: { user: SessionUser }) {
  const now = new Date();
  const leagues = await openLeagues();
  const [memberships, spots] = await Promise.all([membershipsFor(user.id), spotsTakenByLeague(leagues.map((l) => l.id))]);

  // One-day club tournaments are plain events (type "tournament") — same
  // RSVP + reminder system as a practice, just surfaced here instead of the
  // regular events list so they don't get lost among weekly practices.
  const oneDayTournaments = await db()
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.published, true), eq(schema.events.type, "tournament"), gte(schema.events.startsAt, now)))
    .orderBy(asc(schema.events.startsAt));

  return (
    <MemberShell user={user}>
      <div className="space-y-12">
        <div>
          <Kicker>Compete</Kicker>
          <h1 className="mt-2 font-display text-2xl font-extrabold uppercase text-navy-900">Tournaments</h1>
        </div>

        <div>
          <Kicker>Semester long</Kicker>
          <h2 className="mt-2 font-display text-xl font-extrabold uppercase text-navy-900">Pickleball League</h2>

          {leagues.length > 0 && (
            <>
              <nav aria-label="Jump to a league" className="mt-4 flex flex-wrap gap-2">
                {leagues.map((l) => (
                  <a
                    key={l.id}
                    href={`#league-${l.id}`}
                    className="flex h-10 items-center gap-2 border-2 border-navy-900/15 bg-white px-4 font-display text-xs font-bold uppercase tracking-wide text-navy-900 transition-colors hover:border-navy-900"
                  >
                    {l.name}
                    <SpotsChip league={l} taken={spots.get(l.id) ?? 0} now={now} />
                  </a>
                ))}
              </nav>
              <div className="mt-4 space-y-4">
                {leagues.map((l) => (
                  <LeagueCard
                    key={l.id}
                    league={l}
                    user={user}
                    memberships={memberships}
                    taken={spots.get(l.id) ?? 0}
                    now={now}
                  />
                ))}
              </div>
            </>
          )}

          <div className="mt-8">
            <HowItWorks tone="member" />
          </div>
        </div>

        <div>
          <Kicker>Upcoming</Kicker>
          <h2 className="mt-2 font-display text-xl font-extrabold uppercase text-navy-900">One-day tournaments</h2>

          {oneDayTournaments.length === 0 ? (
            <div className="mt-4 border-2 border-dashed border-navy-900/15 bg-white p-8 text-center text-sm text-ink/50">
              Nothing scheduled right now — check back soon.
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {oneDayTournaments.map((event) => (
                <li key={event.id}>
                  <Link
                    href={`/events/${event.id}`}
                    className="flex items-center justify-between gap-4 border-2 border-navy-900/10 bg-white p-5 transition-colors hover:border-navy-900"
                  >
                    <div>
                      <p className="font-display text-base font-bold uppercase text-navy-900">{event.title}</p>
                      <p className="mt-1 text-sm text-ink/60">{formatEventWhen(event.startsAt, event.endsAt)}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink/45">
                        <MapPin size={12} /> {event.location}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <TournamentCards />
      </div>
    </MemberShell>
  );
}

async function PublicTournamentsView({ user }: { user: SessionUser | null }) {
  const now = new Date();
  const leagues = await openLeagues();
  const spots = await spotsTakenByLeague(leagues.map((l) => l.id));
  const signedInPending = Boolean(user) && !isActiveMember(user!);

  return (
    <>
      <Header user={user} />
      <main className="flex-1">
        <Section
          tone="navy"
          className="pt-36 sm:pt-44"
          kicker="Compete"
          title="Tournaments"
          lead="Two ways to play for something. Both open to every member, both free."
        />

        {leagues.length > 0 && (
          <Section tone="light" kicker="Pickleball League" title="Sign-ups are open">
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {leagues.map((l) => (
                <div key={l.id} className="border-2 border-navy-900/10 bg-white p-6">
                  <p className="text-xs font-bold uppercase tracking-wide text-ink/50">
                    {l.division}
                    {l.eligibility === "competitive_only" ? " · Competitive Team only" : ""}
                  </p>
                  <h3 className="mt-2 font-display text-lg font-extrabold uppercase text-navy-900">{l.name}</h3>
                  <LeagueMeta league={l} taken={spots.get(l.id) ?? 0} now={now} />
                  {!isRegistrationOpen(l, now) && <p className="mt-3 text-sm text-ink/55">Registration is closed.</p>}
                </div>
              ))}
            </div>
            <p className="mt-8 text-sm text-ink/60">
              {signedInPending ? (
                <>Your account is waiting on exec approval — once you&apos;re approved, you can sign up from this page.</>
              ) : (
                <span className="flex flex-wrap items-center gap-4">
                  <Link
                    href="/login"
                    className="flex h-11 items-center bg-gold-500 px-6 font-display text-xs font-bold uppercase tracking-[0.12em] text-navy-900 transition-colors hover:bg-gold-400"
                  >
                    Sign in to sign up
                  </Link>
                  Solo or with a partner — it&apos;s free.
                </span>
              )}
            </p>
          </Section>
        )}

        <Section tone="chalk">
          <TournamentCards />
        </Section>

        <Section kicker="Pickleball League" title="How it works" lead="One match a week on your own schedule — around your classes, not ours.">
          <div className="mt-14">
            <HowItWorks tone="public" />
          </div>
        </Section>

        <JoinCta />
      </main>
      <Footer />
    </>
  );
}

export default async function TournamentsPage() {
  const user = await getSessionUser();
  if (user && isActiveMember(user)) return <MemberTournamentsView user={user} />;
  return <PublicTournamentsView user={user} />;
}
