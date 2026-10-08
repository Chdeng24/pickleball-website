"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireMember } from "@/lib/session";
import { withTransaction } from "@/db/pool";
import { AlreadyDone, invitePartner, leaveLeague, LeagueError, registerForLeague, respondToInvite } from "@/lib/league";
import { outOfTownEmail, sendMany, sendPartnerInvite, sendScoreReported, skipForfeitEmail } from "@/lib/email";
import { laInputToUtc } from "@/lib/dates";
import { confirmScoreTx, disputeScoreTx, postMatchTimeTx, reportScoreTx, skipMatchTx } from "@/lib/match-actions";

export type ActionResult = { ok: boolean; error?: string; message?: string };

/** Known failures come back as a readable message; anything unexpected is logged and still returns one instead of an error page. */
function fail(e: unknown): ActionResult {
  if (e instanceof AlreadyDone) {
    refresh();
    return { ok: true, message: e.message };
  }
  if (e instanceof LeagueError) return { ok: false, error: e.message };
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
/* The rules live in src/lib/match-actions.ts (tested in npm run test:season); these just validate input, run them, and email. */

const reportSchema = z.object({
  matchId: z.uuid(),
  games: z.array(z.tuple([z.number(), z.number()])).min(1).max(5),
});

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

  let result;
  try {
    result = await withTransaction((tx) => reportScoreTx(tx, { userId: user.id, matchId: parsed.data.matchId, games: parsed.data.games }));
  } catch (e) {
    return fail(e);
  }

  const summary = parsed.data.games.map(([a, b]) => `${a}-${b}`).join(", ");
  for (const p of result.notify) {
    await sendScoreReported(
      { email: p.email, name: p.name },
      { tournamentName: result.tournamentName, reporterName: user.name ?? null, summary },
    ).catch((err) => console.error("score-reported email failed", err));
  }

  refresh();
  return { ok: true, message: "Score submitted — the other team can confirm it, or it confirms automatically unless disputed." };
}

/** The other team agrees with the reported score — confirms it now instead of waiting out the dispute window. */
export async function confirmScore(matchId: string): Promise<ActionResult> {
  const user = await requireMember();
  if (!z.uuid().safeParse(matchId).success) return { ok: false, error: "That match no longer exists." };
  try {
    await withTransaction((tx) => confirmScoreTx(tx, { userId: user.id, matchId }));
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true, message: "Score confirmed." };
}

/** "Can't make it this week": the team's first skip becomes a makeup next week; after that it's a forfeit. */
export async function skipMatch(matchId: string, expect: "makeup" | "forfeit"): Promise<ActionResult> {
  const user = await requireMember();
  if (!z.uuid().safeParse(matchId).success) return { ok: false, error: "That match no longer exists." };
  if (expect !== "makeup" && expect !== "forfeit") return { ok: false, error: "Refresh the page and try again." };

  let result;
  try {
    result = await withTransaction((tx) => skipMatchTx(tx, { userId: user.id, matchId, expect }));
  } catch (e) {
    return fail(e);
  }

  refresh();
  if (result.outcome === "forfeit") {
    await sendMany(result.notify.map((p) => skipForfeitEmail(p, result.mail)));
    return { ok: true, message: `Recorded as a forfeit — ${result.mail.otherTeam} gets the win. Everyone in the match was emailed.` };
  }
  await sendMany(result.notify.map((p) => outOfTownEmail(p, result.mail)));
  return { ok: true, message: "Done — it's now a makeup due next Sunday. That was your team's one skip for the season. Your opponents were emailed." };
}

const postTimeSchema = z.object({
  matchId: z.uuid(),
  when: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a day and time."),
  note: z.string().trim().max(80, "Keep the note short."),
});

/** "We're playing Thursday 7 PM, Court 3" — due Wednesday 11:59 PM each week. */
export async function postMatchTime(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = postTimeSchema.safeParse({
    matchId: formData.get("matchId"),
    when: String(formData.get("when") ?? ""),
    note: String(formData.get("note") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    // The input is Pacific wall-clock time — never `new Date(str)`.
    const when = laInputToUtc(parsed.data.when);
    await withTransaction((tx) => postMatchTimeTx(tx, { userId: user.id, matchId: parsed.data.matchId, when, note: parsed.data.note }));
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true, message: "Match time posted." };
}

const disputeSchema = z.object({ matchId: z.uuid(), reason: z.string().trim().min(1, "Say what's wrong.").max(500) });

export async function disputeScore(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireMember();
  const parsed = disputeSchema.safeParse({ matchId: formData.get("matchId"), reason: formData.get("reason") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  try {
    await withTransaction((tx) => disputeScoreTx(tx, { userId: user.id, matchId: parsed.data.matchId, reason: parsed.data.reason }));
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true, message: "Disputed — an admin will sort it out." };
}
