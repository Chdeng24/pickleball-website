"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/session";
import { rsvp, cancelRsvp, refreshDerivedLevel, RsvpError, type RsvpErrorReason } from "@/lib/rsvp";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { sendRsvpConfirmed, sendWaitlistPromoted } from "@/lib/email";

export type RsvpActionResult =
  | { ok: true; status: "confirmed" | "waitlist"; position: number }
  | { ok: false; reason: RsvpErrorReason | "unknown" };

const FRIENDLY: Record<RsvpErrorReason, string> = {
  not_found: "That event no longer exists.",
  not_published: "This event isn't open yet.",
  not_open: "RSVPs aren't open for this event yet.",
  past: "This event has already happened.",
  already_rsvpd: "You're already signed up for this.",
  not_rsvpd: "You're not signed up for this.",
};

export { FRIENDLY as RSVP_ERROR_MESSAGES };

export async function rsvpToEvent(eventId: string): Promise<RsvpActionResult> {
  const user = await requireMember();

  try {
    const result = await rsvp(eventId, user.id);
    await refreshDerivedLevel(user.id);

    if (result.status === "confirmed" && user.email) {
      const [event] = await db().select().from(schema.events).where(eq(schema.events.id, eventId));
      // Never let a dropped email undo an already-committed RSVP.
      if (event) {
        await sendRsvpConfirmed({ email: user.email, name: user.name ?? null }, event).catch((err) =>
          console.error("rsvp confirmation email failed", err),
        );
      }
    }

    revalidatePath(`/events/${eventId}`);
    revalidatePath("/events");
    revalidatePath("/dashboard");
    revalidatePath(`/exec/events/${eventId}/rsvps`);
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof RsvpError) return { ok: false, reason: e.reason };
    throw e;
  }
}

export async function cancelEventRsvp(
  eventId: string,
): Promise<{ ok: true } | { ok: false; reason: RsvpErrorReason | "unknown" }> {
  const user = await requireMember();

  try {
    const { promoted } = await cancelRsvp(eventId, user.id);
    await refreshDerivedLevel(user.id);

    if (promoted) {
      await refreshDerivedLevel(promoted.id);
      const [event] = await db().select().from(schema.events).where(eq(schema.events.id, eventId));
      if (event) {
        // Never let a dropped email undo a real, already-committed promotion.
        await sendWaitlistPromoted(promoted, event).catch((err) =>
          console.error("waitlist promotion email failed", err),
        );
      }
    }

    revalidatePath(`/events/${eventId}`);
    revalidatePath("/events");
    revalidatePath("/dashboard");
    revalidatePath(`/exec/events/${eventId}/rsvps`);
    return { ok: true };
  } catch (e) {
    if (e instanceof RsvpError) return { ok: false, reason: e.reason };
    throw e;
  }
}
