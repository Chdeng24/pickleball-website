import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { Trophy, Users, ClipboardCheck, CalendarClock, MapPin } from "lucide-react";
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
import { formatEventWhen } from "@/lib/dates";
import { computeStandings } from "@/lib/standings";
import { confirmedPoolMatches } from "@/lib/tournament";
import { RegisterForm } from "./register-form";
import { InviteButtons } from "./invite-buttons";
import { ScoreReportForm, DisputeScoreButton } from "./score-form";

export const metadata: Metadata = { title: "Tournaments" };

// How the Pickleball League actually runs, for members.
const howItWorks = [
  {
    icon: Users,
    title: "Find a partner",
    body: "Register as a pair, free. No partner? Join the free-agent pool and we'll match you.",
  },
  {
    icon: Trophy,
    title: "Get drawn into a pool",
    body: "Once registration closes you're placed in a pool with a few other teams in your division — pool sizes scale to however many sign up.",
  },
  {
    icon: CalendarClock,
    title: "Play your 7 matches",
    body: "One against every other team in your pool. Best of 3, self-officiated at Clark Kerr — played in any order, whenever you and your opponents are both free.",
  },
  {
    icon: ClipboardCheck,
    title: "Standings update live",
    body: "Any one of the four players reports each score. Standings update live as results come in — final placement decides seeding for what comes next.",
  },
];

function HowItWorks({ tone }: { tone: "member" | "public" }) {
  return (
    <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      {howItWorks.map((step, i) => (
        <Reveal key={step.title} delay={i * 0.08}>
          <li
            className={
              tone === "member"
                ? "flex h-full flex-col border-t-4 border-gold-500 bg-white p-7"
                : "flex h-full flex-col border-t-4 border-gold-500 bg-chalk p-7"
            }
          >
            <step.icon size={26} className="text-navy-800" />
            <span className="kicker mt-6 text-ink/40">Step {i + 1}</span>
            <h3 className="mt-2 font-display text-xl font-extrabold uppercase text-navy-900">
              {step.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-ink/65">{step.body}</p>
          </li>
        </Reveal>
      ))}
    </ol>
  );
}

/** One tournament card inside the Pickleball League section, fully data-driven off the current member's registration/team state. */
async function SocialLeagueCard({ tournament, user }: { tournament: typeof schema.tournaments.$inferSelect; user: SessionUser }) {
  const myMembership = await db().query.tmTeamMembers.findFirst({
    where: eq(schema.tmTeamMembers.memberId, user.id),
    with: { team: true },
  });
  const myTeam = myMembership?.team.tournamentId === tournament.id ? myMembership.team : null;

  const eligible = tournament.eligibility === "all" || user.onCompetitiveTeam;
  const registrationOpen =
    tournament.status === "registration" &&
    (!tournament.registrationClosesAt || tournament.registrationClosesAt > new Date());

  const isLive = Boolean(tournament.poolsAnnouncedAt);

  let poolStandings: ReturnType<typeof computeStandings> | null = null;
  let poolTeams: { id: string; name: string }[] = [];
  let myMatches: (typeof schema.matches.$inferSelect)[] = [];

  if (isLive && myTeam?.pool) {
    const allPoolTeams = await db()
      .select({ id: schema.tmTeams.id, name: schema.tmTeams.name })
      .from(schema.tmTeams)
      .where(and(eq(schema.tmTeams.tournamentId, tournament.id), eq(schema.tmTeams.pool, myTeam.pool)));
    poolTeams = allPoolTeams;
    const confirmed = await confirmedPoolMatches(tournament.id);
    poolStandings = computeStandings(
      allPoolTeams.map((t) => t.id),
      confirmed.filter((m) => m.pool === myTeam.pool),
    );
    myMatches = await db()
      .select()
      .from(schema.matches)
      .where(and(eq(schema.matches.tournamentId, tournament.id), eq(schema.matches.pool, myTeam.pool)));
  }

  const teamName = (id: string | null) => poolTeams.find((t) => t.id === id)?.name ?? "TBD";

  return (
    <div className="border-2 border-navy-900/10 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-lg font-extrabold uppercase text-navy-900">{tournament.name}</h3>
        <span className="bg-navy-900/5 px-2.5 py-1 text-xs font-bold uppercase text-navy-900">
          {tournament.division}
          {tournament.eligibility === "competitive_only" ? " · Competitive Team only" : ""}
        </span>
      </div>

      {myMembership && myMembership.team.tournamentId === tournament.id && myMembership.inviteStatus === "pending" ? (
        <div className="mt-4">
          <p className="text-sm text-ink/70">You&apos;ve been invited to a team for this tournament.</p>
          <div className="mt-3">
            <InviteButtons teamId={myMembership.teamId} />
          </div>
        </div>
      ) : myTeam ? (
        isLive ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-ink/70">
              You&apos;re <strong>{myTeam.name}</strong>, Pool {myTeam.pool}.
            </p>
            {poolStandings && (
              <ul className="divide-y divide-navy-900/5 border-2 border-navy-900/10">
                {poolStandings.map((s) => (
                  <li key={s.teamId} className="flex items-center justify-between p-3 text-sm">
                    <span className={s.teamId === myTeam.id ? "font-bold text-navy-900" : "text-ink/70"}>
                      {s.rank}. {teamName(s.teamId)}
                    </span>
                    <span className="text-ink/50">
                      {s.wins}-{s.losses}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-3">
              {myMatches
                .filter((m) => m.teamAId === myTeam.id || m.teamBId === myTeam.id)
                .map((m) => {
                  const opponentId = m.teamAId === myTeam.id ? m.teamBId : m.teamAId;
                  return (
                    <div key={m.id} className="border-2 border-navy-900/10 p-3">
                      <p className="text-sm font-semibold text-navy-900">vs {teamName(opponentId)}</p>
                      <p className="mt-0.5 text-xs capitalize text-ink/50">{m.status}</p>
                      {m.status === "pending" && (
                        <div className="mt-2">
                          <ScoreReportForm matchId={m.id} teamAName={teamName(m.teamAId)} teamBName={teamName(m.teamBId)} />
                        </div>
                      )}
                      {m.status === "reported" && <DisputeScoreButton matchId={m.id} />}
                    </div>
                  );
                })}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink/70">
            You&apos;re registered as <strong>{myTeam.name}</strong> — waiting on the draw.
          </p>
        )
      ) : registrationOpen && eligible ? (
        <div className="mt-4">
          <RegisterForm tournamentId={tournament.id} />
        </div>
      ) : registrationOpen && !eligible ? (
        <p className="mt-4 text-sm text-ink/50">This one&apos;s for Competitive Team members only.</p>
      ) : (
        <p className="mt-4 text-sm text-ink/50">Registration is closed.</p>
      )}
    </div>
  );
}

/** Signed-in members get the member-area shell — registration isn't live yet, but they should never be dropped into the signed-out marketing page. */
async function MemberTournamentsView({
  user,
}: {
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
}) {
  const socialLeagues = await db()
    .select()
    .from(schema.tournaments)
    .where(and(eq(schema.tournaments.kind, "im_semester"), inArray(schema.tournaments.status, ["registration", "pools"])));
  // One-day club tournaments are plain events (type "tournament") — same
  // RSVP + reminder system as a practice, just surfaced here instead of the
  // regular events list so they don't get lost among weekly practices.
  const oneDayTournaments = await db()
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.published, true),
        eq(schema.events.type, "tournament"),
        gte(schema.events.startsAt, new Date()),
      ),
    )
    .orderBy(asc(schema.events.startsAt));

  return (
    <MemberShell user={user}>
      <div className="space-y-12">
        <div>
          <Kicker>Compete</Kicker>
          <h1 className="mt-2 font-display text-2xl font-extrabold uppercase text-navy-900">
            Tournaments
          </h1>
        </div>

        <div>
          <Kicker>Upcoming</Kicker>
          <h2 className="mt-2 font-display text-xl font-extrabold uppercase text-navy-900">
            One-day tournaments
          </h2>

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
                      <p className="font-display text-base font-bold uppercase text-navy-900">
                        {event.title}
                      </p>
                      <p className="mt-1 text-sm text-ink/60">
                        {formatEventWhen(event.startsAt, event.endsAt)}
                      </p>
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

        <div>
          <Kicker>Semester long</Kicker>
          <h2 className="mt-2 font-display text-xl font-extrabold uppercase text-navy-900">
            Pickleball League
          </h2>

          {socialLeagues.length === 0 ? (
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink/60">
              Nothing open right now — exec will announce it here once it is. Here&apos;s how
              it&apos;ll work:
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {socialLeagues.map((t) => (
                <SocialLeagueCard key={t.id} tournament={t} user={user} />
              ))}
            </div>
          )}

          <div className="mt-6">
            <HowItWorks tone="member" />
          </div>
        </div>

        <TournamentCards />
      </div>
    </MemberShell>
  );
}

function PublicTournamentsView({ user }: { user: Awaited<ReturnType<typeof getSessionUser>> }) {
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

        <Section tone="chalk">
          <TournamentCards />
        </Section>

        <Section
          kicker="Pickleball League"
          title="How the bracket works"
          lead="Pool play into playoffs — scheduled around your own classes, not ours."
        >
          <div className="mt-14">
            <HowItWorks tone="public" />
          </div>

          <p className="mt-10 text-sm text-ink/50">
            Brackets, pairings, and score reporting all run through the member area —
            sign in once registration opens.
          </p>
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
