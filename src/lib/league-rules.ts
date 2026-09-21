/**
 * Pickleball League rules as pure functions — capacity, eligibility, partner
 * checks, and which state a member's league card is in. No DB, no server-only,
 * so every rule here is unit tested (league-rules.test.ts) and the DB layer
 * (league.ts) only has to fetch data and call these.
 */

export type InviteStatus = "pending" | "accepted" | "declined";
export type TeamStatus = "registered" | "active" | "eliminated" | "forfeited" | "withdrawn";
export type LeagueStatus = "draft" | "registration" | "pools" | "knockout" | "complete";
export type Division = "beginner" | "advanced" | "competitive";
export type Eligibility = "all" | "competitive_only";

/** Leagues that still occupy a person's one-league-at-a-time slot. */
export function isActiveLeague(status: LeagueStatus): boolean {
  return status === "registration" || status === "pools" || status === "knockout";
}

/** Accepted players, and unanswered invites, both hold a spot — until the team withdraws. */
export function holdsSpot(inviteStatus: InviteStatus, teamStatus: TeamStatus): boolean {
  return teamStatus !== "withdrawn" && (inviteStatus === "accepted" || inviteStatus === "pending");
}

export function hasRoom(taken: number, needed: number, maxPlayers: number | null): boolean {
  return maxPlayers === null || taken + needed <= maxPlayers;
}

export function spotsLeft(taken: number, maxPlayers: number | null): number | null {
  return maxPlayers === null ? null : Math.max(0, maxPlayers - taken);
}

export function isRegistrationOpen(
  league: { status: LeagueStatus; registrationClosesAt: Date | null },
  now: Date,
): boolean {
  return league.status === "registration" && (!league.registrationClosesAt || league.registrationClosesAt > now);
}

export function onDomain(email: string, domain: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${domain.trim().toLowerCase()}`);
}

type Person = { name: string | null; email: string | null };

export function firstName(p: Person): string {
  const fromName = p.name?.trim().split(/\s+/)[0];
  if (fromName) return fromName;
  const local = p.email?.split("@")[0];
  return local || "Player";
}

export function defaultTeamName(captain: Person, partner?: Person | null): string {
  return partner ? `${firstName(captain)} & ${firstName(partner)}` : `${firstName(captain)}'s team`;
}

const DIVISION_ORDER: Record<Division, number> = { beginner: 0, advanced: 1, competitive: 2 };

export function sortLeagues<T extends { division: Division; name: string }>(leagues: T[]): T[] {
  return [...leagues].sort(
    (a, b) => DIVISION_ORDER[a.division] - DIVISION_ORDER[b.division] || a.name.localeCompare(b.name),
  );
}

/**
 * Pulls every email out of whatever exec pasted — one per line, comma lists,
 * a CSV export, even a copy of the Google Contacts page. Lines with no "@" at
 * all (names, labels) are ignored; lines with an "@" that isn't a valid
 * address are returned so exec can see the typo.
 */
export function parseEmailList(text: string): { emails: string[]; rejected: string[] } {
  const EMAIL = /[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
  const emails = new Set<string>();
  const rejected: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.includes("@")) continue;
    const found = line.match(EMAIL);
    if (!found) {
      rejected.push(line);
      continue;
    }
    for (const e of found) emails.add(e.toLowerCase());
  }
  return { emails: [...emails], rejected };
}

export type PartnerCandidate = {
  id: string;
  status: "pending" | "approved" | "blocked";
  onCompetitiveTeam: boolean;
};

export type PartnerProblem = "self" | "no_account" | "not_approved" | "not_comp" | "committed";

/** Why this person can't be invited — null means they can. `committedLeague` is the name of an active league they're already playing in. */
export function partnerProblem(input: {
  selfId: string;
  partner: PartnerCandidate | null;
  requiresComp: boolean;
  committedLeague: string | null;
}): PartnerProblem | null {
  const { selfId, partner, requiresComp, committedLeague } = input;
  if (!partner) return "no_account";
  if (partner.id === selfId) return "self";
  if (partner.status !== "approved") return "not_approved";
  if (requiresComp && !partner.onCompetitiveTeam) return "not_comp";
  if (committedLeague) return "committed";
  return null;
}

export type TeamMemberView = {
  memberId: string;
  isCaptain: boolean;
  inviteStatus: InviteStatus;
  name: string | null;
  email: string | null;
};

/** A team goes into the draw only with exactly two confirmed players and no invite still hanging. */
export function isDrawReady(members: Pick<TeamMemberView, "inviteStatus">[]): boolean {
  const accepted = members.filter((m) => m.inviteStatus === "accepted").length;
  const pending = members.filter((m) => m.inviteStatus === "pending").length;
  return accepted === 2 && pending === 0;
}

export type Readiness = "ready" | "waiting_on_partner" | "needs_partner";

export function teamReadiness(members: Pick<TeamMemberView, "inviteStatus">[]): Readiness {
  const accepted = members.filter((m) => m.inviteStatus === "accepted").length;
  const pending = members.filter((m) => m.inviteStatus === "pending").length;
  if (accepted >= 2) return "ready";
  if (pending > 0) return "waiting_on_partner";
  return "needs_partner";
}

/** The other person on a viewer's team, preferring someone still in play over someone who declined. */
export function partnerOf(members: TeamMemberView[], viewerId: string): TeamMemberView | null {
  const others = members.filter((m) => m.memberId !== viewerId);
  return (
    others.find((m) => m.inviteStatus === "accepted") ??
    others.find((m) => m.inviteStatus === "pending") ??
    others.find((m) => m.inviteStatus === "declined") ??
    null
  );
}

export type MembershipView = {
  tournamentId: string;
  tournamentName: string;
  tournamentStatus: LeagueStatus;
  teamId: string;
  teamStatus: TeamStatus;
  teamPool: string | null;
  inviteStatus: InviteStatus;
};

export type LeagueCardState =
  | { kind: "on_team"; teamId: string; phase: "registration" | "drafting" | "live" | "not_drawn" }
  | { kind: "committed_elsewhere"; leagueName: string }
  | { kind: "invited"; teamIds: string[] }
  | { kind: "closed" }
  | { kind: "not_eligible" }
  | { kind: "full" }
  | { kind: "can_register" };

/** Exactly one card state per league per member — the precedence here is the UX. */
export function leagueCardState(input: {
  league: {
    id: string;
    status: LeagueStatus;
    registrationClosesAt: Date | null;
    eligibility: Eligibility;
    poolsAnnouncedAt: Date | null;
    maxPlayers: number | null;
  };
  memberships: MembershipView[];
  isComp: boolean;
  spotsTaken: number;
  now: Date;
}): LeagueCardState {
  const { league, memberships, isComp, spotsTaken, now } = input;

  const committed = memberships.filter(
    (m) => m.inviteStatus === "accepted" && m.teamStatus !== "withdrawn" && isActiveLeague(m.tournamentStatus),
  );

  const here = committed.find((m) => m.tournamentId === league.id);
  if (here) {
    const phase =
      league.status === "registration"
        ? "registration"
        : !league.poolsAnnouncedAt
          ? "drafting"
          : here.teamPool
            ? "live"
            : "not_drawn";
    return { kind: "on_team", teamId: here.teamId, phase };
  }

  const elsewhere = committed.find((m) => m.tournamentId !== league.id);
  if (elsewhere) return { kind: "committed_elsewhere", leagueName: elsewhere.tournamentName };

  const invites = memberships.filter(
    (m) => m.tournamentId === league.id && m.inviteStatus === "pending" && m.teamStatus !== "withdrawn",
  );
  // A spot was reserved for them before the deadline, so an invite stays
  // answerable until exec actually runs the draw — not just until the clock.
  if (invites.length > 0 && league.status === "registration") {
    return { kind: "invited", teamIds: invites.map((m) => m.teamId) };
  }

  if (!isRegistrationOpen(league, now)) return { kind: "closed" };
  if (league.eligibility === "competitive_only" && !isComp) return { kind: "not_eligible" };
  if (!hasRoom(spotsTaken, 1, league.maxPlayers)) return { kind: "full" };
  return { kind: "can_register" };
}
