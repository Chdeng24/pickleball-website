import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { withTransaction, type Tx } from "@/db/pool";
import { noTimePostedEmail, reportTonightEmail, sendMany, type MatchLine } from "@/lib/email";
import { matchLabel, OVERDUE_GRACE_MS, overdueOutcome, reportReminderAt, scheduleBy } from "@/lib/schedule";
import { seasonConfig, settleMatchTx } from "@/lib/tournament";

/**
 * The league's clock. Called hourly by the cron route. Each league's tick
 * runs in one transaction holding the league row lock, and every email is
 * claimed on its match row (reminderSentAt / reportReminderSentAt) in that same
 * transaction — so overlapping or repeated runs never double-send, and a
 * missed run is caught up by the next.
 *
 *   1. Auto-confirm scores whose dispute window has closed.
 *   2. Sunday ~10 AM: settle the week's unreported round-robin matches
 *      (makeup not played → the team that missed the original week forfeits; otherwise double forfeit).
 *   3. After Wednesday 11:59 PM: "post your match time" to both teams if nobody has.
 *   4. Saturday 9 AM: "report your score by tonight" to both teams if it's still unreported.
 *
 * Those two are the only recurring emails — by design, to keep inboxes quiet.
 */
export async function runLeagueTick(now = new Date()) {
  const { confirmed } = await autoConfirmDueMatchReports(now);
  const totals = { confirmed, settled: 0, reminderEmails: 0, reportEmails: 0 };

  const leagues = await db()
    .select({ id: schema.tournaments.id })
    .from(schema.tournaments)
    .where(and(eq(schema.tournaments.kind, "im_semester"), inArray(schema.tournaments.status, ["pools", "knockout"])));

  for (const { id } of leagues) {
    // Emails go out only after the claims commit — a rolled-back tick never sends.
    const r = await withTransaction((tx) => leagueTickTx(tx, id, now));
    await sendMany(r.outbox);
    totals.settled += r.settled;
    totals.reminderEmails += r.reminderEmails;
    totals.reportEmails += r.reportEmails;
  }
  return totals;
}

type Outbox = Parameters<typeof sendMany>[0];

/** One league's tick, inside one transaction holding the league row lock. Returns the emails to send once committed. */
export async function leagueTickTx(tx: Tx, tournamentId: string, now: Date) {
  const out = { outbox: [] as Outbox, settled: 0, reminderEmails: 0, reportEmails: 0 };
  const [tournament] = await tx.select().from(schema.tournaments).where(eq(schema.tournaments.id, tournamentId)).for("update");
  if (!tournament?.poolsAnnouncedAt || !tournament.seasonStartsOn || !tournament.finalOn) return out;
  if (tournament.status !== "pools" && tournament.status !== "knockout") return out;
  const season = seasonConfig(tournament);

  const teamRows = await tx.query.tmTeams.findMany({
    where: eq(schema.tmTeams.tournamentId, tournament.id),
    with: { members: { with: { member: { columns: { email: true, name: true } } } } },
  });
  const teams = new Map(
    teamRows.map((t) => [
      t.id,
      {
        id: t.id,
        name: t.name,
        real: !t.isPlaceholder && t.status !== "withdrawn",
        placeholder: t.isPlaceholder,
        players: t.members.filter((m) => m.inviteStatus === "accepted").map((m) => ({ email: m.member.email, name: m.member.name })),
      },
    ]),
  );
  const matches = await tx.select().from(schema.matches).where(eq(schema.matches.tournamentId, tournament.id));
  type M = (typeof matches)[number];

  const line = (m: M, teamId: string): MatchLine => {
    const opp = teams.get((m.teamAId === teamId ? m.teamBId : m.teamAId) ?? "");
    return {
      label: matchLabel(m, season),
      dueBy: m.dueBy!,
      opponent: opp && !opp.placeholder ? { name: opp.name, players: opp.players } : null,
    };
  };
  const bothReal = (m: M) => Boolean(m.teamAId && m.teamBId && teams.get(m.teamAId)?.real && teams.get(m.teamBId)?.real);

  /* 2. Settle unreported round-robin matches. */
  for (const m of matches) {
    if (m.stage !== "pool" || m.status !== "pending" || !m.dueBy || !bothReal(m)) continue;
    if (now.getTime() <= m.dueBy.getTime() + OVERDUE_GRACE_MS) continue;
    const { winnerTeamId } = overdueOutcome({ teamAId: m.teamAId!, teamBId: m.teamBId!, extendedForTeamId: m.extendedForTeamId });
    await settleMatchTx(tx, m, "forfeited", winnerTeamId);
    m.status = "forfeited";
    out.settled++;
  }

  /* 3 + 4. Reminders — one email per team listing all its matches. */
  const remindersByTeam = new Map<string, MatchLine[]>();
  const reportByTeam = new Map<string, MatchLine[]>();
  const add = (map: Map<string, MatchLine[]>, m: M, ids: string[]) => {
    for (const id of ids) map.set(id, [...(map.get(id) ?? []), line(m, id)]);
  };

  for (const m of matches) {
    if (m.status !== "pending" || !m.dueBy || !m.teamAId || !m.teamBId || now > m.dueBy) continue;
    const realSides = [m.teamAId, m.teamBId].filter((id) => teams.get(id)?.real);
    if (realSides.length === 0) continue;

    if (!m.reminderSentAt && !m.scheduledAt && bothReal(m) && now >= scheduleBy(m.dueBy)) {
      await tx.update(schema.matches).set({ reminderSentAt: now }).where(eq(schema.matches.id, m.id));
      add(remindersByTeam, m, realSides);
    }
    if (!m.reportReminderSentAt && bothReal(m) && now >= reportReminderAt(m.dueBy)) {
      await tx.update(schema.matches).set({ reportReminderSentAt: now }).where(eq(schema.matches.id, m.id));
      add(reportByTeam, m, realSides);
    }
  }

  for (const [teamId, lines] of remindersByTeam) {
    const team = teams.get(teamId)!;
    for (const p of team.players) {
      out.outbox.push(noTimePostedEmail(p, { tournamentName: tournament.name, teamName: team.name, matches: lines }));
      out.reminderEmails++;
    }
  }
  for (const [teamId, lines] of reportByTeam) {
    const team = teams.get(teamId)!;
    for (const p of team.players) {
      out.outbox.push(reportTonightEmail(p, { tournamentName: tournament.name, teamName: team.name, matches: lines }));
      out.reportEmails++;
    }
  }
  return out;
}

/** Auto-confirms any match report whose dispute window has closed with no dispute — and advances the winner in the playoffs. */
export async function autoConfirmDueMatchReports(now = new Date()): Promise<{ confirmed: number }> {
  const pendingReports = await db()
    .select({ report: schema.matchReports, tournament: schema.tournaments })
    .from(schema.matchReports)
    .innerJoin(schema.matches, eq(schema.matchReports.matchId, schema.matches.id))
    .innerJoin(schema.tournaments, eq(schema.matches.tournamentId, schema.tournaments.id))
    .where(and(isNull(schema.matchReports.confirmedAt), isNull(schema.matchReports.disputedBy), eq(schema.matches.status, "reported")));

  let confirmed = 0;
  for (const { report, tournament } of pendingReports) {
    const dueAt = new Date(report.createdAt.getTime() + tournament.autoconfirmHours * 60 * 60 * 1000);
    if (dueAt > now) continue;

    const done = await withTransaction(async (tx) => {
      const [match] = await tx.select().from(schema.matches).where(eq(schema.matches.id, report.matchId)).for("update");
      if (!match || match.status !== "reported") return false;
      const claimed = await tx
        .update(schema.matchReports)
        .set({ confirmedAt: now })
        .where(and(eq(schema.matchReports.id, report.id), isNull(schema.matchReports.confirmedAt), isNull(schema.matchReports.disputedBy)))
        .returning({ id: schema.matchReports.id });
      if (claimed.length === 0) return false;
      await settleMatchTx(tx, match, "confirmed", report.winnerTeamId);
      return true;
    });
    if (done) confirmed++;
  }

  return { confirmed };
}
