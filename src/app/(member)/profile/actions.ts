"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireMember } from "@/lib/session";
import { db, schema } from "@/db";

const schemaZ = z.object({
  duprUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || z.url().safeParse(v).success, "Enter a full link, e.g. https://mydupr.com/player/123456"),
});

export async function updateDuprLink(
  _prev: { ok: boolean; error?: string },
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireMember();

  const parsed = schemaZ.safeParse({ duprUrl: formData.get("duprUrl") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid link." };
  }

  await db()
    .update(schema.users)
    .set({ duprUrl: parsed.data.duprUrl || null })
    .where(eq(schema.users.id, user.id));

  revalidatePath("/profile");
  return { ok: true };
}
