import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { withTransaction, type Tx } from "@/db/pool";
import { db, schema } from "@/db";
import {
  defaultTeamName,
  hasRoom,
  isRegistrationOpen,
  partnerProblem,
  spotsLeft,
  type PartnerProblem,
} from "@/lib/league-rules";

/**
 * Pickleball League registration writes. Every function here runs in ONE
 * transaction that locks the league row first (so two people can't take the
 * last spot at the same moment), then the involved users in id order (so one
 * person can't land in two leagues via two simultaneous clicks, and two
 * captains inviting each other can't deadlock).
 *
 * The `...Tx` variants take an open transaction so they can be exercised
 * against the real database inside a rolled-back transaction.
 */

export class LeagueError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const ACTIVE_STATUSES = ["registration", "pools", "knockout"] as const;

type League = typeof schema.tournaments.$inferSelect;
type UserRow = {
  id: string;
  name: string | null;
  email: string;
  status: "pending" | "approved" | "blocked";
  onCompetitiveTeam: boolean;
};

async function lockLeague(tx: Tx, tournamentId: string): Promise<League> {
  const [league] = await tx
    .select()
    .from(schema.tournaments)
    .where(eq(schema.tournaments.id, tournamentId))
    .for("update");
  if (!league || league.kind !== "im_semester") throw new LeagueError("That league no longer exists.");
  return league;
}

async function lockUsers(tx: Tx, ids: string[]): Promise<Map<string, UserRow>> {
  const out = new Map<string, UserRow>();
  for (const id of [...new Set(ids)].sort()) {
    const [row] = await tx
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        status: schema.users.status,
        onCompetitiveTeam: schema.users.onCompetitiveTeam,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .for("update");
    if (row) out.set(id, row);
  }
  return out;
}

async function findUserIdByEmail(tx: Tx, email: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email.trim().toLowerCase()}`);
  return row?.id ?? null;
}

/** Players holding a spot in a league: accepted, or invited and not yet answered, on a team that hasn't withdrawn. */
async function countSpots(tx: Tx, tournamentId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.tmTeamMembers)
    .innerJoin(schema.tmTeams, eq(schema.tmTeamMembers.teamId, schema.tmTeams.id))
    .where(
      and(
        eq(schema.tmTeams.tournamentId, tournamentId),
        ne(schema.tmTeams.status, "withdrawn"),
        inArray(schema.tmTeamMembers.inviteStatus, ["accepted", "pending"]),
      ),
    );
  return row?.n ?? 0;
}

/** The active league this person is confirmed on a team in, if any. */
async function committedLeague(tx: Tx, userId: string): Promise<{ id: string; name: string } | null> {
  const [row] = await tx
    .select({ id: schema.tournaments.id, name: schema.tournaments.name })
    .from(schema.tmTeamMembers)
    .innerJoin(schema.tmTeams, eq(schema.tmTeamMembers.teamId, schema.tmTeams.id))
    .innerJoin(schema.tournaments, eq(schema.tmTeams.tournamentId, schema.tournaments.id))
    .where(
      and(
        eq(schema.tmTeamMembers.memberId, userId),
        eq(schema.tmTeamMembers.inviteStatus, "accepted"),
        ne(schema.tmTeams.status, "withdrawn"),
        inArray(schema.tournaments.status, [...ACTIVE_STATUSES]),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Once someone commits to a team, every other invite they had is answered for them — those captains see "declined" and can invite someone else. */
async function declineOtherInvites(tx: Tx, userId: string, keepTeamId: string): Promise<void> {
  await tx
    .update(schema.tmTeamMembers)
    .set({ inviteStatus: "declined" })
    .where(
      and(
        eq(schema.tmTeamMembers.memberId, userId),
        eq(schema.tmTeamMembers.inviteStatus, "pending"),
        ne(schema.tmTeamMembers.teamId, keepTeamId),
      ),
    );
}

function partnerMessage(problem: PartnerProblem, email: string, committed: { name: string } | null): string {
  switch (problem) {
    case "self":
      return "That's your own email — enter your partner's.";
    case "no_account":
      return `${email} hasn't signed in to the site yet. Have them sign in once at pickleballatberkeley.com, then invite them — or register now without a partner and add them later.`;
    case "not_approved":
      return `${email} isn't an approved member yet, so they can't join a team. An exec needs to approve them first.`;
    case "not_comp":
      return `${email} isn't on the Competitive Team, and this league is Competitive-Team only.`;
    case "committed":
      return `${email} is already on a team in the ${committed?.name ?? "another league"}.`;
  }
}

function fullMessage(league: League, taken: number, needed: number): string {
  const left = spotsLeft(taken, league.maxPlayers) ?? 0;
  if (left === 0) return "This league is full.";
  if (needed === 2 && left === 1) return "Only 1 spot left — register without a partner to take it.";
  return `Only ${left} spot${left === 1 ? "" : "s"} left.`;
}

async function assertPartnerAllowed(tx: Tx, league: League, self: UserRow, partner: UserRow | null, email: string) {
  const committed = partner ? await committedLeague(tx, partner.id) : null;
  const problem = partnerProblem({
    selfId: self.id,
    partner,
    requiresComp: league.eligibility === "competitive_only",
    committedLeague: committed?.name ?? null,
  });
  if (problem) throw new LeagueError(partnerMessage(problem, email, committed));
}

/* ── member actions ───────────────────────────────────────────────────── */

export type RegisterResult = { league: League; teamId: string; teamName: string; captain: UserRow; partner: UserRow | null };

export async function registerForLeagueTx(
  tx: Tx,
  input: { tournamentId: string; userId: string; teamName?: string; partnerEmail?: string },
): Promise<RegisterResult> {
  const league = await lockLeague(tx, input.tournamentId);
  const partnerEmail = input.partnerEmail?.trim().toLowerCase() || null;
  const partnerId = partnerEmail ? await findUserIdByEmail(tx, partnerEmail) : null;

  const users = await lockUsers(tx, [input.userId, ...(partnerId ? [partnerId] : [])]);
  const me = users.get(input.userId);
  if (!me || me.status !== "approved") throw new LeagueError("Your account isn't approved yet.");

  if (!isRegistrationOpen(league, new Date())) throw new LeagueError("Registration for this league is closed.");
  if (league.eligibility === "competitive_only" && !me.onCompetitiveTeam) {
    throw new LeagueError("This league is for Competitive Team members only.");
  }

  const mine = await committedLeague(tx, me.id);
  if (mine) {
    throw new LeagueError(
      mine.id === league.id
        ? "You're already on a team in this league."
        : `You're already playing in the ${mine.name}. It's one league per person — leave that one first to switch.`,
    );
  }

  const partner = partnerId ? (users.get(partnerId) ?? null) : null;
  if (partnerEmail) await assertPartnerAllowed(tx, league, me, partner, partnerEmail);

  const needed = partner ? 2 : 1;
  const taken = await countSpots(tx, league.id);
  if (!hasRoom(taken, needed, league.maxPlayers)) throw new LeagueError(fullMessage(league, taken, needed));

  const teamName = input.teamName?.trim() || defaultTeamName(me, partner);
  const [team] = await tx
    .insert(schema.tmTeams)
    .values({ tournamentId: league.id, name: teamName, status: "registered" })
    .returning({ id: schema.tmTeams.id });

  await tx.insert(schema.tmTeamMembers).values({
    teamId: team.id,
    memberId: me.id,
    isCaptain: true,
    inviteStatus: "accepted",
  });
  if (partner) {
    await tx.insert(schema.tmTeamMembers).values({
      teamId: team.id,
      memberId: partner.id,
      isCaptain: false,
      inviteStatus: "pending",
    });
  }

  await declineOtherInvites(tx, me.id, team.id);
  return { league, teamId: team.id, teamName, captain: me, partner };
}

export type InviteResult = { league: League; teamName: string; captain: UserRow; partner: UserRow };

/** Add a partner to a team that doesn't have one — or replace an invite that was declined or never answered. */
export async function invitePartnerTx(
  tx: Tx,
  input: { teamId: string; userId: string; partnerEmail: string },
): Promise<InviteResult> {
  const [teamRef] = await tx
    .select({ tournamentId: schema.tmTeams.tournamentId })
    .from(schema.tmTeams)
    .where(eq(schema.tmTeams.id, input.teamId));
  if (!teamRef) throw new LeagueError("That team no longer exists.");

  const league = await lockLeague(tx, teamRef.tournamentId);
  const [team] = await tx.select().from(schema.tmTeams).where(eq(schema.tmTeams.id, input.teamId));
  if (!team || team.status === "withdrawn") throw new LeagueError("That team no longer exists.");
  if (!isRegistrationOpen(league, new Date())) throw new LeagueError("Registration for this league is closed.");

  const members = await tx.select().from(schema.tmTeamMembers).where(eq(schema.tmTeamMembers.teamId, team.id));
  const mine = members.find((m) => m.memberId === input.userId);
  if (!mine || mine.inviteStatus !== "accepted") throw new LeagueError("You're not on that team.");
  if (members.some((m) => m.memberId !== input.userId && m.inviteStatus === "accepted")) {
    throw new LeagueError("Your team already has a partner.");
  }

  const partnerEmail = input.partnerEmail.trim().toLowerCase();
  const partnerId = await findUserIdByEmail(tx, partnerEmail);
  const users = await lockUsers(tx, [input.userId, ...(partnerId ? [partnerId] : [])]);
  const me = users.get(input.userId)!;
  const partner = partnerId ? (users.get(partnerId) ?? null) : null;
  await assertPartnerAllowed(tx, league, me, partner, partnerEmail);

  // Replacing an unanswered invite hands its reserved spot to the new invite.
  const replacing = members.filter((m) => m.memberId !== input.userId && m.inviteStatus === "pending").length;
  const taken = await countSpots(tx, league.id);
  if (!hasRoom(taken - replacing, 1, league.maxPlayers)) throw new LeagueError(fullMessage(league, taken - replacing, 1));

  await tx
    .delete(schema.tmTeamMembers)
    .where(
      and(
        eq(schema.tmTeamMembers.teamId, team.id),
        ne(schema.tmTeamMembers.memberId, input.userId),
        ne(schema.tmTeamMembers.inviteStatus, "accepted"),
      ),
    );
  await tx.insert(schema.tmTeamMembers).values({
    teamId: team.id,
    memberId: partner!.id,
    isCaptain: false,
    inviteStatus: "pending",
  });

  let teamName = team.name;
  if (team.name === defaultTeamName(me)) {
    teamName = defaultTeamName(me, partner);
    await tx.update(schema.tmTeams).set({ name: teamName }).where(eq(schema.tmTeams.id, team.id));
  }

  return { league, teamName, captain: me, partner: partner! };
}

export async function respondToInviteTx(
  tx: Tx,
  input: { teamId: string; userId: string; accept: boolean },
): Promise<void> {
  const [teamRef] = await tx
    .select({ tournamentId: schema.tmTeams.tournamentId })
    .from(schema.tmTeams)
    .where(eq(schema.tmTeams.id, input.teamId));
  if (!teamRef) throw new LeagueError("That invite is no longer open.");

  const league = await lockLeague(tx, teamRef.tournamentId);
  const users = await lockUsers(tx, [input.userId]);
  const me = users.get(input.userId);

  const [row] = await tx
    .select()
    .from(schema.tmTeamMembers)
    .where(and(eq(schema.tmTeamMembers.teamId, input.teamId), eq(schema.tmTeamMembers.memberId, input.userId)));
  if (!row || row.inviteStatus !== "pending") throw new LeagueError("That invite is no longer open.");

  const setStatus = (inviteStatus: "accepted" | "declined") =>
    tx
      .update(schema.tmTeamMembers)
      .set({ inviteStatus })
      .where(and(eq(schema.tmTeamMembers.teamId, input.teamId), eq(schema.tmTeamMembers.memberId, input.userId)));

  if (!input.accept) {
    await setStatus("declined");
    return;
  }

  const [team] = await tx.select().from(schema.tmTeams).where(eq(schema.tmTeams.id, input.teamId));
  if (!team || team.status === "withdrawn") throw new LeagueError("That team withdrew, so the invite is closed.");
  // The spot was reserved before the deadline, so accepting stays open until the draw is made.
  if (league.status !== "registration") throw new LeagueError("The draw has already been made for this league.");
  if (!me || me.status !== "approved") throw new LeagueError("Your account isn't approved yet.");
  if (league.eligibility === "competitive_only" && !me.onCompetitiveTeam) {
    throw new LeagueError("This league is for Competitive Team members only.");
  }

  const mine = await committedLeague(tx, me.id);
  if (mine) {
    throw new LeagueError(
      `You're already on a team in the ${mine.name}. It's one league per person — leave that one first to accept this.`,
    );
  }

  const [full] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.tmTeamMembers)
    .where(and(eq(schema.tmTeamMembers.teamId, input.teamId), eq(schema.tmTeamMembers.inviteStatus, "accepted")));
  if ((full?.n ?? 0) >= 2) throw new LeagueError("That team already has two players.");

  await setStatus("accepted");
  await declineOtherInvites(tx, me.id, input.teamId);
}

/** Leave a team while registration is open. The last person out withdraws the team; otherwise the partner who stays becomes captain. */
export async function leaveLeagueTx(tx: Tx, input: { teamId: string; userId: string }): Promise<void> {
  const [teamRef] = await tx
    .select({ tournamentId: schema.tmTeams.tournamentId })
    .from(schema.tmTeams)
    .where(eq(schema.tmTeams.id, input.teamId));
  if (!teamRef) throw new LeagueError("That team no longer exists.");

  const league = await lockLeague(tx, teamRef.tournamentId);
  if (league.status !== "registration") {
    throw new LeagueError("The draw has already been made — ask an exec to withdraw you.");
  }

  const members = await tx
    .select({
      memberId: schema.tmTeamMembers.memberId,
      inviteStatus: schema.tmTeamMembers.inviteStatus,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.tmTeamMembers)
    .innerJoin(schema.users, eq(schema.tmTeamMembers.memberId, schema.users.id))
    .where(eq(schema.tmTeamMembers.teamId, input.teamId));

  const me = members.find((m) => m.memberId === input.userId && m.inviteStatus === "accepted");
  if (!me) throw new LeagueError("You're not on that team.");

  await tx
    .delete(schema.tmTeamMembers)
    .where(and(eq(schema.tmTeamMembers.teamId, input.teamId), eq(schema.tmTeamMembers.memberId, input.userId)));

  const stays = members.find((m) => m.memberId !== input.userId && m.inviteStatus === "accepted");
  if (!stays) {
    await tx.update(schema.tmTeams).set({ status: "withdrawn" }).where(eq(schema.tmTeams.id, input.teamId));
    await tx
      .update(schema.tmTeamMembers)
      .set({ inviteStatus: "declined" })
      .where(and(eq(schema.tmTeamMembers.teamId, input.teamId), eq(schema.tmTeamMembers.inviteStatus, "pending")));
    return;
  }

  await tx
    .update(schema.tmTeamMembers)
    .set({ isCaptain: true })
    .where(and(eq(schema.tmTeamMembers.teamId, input.teamId), eq(schema.tmTeamMembers.memberId, stays.memberId)));

  const [team] = await tx.select({ name: schema.tmTeams.name }).from(schema.tmTeams).where(eq(schema.tmTeams.id, input.teamId));
  if (team && (team.name === defaultTeamName(me, stays) || team.name === defaultTeamName(stays, me))) {
    await tx.update(schema.tmTeams).set({ name: defaultTeamName(stays) }).where(eq(schema.tmTeams.id, input.teamId));
  }
}

/* ── exec actions ─────────────────────────────────────────────────────── */

/** Merge two solo registrations into one team. The second team's player moves onto the first team; the second team is removed. */
export async function pairFreeAgentsTx(tx: Tx, input: { teamAId: string; teamBId: string }): Promise<void> {
  if (input.teamAId === input.teamBId) throw new LeagueError("Pick two different players.");

  const refs = await tx
    .select({ id: schema.tmTeams.id, tournamentId: schema.tmTeams.tournamentId })
    .from(schema.tmTeams)
    .where(inArray(schema.tmTeams.id, [input.teamAId, input.teamBId]));
  if (refs.length !== 2 || refs[0].tournamentId !== refs[1].tournamentId) {
    throw new LeagueError("Both players have to be in the same league.");
  }

  const league = await lockLeague(tx, refs[0].tournamentId);
  if (league.poolsAnnouncedAt) throw new LeagueError("Pools are already published — pairing is closed.");

  const members = await tx
    .select({
      teamId: schema.tmTeamMembers.teamId,
      memberId: schema.tmTeamMembers.memberId,
      inviteStatus: schema.tmTeamMembers.inviteStatus,
      name: schema.users.name,
      email: schema.users.email,
      teamStatus: schema.tmTeams.status,
      teamName: schema.tmTeams.name,
    })
    .from(schema.tmTeamMembers)
    .innerJoin(schema.users, eq(schema.tmTeamMembers.memberId, schema.users.id))
    .innerJoin(schema.tmTeams, eq(schema.tmTeamMembers.teamId, schema.tmTeams.id))
    .where(inArray(schema.tmTeamMembers.teamId, [input.teamAId, input.teamBId]));

  const soloPlayer = (teamId: string) => {
    const rows = members.filter((m) => m.teamId === teamId);
    const accepted = rows.filter((m) => m.inviteStatus === "accepted");
    const pending = rows.filter((m) => m.inviteStatus === "pending");
    if (rows[0]?.teamStatus === "withdrawn" || accepted.length !== 1 || pending.length > 0) return null;
    return accepted[0];
  };
  const a = soloPlayer(input.teamAId);
  const b = soloPlayer(input.teamBId);
  if (!a || !b) throw new LeagueError("Both teams need to be a single player with no invite out.");

  await tx.delete(schema.tmTeams).where(eq(schema.tmTeams.id, input.teamBId));
  await tx
    .delete(schema.tmTeamMembers)
    .where(and(eq(schema.tmTeamMembers.teamId, input.teamAId), ne(schema.tmTeamMembers.inviteStatus, "accepted")));
  await tx.insert(schema.tmTeamMembers).values({
    teamId: input.teamAId,
    memberId: b.memberId,
    isCaptain: false,
    inviteStatus: "accepted",
  });
  await declineOtherInvites(tx, b.memberId, input.teamAId);

  if (a.teamName === defaultTeamName(a)) {
    await tx.update(schema.tmTeams).set({ name: defaultTeamName(a, b) }).where(eq(schema.tmTeams.id, input.teamAId));
  }
}

/* ── wrappers the server actions call ─────────────────────────────────── */

export const registerForLeague = (input: Parameters<typeof registerForLeagueTx>[1]) =>
  withTransaction((tx) => registerForLeagueTx(tx, input));
export const invitePartner = (input: Parameters<typeof invitePartnerTx>[1]) =>
  withTransaction((tx) => invitePartnerTx(tx, input));
export const respondToInvite = (input: Parameters<typeof respondToInviteTx>[1]) =>
  withTransaction((tx) => respondToInviteTx(tx, input));
export const leaveLeague = (input: Parameters<typeof leaveLeagueTx>[1]) =>
  withTransaction((tx) => leaveLeagueTx(tx, input));
export const pairFreeAgents = (input: Parameters<typeof pairFreeAgentsTx>[1]) =>
  withTransaction((tx) => pairFreeAgentsTx(tx, input));

/* ── reads ────────────────────────────────────────────────────────────── */

/** Spots held per league, for list views. */
export async function spotsTakenByLeague(tournamentIds: string[]): Promise<Map<string, number>> {
  if (tournamentIds.length === 0) return new Map();
  const rows = await db()
    .select({ tournamentId: schema.tmTeams.tournamentId, n: sql<number>`count(*)::int` })
    .from(schema.tmTeamMembers)
    .innerJoin(schema.tmTeams, eq(schema.tmTeamMembers.teamId, schema.tmTeams.id))
    .where(
      and(
        inArray(schema.tmTeams.tournamentId, tournamentIds),
        ne(schema.tmTeams.status, "withdrawn"),
        inArray(schema.tmTeamMembers.inviteStatus, ["accepted", "pending"]),
      ),
    )
    .groupBy(schema.tmTeams.tournamentId);
  return new Map(rows.map((r) => [r.tournamentId, r.n]));
}

/** Every league membership row for one person, with enough context to decide each league card's state. */
export async function membershipsFor(userId: string) {
  return db()
    .select({
      tournamentId: schema.tournaments.id,
      tournamentName: schema.tournaments.name,
      tournamentStatus: schema.tournaments.status,
      teamId: schema.tmTeams.id,
      teamStatus: schema.tmTeams.status,
      teamPool: schema.tmTeams.pool,
      inviteStatus: schema.tmTeamMembers.inviteStatus,
    })
    .from(schema.tmTeamMembers)
    .innerJoin(schema.tmTeams, eq(schema.tmTeamMembers.teamId, schema.tmTeams.id))
    .innerJoin(schema.tournaments, eq(schema.tmTeams.tournamentId, schema.tournaments.id))
    .where(eq(schema.tmTeamMembers.memberId, userId));
}

/** Members of the given teams with names, for partner/invite display. */
export async function teamMembers(teamIds: string[]) {
  if (teamIds.length === 0) return [];
  return db()
    .select({
      teamId: schema.tmTeamMembers.teamId,
      memberId: schema.tmTeamMembers.memberId,
      isCaptain: schema.tmTeamMembers.isCaptain,
      inviteStatus: schema.tmTeamMembers.inviteStatus,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.tmTeamMembers)
    .innerJoin(schema.users, eq(schema.tmTeamMembers.memberId, schema.users.id))
    .where(inArray(schema.tmTeamMembers.teamId, teamIds));
}
