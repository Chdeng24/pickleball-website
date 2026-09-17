import "server-only";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { isExec, isAdmin, isActiveMember, type Role, type MemberStatus } from "@/lib/access";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role: Role;
  status: MemberStatus;
  derivedLevel: "unknown" | "beginner" | "advanced";
  duprUrl: string | null;
  onCompetitiveTeam: boolean;
};

/** Read-only — returns null when signed out. Never redirects. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  return session?.user ?? null;
}

/** Any signed-in Google account, regardless of roster/approval status. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Signed in AND approved on the roster. The gate for RSVP/tournament pages. */
export async function requireMember(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isActiveMember(user)) redirect("/pending");
  return user;
}

/**
 * Exec or admin. Uses notFound(), not redirect — a plain member must not be
 * able to tell an exec page exists by getting bounced from it.
 */
export async function requireExec(): Promise<SessionUser> {
  const user = await requireMember();
  if (!isExec(user)) notFound();
  return user;
}

/** Admin only — role changes, tournament score disputes. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireMember();
  if (!isAdmin(user)) notFound();
  return user;
}
