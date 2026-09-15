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
 * The `hd` claim is read from the verified ID token, NOT from the `hd` request
 * parameter: that parameter is only a UI hint and is trivially bypassed. The
 * allowlist covers the club Gmail and any exec who isn't on a Berkeley address.
 */
export function canSignIn(params: {
  email: string | null | undefined;
  emailVerified: boolean;
  hd: string | null | undefined;
  allowedDomain: string;
  allowlist: string[];
}): boolean {
  const { email, emailVerified, hd, allowedDomain, allowlist } = params;
  if (!email || !emailVerified) return false;

  const normalized = normalizeEmail(email);
  if (allowlist.includes(normalized)) return true;

  // Require both the hosted-domain claim and a matching address suffix.
  const domainOk = hd?.toLowerCase() === allowedDomain.toLowerCase();
  const suffixOk = normalized.endsWith(`@${allowedDomain.toLowerCase()}`);
  return domainOk && suffixOk;
}

/**
 * Gate 2 — what access does this person get on first sign-in?
 *
 * strict: only emails from the imported roster CSV are approved. Everyone else
 *         can sign in and see a "request access" screen, but cannot RSVP or
 *         register for tournaments until exec approves them. This is the
 *         "only emails in the file can join" behaviour, with an escape hatch
 *         so a new member isn't hard-locked out at 9pm the night before practice.
 * open:   any verified address on the allowed domain is approved immediately.
 */
export function initialAccess(params: {
  email: string;
  onRoster: boolean;
  rosterMode: "strict" | "open";
  adminEmails: string[];
  execEmails: string[];
}): { role: Role; status: MemberStatus; onRoster: boolean } {
  const email = normalizeEmail(params.email);

  const role: Role = params.adminEmails.includes(email)
    ? "admin"
    : params.execEmails.includes(email)
      ? "exec"
      : "member";

  // Exec and admin are always approved — they can't be locked out of their own site.
  const status: MemberStatus =
    role !== "member" || params.onRoster || params.rosterMode === "open"
      ? "approved"
      : "pending";

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
