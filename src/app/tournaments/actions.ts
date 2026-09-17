"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireMember } from "@/lib/session";
import { db, schema } from "@/db";
import { checkMatchScore, type GameScore } from "@/lib/matchscore";
import { sendPartnerInvite, sendScoreReported } from "@/lib/email";

export type ActionResult = { ok: boolean; error?: string };

const registerSchema = z.object({
  tournamentId: z.uuid(),
  teamName: z.string().trim().max(80).optional(),
  partnerEmail: z.email().optional().or(z.literal("")),
});

export async function registerTeam(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { tournamentId, teamName, partnerEmail } = parsed.data;

  const [tournament] = await db().select().from(schema.tournaments).where(eq(schema.tournaments.id, tournamentId));
  if (!tournament) return { ok: false, error: "That tournament no longer exists." };
  if (tournament.status !== "registration") return { ok: false, error: "Registration isn't open." };
  if (tournament.registrationClosesAt && tournament.registrationClosesAt < new Date()) {
    return { ok: false, error: "Registration has closed." };
  }
  if (tournament.eligibility === "competitive_only" && !user.onCompetitiveTeam) {
    return { ok: false, error: "This tournament is for Competitive Team members only." };
  }

  const myMemberships = await db().query.tmTeamMembers.findMany({
    where: and(eq(schema.tmTeamMembers.memberId, user.id), eq(schema.tmTeamMembers.inviteStatus, "accepted")),
    with: { team: true },
  });
  if (myMemberships.some((m) => m.team.tournamentId === tournamentId && m.team.status !== "withdrawn")) {
    return { ok: false, error: "You're already registered for this tournament." };
  }

  let partner: { id: string; email: string | null; name: string | null } | null = null;
  if (partnerEmail) {
    const [found] = await db()
      .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.email, partnerEmail.toLowerCase()));
    if (!found) {
      return { ok: false, error: "That email doesn't have an account on the site yet." };
    }
    partner = found;
  }

  const [team] = await db()
    .insert(schema.tmTeams)
    .values({
      tournamentId,
      name: teamName || (partner ? `${user.name?.split(" ")[0] ?? "Team"} & ${partner.name?.split(" ")[0] ?? "Partner"}` : user.name || "Free agent"),
      status: "registered",
    })
    .returning();

  await db().insert(schema.tmTeamMembers).values({
    teamId: team.id,
    memberId: user.id,
    isCaptain: true,
    inviteStatus: "accepted",
  });

  if (partner) {
    await db().insert(schema.tmTeamMembers).values({
      teamId: team.id,
      memberId: partner.id,
      isCaptain: false,
      inviteStatus: "pending",
    });
    if (partner.email) {
      await sendPartnerInvite(
        { email: partner.email, name: partner.name },
        { captainName: user.name ?? null, tournamentName: tournament.name },
      ).catch((err) => console.error("partner invite email failed", err));
    }
  }

  revalidatePath("/tournaments");
  return { ok: true };
}

export async function respondToInvite(teamId: string, accept: boolean): Promise<ActionResult> {
  const user = await requireMember();

  const [row] = await db()
    .select()
    .from(schema.tmTeamMembers)
    .where(and(eq(schema.tmTeamMembers.teamId, teamId), eq(schema.tmTeamMembers.memberId, user.id)));
  if (!row || row.inviteStatus !== "pending") {
    return { ok: false, error: "No pending invite found." };
  }

  await db()
    .update(schema.tmTeamMembers)
    .set({ inviteStatus: accept ? "accepted" : "declined" })
    .where(and(eq(schema.tmTeamMembers.teamId, teamId), eq(schema.tmTeamMembers.memberId, user.id)));

  revalidatePath("/tournaments");
  return { ok: true };
}

const reportSchema = z.object({
  matchId: z.uuid(),
  games: z.string(), // JSON-encoded GameScore[]
});

export async function reportScore(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = reportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  let games: GameScore[];
  try {
    games = JSON.parse(parsed.data.games);
  } catch {
    return { ok: false, error: "Invalid score format." };
  }

  const check = checkMatchScore(games);
  if (!check.ok) return { ok: false, error: check.error };

  const [match] = await db().select().from(schema.matches).where(eq(schema.matches.id, parsed.data.matchId));
  if (!match || !match.teamAId || !match.teamBId) return { ok: false, error: "That match no longer exists." };
  if (match.status !== "pending") return { ok: false, error: "This match already has a reported score." };

  const players = await db()
    .select({ teamId: schema.tmTeamMembers.teamId, memberId: schema.tmTeamMembers.memberId })
    .from(schema.tmTeamMembers)
    .where(
      and(
        eq(schema.tmTeamMembers.memberId, user.id),
        eq(schema.tmTeamMembers.inviteStatus, "accepted"),
      ),
    );
  const myTeamId = players.find((p) => p.teamId === match.teamAId || p.teamId === match.teamBId)?.teamId;
  if (!myTeamId) return { ok: false, error: "You're not on either team for this match." };

  const winnerTeamId = check.winner === "A" ? match.teamAId : match.teamBId;

  await db().insert(schema.matchReports).values({
    matchId: match.id,
    reportedBy: user.id,
    games,
    winnerTeamId,
  });
  await db().update(schema.matches).set({ status: "reported" }).where(eq(schema.matches.id, match.id));

  const tournament = await db().query.tournaments.findFirst({ where: eq(schema.tournaments.id, match.tournamentId) });
  const everyone = await db().query.tmTeamMembers.findMany({
    where: and(eq(schema.tmTeamMembers.inviteStatus, "accepted")),
    with: { member: true },
  });
  const notify = everyone.filter(
    (p) => (p.teamId === match.teamAId || p.teamId === match.teamBId) && p.memberId !== user.id,
  );
  const summary = games.map(([a, b]) => `${a}-${b}`).join(", ");
  for (const p of notify) {
    if (!p.member.email) continue;
    await sendScoreReported(
      { email: p.member.email, name: p.member.name },
      { tournamentName: tournament?.name ?? "your tournament", reporterName: user.name ?? null, summary },
    ).catch((err) => console.error("score-reported email failed", err));
  }

  revalidatePath("/tournaments");
  return { ok: true };
}

const disputeSchema = z.object({ matchId: z.uuid(), reason: z.string().trim().min(1).max(500) });

export async function disputeScore(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = disputeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: "Invalid input." };

  const [match] = await db().select().from(schema.matches).where(eq(schema.matches.id, parsed.data.matchId));
  if (!match || match.status !== "reported") return { ok: false, error: "No pending report to dispute." };

  const [report] = await db()
    .select()
    .from(schema.matchReports)
    .where(and(eq(schema.matchReports.matchId, match.id)))
    .orderBy(schema.matchReports.createdAt);
  if (!report) return { ok: false, error: "No report found for this match." };
  if (report.reportedBy === user.id) return { ok: false, error: "You can't dispute your own report." };

  await db()
    .update(schema.matchReports)
    .set({ disputedBy: user.id, disputeReason: parsed.data.reason })
    .where(eq(schema.matchReports.id, report.id));
  await db().update(schema.matches).set({ status: "disputed" }).where(eq(schema.matches.id, match.id));

  revalidatePath("/tournaments");
  return { ok: true };
}
