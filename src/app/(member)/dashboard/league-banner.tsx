import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { ArrowRight, Trophy } from "lucide-react";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/session";
import { membershipsFor, spotsTakenByLeague } from "@/lib/league";
import { leagueCardState, sortLeagues } from "@/lib/league-rules";
import { formatDeadline } from "@/lib/dates";

/** The one league thing this member should do next — answer an invite, check their team, or sign up. Renders nothing if there's no league. */
export async function LeagueBanner({ user }: { user: SessionUser }) {
  const now = new Date();
  const leagues = sortLeagues(
    await db()
      .select()
      .from(schema.tournaments)
      .where(
        and(
          eq(schema.tournaments.kind, "im_semester"),
          inArray(schema.tournaments.status, ["registration", "pools", "knockout"]),
        ),
      ),
  );
  if (leagues.length === 0) return null;

  const [memberships, spots] = await Promise.all([membershipsFor(user.id), spotsTakenByLeague(leagues.map((l) => l.id))]);
  const states = leagues.map((league) => ({
    league,
    state: leagueCardState({
      league,
      memberships,
      isComp: user.onCompetitiveTeam,
      spotsTaken: spots.get(league.id) ?? 0,
      now,
    }),
  }));

  const onTeam = states.find((s) => s.state.kind === "on_team");
  const invited = states.find((s) => s.state.kind === "invited");
  const open = states.filter((s) => s.state.kind === "can_register");

  let title: string;
  let body: string;
  let cta: string;
  if (invited && !onTeam) {
    title = "You have a league invite";
    body = `Someone wants you as their partner in the ${invited.league.name}. Accept or decline on the Tournaments tab.`;
    cta = "Answer invite";
  } else if (onTeam) {
    title = `You're in the ${onTeam.league.name}`;
    body = onTeam.league.poolsAnnouncedAt
      ? "Pools are out — check your matches and report scores on the Tournaments tab."
      : "See your partner status and team details on the Tournaments tab.";
    cta = "View your team";
  } else if (open.length > 0) {
    const deadlines = open.map((s) => s.league.registrationClosesAt).filter((d): d is Date => Boolean(d));
    const soonest = deadlines.sort((a, b) => a.getTime() - b.getTime())[0];
    title = "Pickleball League sign-ups are open";
    body = `${open.map((s) => s.league.name).join(", ")}${soonest ? ` — sign up by ${formatDeadline(soonest)}` : ""}. Solo or with a partner.`;
    cta = "Sign up";
  } else {
    return null;
  }

  return (
    <Link
      href="/tournaments"
      className="group flex items-center justify-between gap-4 border-2 border-navy-900 bg-navy-900 p-5 text-white transition-colors hover:bg-navy-800"
    >
      <div className="flex items-start gap-3">
        <Trophy size={20} className="mt-0.5 shrink-0 text-gold-500" />
        <div>
          <p className="font-display text-base font-extrabold uppercase">{title}</p>
          <p className="mt-1 text-sm text-white/75">{body}</p>
        </div>
      </div>
      <span className="hidden shrink-0 items-center gap-1.5 font-display text-xs font-bold uppercase text-gold-500 sm:flex">
        {cta} <ArrowRight size={14} />
      </span>
    </Link>
  );
}
