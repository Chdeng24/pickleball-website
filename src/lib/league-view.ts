import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { teamMembers } from "@/lib/league";
import { computeStandings } from "@/lib/standings";
import { matchLabel } from "@/lib/schedule";
import { seasonConfig, standingsMatches } from "@/lib/tournament";

type League = typeof schema.tournaments.$inferSelect;
export type ViewMatch = typeof schema.matches.$inferSelect;
export type ViewReport = typeof schema.matchReports.$inferSelect;

/** Everything a league page needs, read once: teams + rosters, every match with its latest report, standings, and labels. */
export async function loadLeagueView(league: League) {
  const teams = await db().select().from(schema.tmTeams).where(eq(schema.tmTeams.tournamentId, league.id));
  const roster = await teamMembers(teams.filter((t) => !t.isPlaceholder).map((t) => t.id));
  const matches = await db().select().from(schema.matches).where(eq(schema.matches.tournamentId, league.id));
  const reports = matches.length
    ? await db()
        .select()
        .from(schema.matchReports)
        .where(inArray(schema.matchReports.matchId, matches.map((m) => m.id)))
    : [];
  const reportByMatch = new Map<string, ViewReport>();
  for (const r of reports.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) reportByMatch.set(r.matchId, r);

  const season = league.seasonStartsOn && league.finalOn ? seasonConfig(league) : null;
  const byId = new Map(teams.map((t) => [t.id, t]));
  const scheduled = teams.filter((t) => t.pool && !t.isPlaceholder && t.status !== "withdrawn");
  const standings = computeStandings(
    scheduled.map((t) => t.id),
    await standingsMatches(league.id),
  );

  const pool = matches.filter((m) => m.stage === "pool").sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
  const knockout = matches.filter((m) => m.stage === "knockout").sort((a, b) => (a.round ?? 0) - (b.round ?? 0) || (a.slot ?? 0) - (b.slot ?? 0));
  const weeks = [...new Set(pool.map((m) => m.round ?? 0))].sort((a, b) => a - b);

  const name = (id: string | null) => {
    if (!id) return "TBD";
    const t = byId.get(id);
    if (!t) return "Withdrawn team";
    return t.isPlaceholder ? "Bye" : t.name;
  };
  const isBye = (m: ViewMatch) => [m.teamAId, m.teamBId].some((id) => id && byId.get(id)?.isPlaceholder);
  const players = (teamId: string) => roster.filter((r) => r.teamId === teamId && r.inviteStatus === "accepted");
  const label = (m: ViewMatch) => (season ? matchLabel(m, season) : `Week ${m.round}`);

  return { teams, byId, roster, matches, pool, knockout, weeks, reportByMatch, standings, season, name, isBye, players, label };
}

export type LeagueView = Awaited<ReturnType<typeof loadLeagueView>>;

/** "11-7, 9-11, 11-5" from the given team's side. */
export function scoreFor(report: ViewReport | undefined, match: ViewMatch, teamId?: string): string {
  if (!report) return "";
  const flip = teamId !== undefined && teamId === match.teamBId;
  return report.games.map(([a, b]) => (flip ? `${b}-${a}` : `${a}-${b}`)).join(", ");
}

/** One line describing where a match stands, from a team's point of view when given. */
export function resultText(view: LeagueView, m: ViewMatch, teamId?: string): string {
  const report = view.reportByMatch.get(m.id);
  const score = scoreFor(report, m, teamId);
  const who = (id: string | null) => (teamId ? (id === teamId ? "Won" : "Lost") : `${view.name(id)} won`);
  switch (m.status) {
    case "pending":
      return view.isBye(m) ? "Bye" : "Not played yet";
    case "reported":
      return `Reported ${score} — waiting on confirmation`;
    case "disputed":
      return `Disputed — an admin will decide`;
    case "confirmed":
      return `${who(m.winnerTeamId)} ${score}`;
    case "forfeited":
      return m.winnerTeamId ? `${who(m.winnerTeamId)} by forfeit` : "Double forfeit — no winner";
  }
}
