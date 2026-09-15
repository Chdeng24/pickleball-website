"use server";

import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireExec } from "@/lib/session";
import { db, schema } from "@/db";
import { laInputToUtc } from "@/lib/dates";

export type FormState = { ok: boolean; error?: string; fieldErrors?: Record<string, string> };

const eventTypes = ["practice", "social", "fundraiser", "tournament"] as const;
const levels = ["unknown", "beginner", "advanced"] as const;

/** Empty string from an optional datetime-local input -> null, not "". */
const optionalLocalDate = z
  .string()
  .transform((s) => (s.trim() === "" ? null : laInputToUtc(s)));

const fieldsSchema = z.object({
  id: z.string().uuid().optional(),
  type: z.enum(eventTypes),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .transform((s) => (s === "" ? null : s)),
  level: z.enum(levels).default("unknown"),
  location: z.string().trim().min(1, "Location is required").max(200),
  startsAt: z.string().min(1, "Start time is required").transform(laInputToUtc),
  endsAt: z.string().min(1, "End time is required").transform(laInputToUtc),
  // "" from the "unlimited" state -> null capacity.
  capacity: z
    .string()
    .transform((s) => (s.trim() === "" ? null : Number(s)))
    .pipe(z.number().int().positive().nullable()),
  rsvpOpensAt: optionalLocalDate,
  cancelDeadline: optionalLocalDate,
});

function parseForm(formData: FormData) {
  return fieldsSchema.safeParse({
    id: formData.get("id") || undefined,
    type: formData.get("type"),
    title: formData.get("title"),
    description: formData.get("description") ?? "",
    level: formData.get("level") || "unknown",
    location: formData.get("location"),
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    capacity: formData.get("capacity") ?? "",
    rsvpOpensAt: formData.get("rsvpOpensAt") ?? "",
    cancelDeadline: formData.get("cancelDeadline") ?? "",
  });
}

/** Cross-field checks that don't fit cleanly on a single Zod field. */
function validateWindow(data: {
  startsAt: Date;
  endsAt: Date;
  rsvpOpensAt: Date | null;
}): string | null {
  if (data.endsAt <= data.startsAt) return "End time must be after the start time.";
  if (data.rsvpOpensAt && data.rsvpOpensAt > data.startsAt)
    return "RSVPs can't open after the event starts.";
  return null;
}

export async function saveEvent(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireExec();

  const parsed = parseForm(formData);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }

  const windowError = validateWindow(parsed.data);
  if (windowError) return { ok: false, error: windowError };

  const { id, ...values } = parsed.data;

  if (id) {
    await db().update(schema.events).set(values).where(eq(schema.events.id, id));
    revalidatePath(`/events/${id}`);
  } else {
    const user = await requireExec();
    await db().insert(schema.events).values({ ...values, createdBy: user.id });
  }

  revalidatePath("/exec/events");
  revalidatePath("/events");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function togglePublished(id: string, published: boolean): Promise<FormState> {
  await requireExec();
  await db().update(schema.events).set({ published }).where(eq(schema.events.id, id));

  revalidatePath("/exec/events");
  revalidatePath("/events");
  revalidatePath(`/events/${id}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteEvent(id: string): Promise<FormState> {
  await requireExec();

  // Deleting an event people are counting on must not be a single click — an
  // exec has to unpublish it first, which itself surfaces to anyone RSVP'd.
  const activeCount = await db().$count(
    schema.rsvps,
    and(eq(schema.rsvps.eventId, id), ne(schema.rsvps.status, "cancelled")),
  );
  if (activeCount > 0) {
    return {
      ok: false,
      error: `${activeCount} member(s) have RSVP'd or are waitlisted. Unpublish the event first.`,
    };
  }

  await db().delete(schema.events).where(eq(schema.events.id, id));

  revalidatePath("/exec/events");
  revalidatePath("/events");
  revalidatePath("/dashboard");
  return { ok: true };
}
