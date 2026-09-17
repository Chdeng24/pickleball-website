import "server-only";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { sendWeeklyNudge } from "@/lib/email";

const NUDGE_COOLDOWN_MS = 6 * 24 * 60 * 60 * 1000; // once every ~6 days, so a weekly trigger never double-sends

/**
 * For every live (announced, not complete) tournament, finds each team's
 * soonest still-unplayed match and nudges them if it hasn't been nudged in
 * the last ~6 days. Also includes a friendly line about their most recent
 * confirmed result, if they have one.
 */
export async function sendWeeklySocialLeagueNudges(): Promise<{ nudgesSent: number }> {
  const tournaments = await db()
    .select()
    .from(schema.tournaments)
    .where(
      and(
        eq(schema.tournaments.kind, "im_semester"),
        eq(schema.tournaments.status, "pools"),
        // poolsAnnouncedAt not null — live season, not still a draft
      ),
    );

  let nudgesSent = 0;
  const cutoff = new Date(Date.now() - NUDGE_COOLDOWN_MS);

  for (const tournament of tournaments) {
    if (!tournament.poolsAnnouncedAt) continue;

    const teams = await db().query.tmTeams.findMany({
      where: and(eq(schema.tmTeams.tournamentId, tournament.id), eq(schema.tmTeams.status, "registered")),
      with: { members: { with: { member: true } } },
    });

    const pendingMatches = await db()
      .select()
      .from(schema.matches)
      .where(
        and(
          eq(schema.matches.tournamentId, tournament.id),
          eq(schema.matches.stage, "pool"),
          eq(schema.matches.status, "pending"),
          or(isNull(schema.matches.lastNudgedAt), lt(schema.matches.lastNudgedAt, cutoff)),
        ),
      );

    for (const team of teams) {
      const next = pendingMatches.find((m) => m.teamAId === team.id || m.teamBId === team.id);
      if (!next) continue;

      const opponentId = next.teamAId === team.id ? next.teamBId : next.teamAId;
      const opponent = teams.find((t) => t.id === opponentId);

      const [lastReport] = await db()
        .select({ report: schema.matchReports, match: schema.matches })
        .from(schema.matchReports)
        .innerJoin(schema.matches, eq(schema.matchReports.matchId, schema.matches.id))
        .where(
          and(
            eq(schema.matches.tournamentId, tournament.id),
            eq(schema.matches.status, "confirmed"),
            or(eq(schema.matches.teamAId, team.id), eq(schema.matches.teamBId, team.id)),
          ),
        )
        .orderBy(desc(schema.matchReports.createdAt))
        .limit(1);

      const lastResult = lastReport
        ? {
            won: lastReport.report.winnerTeamId === team.id,
            opponentName:
              teams.find(
                (t) =>
                  t.id ===
                  (lastReport.match.teamAId === team.id ? lastReport.match.teamBId : lastReport.match.teamAId),
              )?.name ?? null,
          }
        : null;

      // Claim this match atomically so we don't double-nudge if run more than once.
      const claimed = await db()
        .update(schema.matches)
        .set({ lastNudgedAt: new Date() })
        .where(
          and(
            eq(schema.matches.id, next.id),
            or(isNull(schema.matches.lastNudgedAt), lt(schema.matches.lastNudgedAt, cutoff)),
          ),
        )
        .returning({ id: schema.matches.id });
      if (claimed.length === 0) continue;

      for (const m of team.members) {
        if (m.inviteStatus !== "accepted" || !m.member.email) continue;
        await sendWeeklyNudge(
          { email: m.member.email, name: m.member.name },
          {
            tournamentName: tournament.name,
            teamName: team.name,
            opponentName: opponent?.name ?? null,
            lastResult,
          },
        ).catch((err) => console.error("weekly nudge email failed", err));
        nudgesSent++;
      }
    }
  }

  return { nudgesSent };
}

/** Auto-confirms any match report whose dispute window has closed with no dispute. */
export async function autoConfirmDueMatchReports(): Promise<{ confirmed: number }> {
  const now = new Date();

  const pendingReports = await db()
    .select({ report: schema.matchReports, tournament: schema.tournaments })
    .from(schema.matchReports)
    .innerJoin(schema.matches, eq(schema.matchReports.matchId, schema.matches.id))
    .innerJoin(schema.tournaments, eq(schema.matches.tournamentId, schema.tournaments.id))
    .where(and(isNull(schema.matchReports.confirmedAt), isNull(schema.matchReports.disputedBy)));

  let confirmed = 0;
  for (const { report, tournament } of pendingReports) {
    const dueAt = new Date(report.createdAt.getTime() + tournament.autoconfirmHours * 60 * 60 * 1000);
    if (dueAt > now) continue;

    const claimed = await db()
      .update(schema.matchReports)
      .set({ confirmedAt: now })
      .where(and(eq(schema.matchReports.id, report.id), isNull(schema.matchReports.confirmedAt)))
      .returning({ id: schema.matchReports.id });
    if (claimed.length === 0) continue;

    await db()
      .update(schema.matches)
      .set({ status: "confirmed", winnerTeamId: report.winnerTeamId })
      .where(eq(schema.matches.id, report.matchId));
    confirmed++;
  }

  return { confirmed };
}
