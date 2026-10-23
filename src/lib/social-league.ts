import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { withTransaction, type Tx } from "@/db/pool";
import { matchReminderEmail, sendMany, type MatchLine } from "@/lib/email";
import { currentWeek, halfwayDueBy, halfwayWeek, matchLabel, OVERDUE_GRACE_MS, overdueOutcome, reminderDue } from "@/lib/schedule";
import { seasonConfig, settleMatchTx } from "@/lib/tournament";

/**
 * The league's clock. Called hourly by the cron route. Each league's tick
 * runs in one transaction holding the league row lock, and every email is
 * claimed on its match row (reminderSentAt) in that same transaction — so
 * overlapping or repeated runs never double-send, and a missed run is caught
 * up by the next.
 *
 *   1. Auto-confirm scores whose dispute window has closed (advancing playoff winners).
 *   2. Monday ~10 AM after a deadline: settle unreported round-robin matches
 *      (pushed back and not played → the team that pushed it forfeits; otherwise double forfeit).
 *   3. Wednesday and Sunday 9 AM: one reminder per team listing every match it
 *      still has to play, with the deadline.
 */
export async function runLeagueTick(now = new Date()) {
  const totals = { confirmed: 0, settled: 0, reminderEmails: 0 };

  const leagues = await db()
    .select({ id: schema.tournaments.id })
    .from(schema.tournaments)
    .where(and(eq(schema.tournaments.kind, "im_semester"), inArray(schema.tournaments.status, ["pools", "knockout"])));

  for (const { id } of leagues) {
    // Emails go out only after the claims commit — a rolled-back tick never sends.
    const r = await withTransaction((tx) => leagueTickTx(tx, id, now));
    await sendMany(r.outbox);
    totals.confirmed += r.confirmed;
    totals.settled += r.settled;
    totals.reminderEmails += r.reminderEmails;
  }
  return totals;
}

type Outbox = Parameters<typeof sendMany>[0];

/** One league's tick, inside one transaction holding the league row lock. Returns the emails to send once committed. */
export async function leagueTickTx(tx: Tx, tournamentId: string, now: Date) {
  const out = { outbox: [] as Outbox, confirmed: 0, settled: 0, reminderEmails: 0 };
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

  /* 1. Auto-confirm reported scores whose dispute window closed — and advance playoff winners. */
  const windowMs = tournament.autoconfirmHours * 60 * 60 * 1000;
  const reported = matches.filter((m) => m.status === "reported");
  if (reported.length) {
    const reports = await tx
      .select()
      .from(schema.matchReports)
      .where(and(inArray(schema.matchReports.matchId, reported.map((m) => m.id)), isNull(schema.matchReports.confirmedAt), isNull(schema.matchReports.disputedBy)));
    for (const r of reports) {
      if (r.createdAt.getTime() + windowMs > now.getTime()) continue;
      const m = reported.find((x) => x.id === r.matchId)!;
      await tx.update(schema.matchReports).set({ confirmedAt: now }).where(eq(schema.matchReports.id, r.id));
      await settleMatchTx(tx, m, "confirmed", r.winnerTeamId);
      m.status = "confirmed";
      out.confirmed++;
    }
  }

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

  /* 3. Reminders — one email per team listing every match it still has to play. */
  const week = currentWeek(season.seasonStartsOn, now);
  const remindersByTeam = new Map<string, MatchLine[]>();
  for (const m of matches) {
    if (m.status !== "pending" || !m.dueBy || !bothReal(m) || now > m.dueBy) continue;
    // Round-robin weeks that haven't started yet aren't nagged about.
    if (m.stage === "pool" && (m.round ?? 0) > week) continue;
    if (!reminderDue(m.reminderSentAt, now)) continue;
    await tx.update(schema.matches).set({ reminderSentAt: now }).where(eq(schema.matches.id, m.id));
    for (const id of [m.teamAId!, m.teamBId!]) remindersByTeam.set(id, [...(remindersByTeam.get(id) ?? []), line(m, id)]);
  }

  for (const [teamId, lines] of remindersByTeam) {
    const team = teams.get(teamId)!;
    lines.sort((a, b) => a.dueBy.getTime() - b.dueBy.getTime());
    for (const p of team.players) {
      out.outbox.push(
        matchReminderEmail(p, {
          tournamentName: tournament.name,
          teamName: team.name,
          matches: lines,
          halfwayDueBy: halfwayDueBy(season),
          halfwayWeek: halfwayWeek(season),
        }),
      );
      out.reminderEmails++;
    }
  }
  return out;
}
