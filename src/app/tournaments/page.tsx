import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
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
import { formatDeadline, formatEventWhen } from "@/lib/dates";
import { computeStandings, type Standing } from "@/lib/standings";
import { confirmedPoolMatches } from "@/lib/tournament";
import { membershipsFor, spotsTakenByLeague, teamMembers } from "@/lib/league";
import {
  isRegistrationOpen,
  leagueCardState,
  partnerOf,
  sortLeagues,
  spotsLeft,
  teamReadiness,
  type MembershipView,
} from "@/lib/league-rules";
import { club, leagueSteps } from "@/lib/content";
import { cn } from "@/lib/utils";
import { RegisterForm } from "./register-form";
import { InviteButtons } from "./invite-buttons";
import { InvitePartnerForm, LeaveLeagueButton } from "./team-controls";
import { ScoreReportForm, DisputeScoreButton } from "./score-form";

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

function PoolTable({
  pool,
  standings,
  names,
  advancePerPool,
  highlight,
}: {
  pool: string;
  standings: Standing[];
  names: Map<string, string>;
  advancePerPool: number;
  highlight?: string;
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-ink/50">Pool {pool}</p>
      <ol className="mt-1 border-2 border-navy-900/10 bg-white">
        {standings.map((s, i) => (
          <li
            key={s.teamId}
            className={cn(
              "flex items-center justify-between gap-3 border-b border-navy-900/5 p-3 text-sm last:border-b-0",
              i === advancePerPool - 1 && standings.length > advancePerPool && "border-b-4 border-b-gold-500",
            )}
          >
            <span className={s.teamId === highlight ? "font-bold text-navy-900" : "text-ink/70"}>
              {s.rank}. {names.get(s.teamId) ?? "Team"}
              {i < advancePerPool && (
                <span className="ml-2 bg-gold-500 px-1.5 py-0.5 text-[10px] font-bold uppercase text-navy-900">Moves up</span>
              )}
            </span>
            <span className="shrink-0 text-ink/50">
              {s.wins}-{s.losses}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Every pool of a live league — visible to any member, whether or not they're playing in it. */
async function AllPools({ league, highlight }: { league: League; highlight?: string }) {
  const teams = await db()
    .select({ id: schema.tmTeams.id, name: schema.tmTeams.name, pool: schema.tmTeams.pool, status: schema.tmTeams.status })
    .from(schema.tmTeams)
    .where(eq(schema.tmTeams.tournamentId, league.id));
  const confirmed = await confirmedPoolMatches(league.id);
  const drawn = teams.filter((t) => t.pool && t.status !== "withdrawn");
  const pools = [...new Set(drawn.map((t) => t.pool!))].sort();
  const names = new Map(teams.map((t) => [t.id, t.name]));

  if (pools.length === 0) return <p className="text-sm text-ink/50">No pools yet.</p>;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {pools.map((pool) => (
        <PoolTable
          key={pool}
          pool={pool}
          names={names}
          advancePerPool={league.advancePerPool}
          highlight={highlight}
          standings={computeStandings(
            drawn.filter((t) => t.pool === pool).map((t) => t.id),
            confirmed.filter((m) => m.pool === pool),
          )}
        />
      ))}
    </div>
  );
}

async function MyTeam({
  league,
  teamId,
  phase,
  user,
  now,
}: {
  league: League;
  teamId: string;
  phase: "registration" | "drafting" | "live" | "not_drawn";
  user: SessionUser;
  now: Date;
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
    ) : (
      <>No partner yet — invite one, or exec will pair you with another solo player before the draw.</>
    );

  const canInvite = phase === "registration" && readiness !== "ready" && isRegistrationOpen(league, now);

  return (
    <div className="mt-4 space-y-4">
      <div className="border-l-4 border-gold-500 bg-chalk p-4">
        <p className="text-sm text-navy-900">
          You&apos;re in as <strong>{team.name}</strong>
          {team.pool && phase === "live" ? `, Pool ${team.pool}` : ""}.
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
          Registration&apos;s closed and exec is setting the pools. You&apos;ll get an email with your opponents
          when they&apos;re published.
          {readiness !== "ready" && " Your team doesn't have two confirmed players yet, so it may sit out — message exec."}
        </p>
      )}

      {phase === "not_drawn" && (
        <p className="text-sm text-ink/70">
          Your team wasn&apos;t in the draw — it didn&apos;t have two confirmed players when pools were made. Reach out to
          exec at <a href={`mailto:${club.email}`} className="font-semibold underline">{club.email}</a>.
        </p>
      )}

      {phase === "live" && team.pool && <LiveMatches league={league} teamId={team.id} pool={team.pool} />}
    </div>
  );
}

async function LiveMatches({ league, teamId, pool }: { league: League; teamId: string; pool: string }) {
  const poolTeams = await db()
    .select({ id: schema.tmTeams.id, name: schema.tmTeams.name })
    .from(schema.tmTeams)
    .where(and(eq(schema.tmTeams.tournamentId, league.id), eq(schema.tmTeams.pool, pool)));
  const names = new Map(poolTeams.map((t) => [t.id, t.name]));
  const matches = await db()
    .select()
    .from(schema.matches)
    .where(and(eq(schema.matches.tournamentId, league.id), eq(schema.matches.pool, pool)));
  const mine = matches.filter((m) => m.teamAId === teamId || m.teamBId === teamId);
  const name = (id: string | null) => (id ? (names.get(id) ?? "Withdrawn team") : "TBD");

  const STATUS: Record<string, string> = {
    pending: "Not played yet",
    reported: "Score reported — confirms automatically unless disputed",
    confirmed: "Final",
    disputed: "Disputed — waiting on an admin",
    forfeited: "Forfeited",
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-wide text-ink/50">Your matches</p>
      {mine.length === 0 && <p className="text-sm text-ink/50">No matches in your pool.</p>}
      {mine.map((m) => (
        <div key={m.id} className="border-2 border-navy-900/10 bg-white p-3">
          <p className="text-sm font-semibold text-navy-900">vs {name(m.teamAId === teamId ? m.teamBId : m.teamAId)}</p>
          <p className="mt-0.5 text-xs text-ink/50">{STATUS[m.status] ?? m.status}</p>
          {m.status === "pending" && (
            <div className="mt-2">
              <ScoreReportForm matchId={m.id} teamAName={name(m.teamAId)} teamBName={name(m.teamBId)} />
            </div>
          )}
          {m.status === "reported" && (
            <div className="mt-2">
              <DisputeScoreButton matchId={m.id} />
            </div>
          )}
        </div>
      ))}
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

      {state.kind === "on_team" && (
        <MyTeam league={league} teamId={state.teamId} phase={state.phase} user={user} now={now} />
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

      {live && (
        <details className="mt-5" open={state.kind !== "on_team"}>
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-navy-800">
            All pools &amp; standings
          </summary>
          <div className="mt-3">
            <AllPools league={league} highlight={state.kind === "on_team" ? state.teamId : undefined} />
          </div>
        </details>
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

        <Section kicker="Pickleball League" title="How it works" lead="Pool play on your own schedule — around your classes, not ours.">
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
