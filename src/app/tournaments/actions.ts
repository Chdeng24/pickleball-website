"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { requireMember } from "@/lib/session";
import { db, schema } from "@/db";
import { withTransaction } from "@/db/pool";
import { checkMatchScore } from "@/lib/matchscore";
import { invitePartner, leaveLeague, LeagueError, registerForLeague, respondToInvite } from "@/lib/league";
import { sendPartnerInvite, sendScoreReported } from "@/lib/email";

export type ActionResult = { ok: boolean; error?: string; message?: string };

class ActionError extends Error {}

/** Known failures come back as a readable message; anything unexpected is logged and still returns one instead of an error page. */
function fail(e: unknown): ActionResult {
  if (e instanceof LeagueError || e instanceof ActionError) return { ok: false, error: e.message };
  console.error("league action failed", e);
  return { ok: false, error: "Something went wrong — nothing was saved. Try again." };
}

function refresh() {
  revalidatePath("/tournaments");
  revalidatePath("/dashboard");
}

const registerSchema = z.object({
  tournamentId: z.uuid(),
  teamName: z.string().trim().max(60, "Keep the team name under 60 characters."),
  partnerEmail: z.union([z.literal(""), z.email("That partner email doesn't look right.")]),
});

export async function registerTeam(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = registerSchema.safeParse({
    tournamentId: formData.get("tournamentId"),
    teamName: String(formData.get("teamName") ?? ""),
    partnerEmail: String(formData.get("partnerEmail") ?? "").trim(),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  let result;
  try {
    result = await registerForLeague({
      tournamentId: parsed.data.tournamentId,
      userId: user.id,
      teamName: parsed.data.teamName,
      partnerEmail: parsed.data.partnerEmail,
    });
  } catch (e) {
    return fail(e);
  }

  // After commit — a failed email never undoes a registration. The invite also shows on their Tournaments tab.
  if (result.partner) {
    await sendPartnerInvite(
      { email: result.partner.email, name: result.partner.name },
      {
        captainName: result.captain.name,
        tournamentName: result.league.name,
        teamName: result.teamName,
        location: result.league.location,
        registrationClosesAt: result.league.registrationClosesAt,
      },
    ).catch((err) => console.error("partner invite email failed", err));
  }

  refresh();
  return {
    ok: true,
    message: result.partner
      ? `You're in! Your partner has to accept before your team is complete.`
      : `You're in! Add a partner anytime before registration closes, or exec will pair you.`,
  };
}

const inviteSchema = z.object({
  teamId: z.uuid(),
  partnerEmail: z.email("Enter your partner's email."),
});

export async function invitePartnerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = inviteSchema.safeParse({
    teamId: formData.get("teamId"),
    partnerEmail: String(formData.get("partnerEmail") ?? "").trim(),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  let result;
  try {
    result = await invitePartner({ teamId: parsed.data.teamId, userId: user.id, partnerEmail: parsed.data.partnerEmail });
  } catch (e) {
    return fail(e);
  }

  await sendPartnerInvite(
    { email: result.partner.email, name: result.partner.name },
    {
      captainName: result.captain.name,
      tournamentName: result.league.name,
      teamName: result.teamName,
      location: result.league.location,
      registrationClosesAt: result.league.registrationClosesAt,
    },
  ).catch((err) => console.error("partner invite email failed", err));

  refresh();
  return { ok: true, message: "Invite sent." };
}

const teamIdSchema = z.uuid();

export async function respondToInviteAction(teamId: string, accept: boolean): Promise<ActionResult> {
  const user = await requireMember();
  if (!teamIdSchema.safeParse(teamId).success || typeof accept !== "boolean") {
    return { ok: false, error: "That invite is no longer open." };
  }
  try {
    await respondToInvite({ teamId, userId: user.id, accept });
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true };
}

export async function leaveLeagueAction(teamId: string): Promise<ActionResult> {
  const user = await requireMember();
  if (!teamIdSchema.safeParse(teamId).success) return { ok: false, error: "That team no longer exists." };
  try {
    await leaveLeague({ teamId, userId: user.id });
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true };
}

/* ── scores ───────────────────────────────────────────────────────────── */

const reportSchema = z.object({
  matchId: z.uuid(),
  games: z.array(z.tuple([z.number(), z.number()])).min(1).max(5),
});

/** Confirmed players on the given teams, with contact info for notifications. */
async function matchPlayers(teamIds: string[]) {
  return db()
    .select({
      teamId: schema.tmTeamMembers.teamId,
      memberId: schema.tmTeamMembers.memberId,
      email: schema.users.email,
      name: schema.users.name,
    })
    .from(schema.tmTeamMembers)
    .innerJoin(schema.users, eq(schema.tmTeamMembers.memberId, schema.users.id))
    .where(and(inArray(schema.tmTeamMembers.teamId, teamIds), eq(schema.tmTeamMembers.inviteStatus, "accepted")));
}

export async function reportScore(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("games") ?? ""));
  } catch {
    return { ok: false, error: "Enter the score for each game." };
  }
  const parsed = reportSchema.safeParse({ matchId: formData.get("matchId"), games: raw });
  if (!parsed.success) return { ok: false, error: "Enter the score for each game." };

  const check = checkMatchScore(parsed.data.games);
  if (!check.ok) return { ok: false, error: check.error };

  let notify: { email: string; name: string | null }[] = [];
  let tournamentName = "your league";
  try {
    await withTransaction(async (tx) => {
      const [match] = await tx
        .select()
        .from(schema.matches)
        .where(eq(schema.matches.id, parsed.data.matchId))
        .for("update");
      if (!match || !match.teamAId || !match.teamBId) throw new ActionError("That match no longer exists.");
      if (match.status !== "pending") throw new ActionError("This match already has a score reported.");

      const [tournament] = await tx.select().from(schema.tournaments).where(eq(schema.tournaments.id, match.tournamentId));
      if (!tournament?.poolsAnnouncedAt || tournament.status === "complete") {
        throw new ActionError("Scores can only be reported while the league is being played.");
      }

      const players = await matchPlayers([match.teamAId, match.teamBId]);
      if (!players.some((p) => p.memberId === user.id)) throw new ActionError("You're not playing in this match.");

      await tx.insert(schema.matchReports).values({
        matchId: match.id,
        reportedBy: user.id,
        games: parsed.data.games,
        winnerTeamId: check.winner === "A" ? match.teamAId : match.teamBId,
      });
      await tx.update(schema.matches).set({ status: "reported" }).where(eq(schema.matches.id, match.id));

      tournamentName = tournament.name;
      notify = players.filter((p) => p.memberId !== user.id);
    });
  } catch (e) {
    return fail(e);
  }

  const summary = parsed.data.games.map(([a, b]) => `${a}-${b}`).join(", ");
  for (const p of notify) {
    await sendScoreReported(
      { email: p.email, name: p.name },
      { tournamentName, reporterName: user.name ?? null, summary },
    ).catch((err) => console.error("score-reported email failed", err));
  }

  refresh();
  return { ok: true, message: "Score submitted — it confirms automatically unless someone disputes it." };
}

const disputeSchema = z.object({ matchId: z.uuid(), reason: z.string().trim().min(1, "Say what's wrong.").max(500) });

export async function disputeScore(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = disputeSchema.safeParse({ matchId: formData.get("matchId"), reason: formData.get("reason") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    await withTransaction(async (tx) => {
      const [match] = await tx
        .select()
        .from(schema.matches)
        .where(eq(schema.matches.id, parsed.data.matchId))
        .for("update");
      if (!match || match.status !== "reported" || !match.teamAId || !match.teamBId) {
        throw new ActionError("There's no reported score to dispute on this match.");
      }

      const players = await matchPlayers([match.teamAId, match.teamBId]);
      if (!players.some((p) => p.memberId === user.id)) throw new ActionError("You're not playing in this match.");

      const [report] = await tx.select().from(schema.matchReports).where(eq(schema.matchReports.matchId, match.id));
      if (!report || report.confirmedAt) throw new ActionError("That score is already confirmed.");
      if (report.reportedBy === user.id) throw new ActionError("You can't dispute your own report.");

      await tx
        .update(schema.matchReports)
        .set({ disputedBy: user.id, disputeReason: parsed.data.reason })
        .where(eq(schema.matchReports.id, report.id));
      await tx.update(schema.matches).set({ status: "disputed" }).where(eq(schema.matches.id, match.id));
    });
  } catch (e) {
    return fail(e);
  }

  refresh();
  return { ok: true, message: "Disputed — an admin will sort it out." };
}
