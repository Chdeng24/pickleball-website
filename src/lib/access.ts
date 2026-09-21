/**
 * Access control, kept as pure functions so the rules are readable and testable
 * without a database or a live Google session.
 */

export type Role = "member" | "exec" | "admin";
export type MemberStatus = "pending" | "approved" | "blocked";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Gate 1 — may this Google account sign in at all?
 *
 * Not domain-restricted: membership isn't limited to @berkeley.edu, so any
 * verified Google account may sign in. Gate 2 (`initialAccess`) is what
 * actually decides access — on the roster gets in immediately, everyone else
 * waits in `pending` for exec to approve them.
 */
export function canSignIn(params: {
  email: string | null | undefined;
  emailVerified: boolean;
}): boolean {
  const { email, emailVerified } = params;
  return Boolean(email && emailVerified);
}

/**
 * Gate 2 — what access does this person get on first sign-in?
 *
 * strict: auto-approved only if BOTH true — on the imported roster CSV, AND a
 *         verified @<allowedDomain> address. A roster email on some other
 *         domain (a sponsor or coach who ended up in the import) still lands
 *         in `pending` for a human to approve — being on the list alone isn't
 *         enough. Everyone else (on-domain but off-roster, or off-domain and
 *         off-roster) also lands in `pending`, with the same escape hatch so
 *         a new member isn't hard-locked out at 9pm the night before practice.
 * domain: any verified account on the allowed domain is approved
 *         immediately, roster or not. Off-domain accounts still wait in
 *         `pending`. The roster is still recorded (for Comp tracking).
 * open:   any verified account is approved immediately, roster or domain
 *         doesn't matter.
 */
export function initialAccess(params: {
  email: string;
  onRoster: boolean;
  rosterMode: "strict" | "domain" | "open";
  allowedDomain: string;
  adminEmails: string[];
  execEmails: string[];
}): { role: Role; status: MemberStatus; onRoster: boolean } {
  const email = normalizeEmail(params.email);

  const role: Role = params.adminEmails.includes(email)
    ? "admin"
    : params.execEmails.includes(email)
      ? "exec"
      : "member";

  const onAllowedDomain = email.endsWith(`@${params.allowedDomain.toLowerCase()}`);
  const autoApproved =
    params.rosterMode === "open" ||
    (params.rosterMode === "domain" && onAllowedDomain) ||
    (params.onRoster && onAllowedDomain);

  // Exec and admin are always approved — they can't be locked out of their own site.
  const status: MemberStatus = role !== "member" || autoApproved ? "approved" : "pending";

  return { role, status, onRoster: params.onRoster };
}

/** Can this person RSVP, register for tournaments, and see member pages? */
export function isActiveMember(u: { status: MemberStatus }): boolean {
  return u.status === "approved";
}

export function isExec(u: { role: Role }): boolean {
  return u.role === "exec" || u.role === "admin";
}

export function isAdmin(u: { role: Role }): boolean {
  return u.role === "admin";
}
