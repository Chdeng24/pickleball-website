"use server";

import { z } from "zod";
import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireExec, requireAdmin } from "@/lib/session";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { onDomain, parseEmailList } from "@/lib/league-rules";

type ActionResult = { ok: true } | { ok: false; error: string };

const memberIdSchema = z.uuid();

export async function approveMember(memberId: string): Promise<ActionResult> {
  await requireExec();
  if (!memberIdSchema.safeParse(memberId).success) return { ok: false, error: "Unknown member." };
  await db().update(schema.users).set({ status: "approved" }).where(eq(schema.users.id, memberId));
  revalidatePath("/exec/members");
  revalidatePath("/exec");
  return { ok: true };
}

export async function blockMember(memberId: string): Promise<ActionResult> {
  await requireExec();
  if (!memberIdSchema.safeParse(memberId).success) return { ok: false, error: "Unknown member." };
  await db().update(schema.users).set({ status: "blocked" }).where(eq(schema.users.id, memberId));
  revalidatePath("/exec/members");
  revalidatePath("/exec");
  return { ok: true };
}

/** Gates registration for competitive-only tournaments — a roster designation, not a security role, so exec (not just admin) can set it. */
export async function setCompetitiveTeam(memberId: string, on: boolean): Promise<ActionResult> {
  await requireExec();
  if (!memberIdSchema.safeParse(memberId).success || typeof on !== "boolean") return { ok: false, error: "Unknown member." };
  const [member] = await db()
    .update(schema.users)
    .set({ onCompetitiveTeam: on })
    .where(eq(schema.users.id, memberId))
    .returning({ email: schema.users.email });
  // Keep the roster entry in sync so the pasted list and this toggle never disagree.
  if (member) {
    await db()
      .update(schema.rosterEmails)
      .set({ competitive: on })
      .where(eq(schema.rosterEmails.email, member.email.toLowerCase()));
  }
  revalidatePath(`/exec/members/${memberId}`);
  revalidatePath("/exec/members");
  return { ok: true };
}

export type ImportResult = { ok: boolean; error?: string; message?: string };

/**
 * The paste box on Exec → Members. Adds every email found to the roster (and
 * optionally marks them Competitive Team), then applies that to anyone who
 * already has an account: on-roster, comp flag, and — only for the allowed
 * domain — approval if they were pending. A non-Berkeley roster email still
 * needs a human to approve it, same rule as first sign-in.
 */
export async function importRosterList(_prev: ImportResult, formData: FormData): Promise<ImportResult> {
  const viewer = await requireExec();
  const text = String(formData.get("emails") ?? "");
  const competitive = formData.get("competitive") === "on";
  if (text.length > 200_000) return { ok: false, error: "That's too much text at once — split it into a few pastes." };

  const { emails, rejected } = parseEmailList(text);
  if (emails.length === 0) {
    return {
      ok: false,
      error: rejected.length
        ? `No valid emails found. Check: ${rejected.slice(0, 3).join(" · ")}`
        : "No emails found in that text.",
    };
  }
  if (emails.length > 2000) return { ok: false, error: "More than 2,000 emails — split it into a few pastes." };

  const domain = env().ALLOWED_EMAIL_DOMAIN;
  let alreadyOnRoster = 0;
  let accountsUpdated = 0;
  let approvedNow = 0;

  try {
    const before = await db()
      .select({ email: schema.rosterEmails.email })
      .from(schema.rosterEmails)
      .where(inArray(schema.rosterEmails.email, emails));
    alreadyOnRoster = before.length;

    await db()
      .insert(schema.rosterEmails)
      .values(emails.map((email) => ({ email, competitive, importedBy: viewer.id })))
      .onConflictDoUpdate({
        target: schema.rosterEmails.email,
        // Adding someone to the roster never un-marks them as comp.
        set: { competitive: sql`${schema.rosterEmails.competitive} or excluded.competitive` },
      });

    const accounts = await db()
      .select({ id: schema.users.id, email: schema.users.email, status: schema.users.status })
      .from(schema.users)
      .where(inArray(sql`lower(${schema.users.email})`, emails));
    accountsUpdated = accounts.length;

    if (accounts.length > 0) {
      await db()
        .update(schema.users)
        .set(competitive ? { onRoster: true, onCompetitiveTeam: true } : { onRoster: true })
        .where(inArray(schema.users.id, accounts.map((a) => a.id)));

      const toApprove = accounts.filter((a) => a.status === "pending" && onDomain(a.email, domain));
      approvedNow = toApprove.length;
      if (toApprove.length > 0) {
        await db()
          .update(schema.users)
          .set({ status: "approved" })
          .where(inArray(schema.users.id, toApprove.map((a) => a.id)));
      }
    }
  } catch (e) {
    console.error("roster import failed", e);
    return { ok: false, error: "Something went wrong saving the list — try again." };
  }

  const offDomain = emails.filter((e) => !onDomain(e, domain)).length;
  const parts = [
    `${emails.length - alreadyOnRoster} added to the roster${alreadyOnRoster ? ` (${alreadyOnRoster} were already on it)` : ""}.`,
    competitive ? `All ${emails.length} marked Competitive Team.` : null,
    accountsUpdated ? `${accountsUpdated} already had accounts${approvedNow ? ` — ${approvedNow} pending approved just now` : ""}.` : null,
    offDomain ? `${offDomain} aren't @${domain}, so they'll still land in pending for manual approval.` : null,
    rejected.length ? `Skipped ${rejected.length} line${rejected.length === 1 ? "" : "s"} that looked like broken emails.` : null,
  ].filter(Boolean);

  revalidatePath("/exec/members");
  revalidatePath("/exec");
  return { ok: true, message: parts.join(" ") };
}

const bulkSchema = z.object({ memberIds: z.array(z.string().uuid()).min(1) });

export async function approveMembers(input: unknown): Promise<ActionResult> {
  await requireExec();
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nothing selected." };

  for (const id of parsed.data.memberIds) {
    await db().update(schema.users).set({ status: "approved" }).where(eq(schema.users.id, id));
  }
  revalidatePath("/exec/members");
  revalidatePath("/exec");
  return { ok: true };
}

const noteSchema = z.object({
  memberId: z.string().uuid(),
  body: z.string().trim().min(1, "Note can't be empty").max(2000),
});

export async function addMemberNote(formData: FormData): Promise<ActionResult> {
  const user = await requireExec();
  const parsed = noteSchema.safeParse({
    memberId: formData.get("memberId"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note" };

  await db().insert(schema.memberNotes).values({
    memberId: parsed.data.memberId,
    authorId: user.id,
    body: parsed.data.body,
  });
  revalidatePath(`/exec/members/${parsed.data.memberId}`);
  return { ok: true };
}

const roleSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(["member", "exec", "admin"]),
});

/** Role changes are admin-only — exec cannot promote itself or anyone else. */
export async function setMemberRole(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid role" };

  await db()
    .update(schema.users)
    .set({ role: parsed.data.role })
    .where(eq(schema.users.id, parsed.data.memberId));
  revalidatePath(`/exec/members/${parsed.data.memberId}`);
  revalidatePath("/exec/members");
  return { ok: true };
}
