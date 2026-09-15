"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireExec, requireAdmin } from "@/lib/session";
import { db, schema } from "@/db";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function approveMember(memberId: string): Promise<ActionResult> {
  await requireExec();
  await db().update(schema.users).set({ status: "approved" }).where(eq(schema.users.id, memberId));
  revalidatePath("/exec/members");
  revalidatePath("/exec");
  return { ok: true };
}

export async function blockMember(memberId: string): Promise<ActionResult> {
  await requireExec();
  await db().update(schema.users).set({ status: "blocked" }).where(eq(schema.users.id, memberId));
  revalidatePath("/exec/members");
  revalidatePath("/exec");
  return { ok: true };
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
