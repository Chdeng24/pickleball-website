"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireMember } from "@/lib/session";
import { rsvp, cancelRsvp, refreshDerivedLevel, RsvpError, type RsvpErrorReason } from "@/lib/rsvp";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { sendRsvpConfirmed, sendWaitlistPromoted } from "@/lib/email";

/**
 * NOTE: a `"use server"` file may only export async functions. Next enforces
 * that at runtime, not at build time, so an exported const here takes RSVPs
 * down in production while `npm run build` stays green. Shared values (the
 * friendly error strings) live in `src/lib/content.ts`; `use-server-exports.test.ts`
 * fails the suite if one creeps back in.
 */

export type RsvpActionResult =
  | { ok: true; status: "confirmed" | "waitlist"; position: number }
  | { ok: false; reason: RsvpErrorReason | "unknown" };

/**
 * Everything after the RSVP transaction has already committed: a derived-level
 * recompute, a confirmation email, cache revalidation. None of it is allowed to
 * turn a real, committed RSVP into an error the member sees — they would retry,
 * get "you're already signed up", and reasonably conclude the site is broken.
 * So each side effect is logged and swallowed.
 */
async function afterCommit(eventId: string, work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    console.error("rsvp post-commit side effect failed (rsvp itself is safe)", err);
  }

  try {
    revalidatePath(`/events/${eventId}`);
    revalidatePath("/events");
    revalidatePath("/dashboard");
    revalidatePath(`/exec/events/${eventId}/rsvps`);
  } catch (err) {
    console.error("revalidate after rsvp failed (rsvp itself is safe)", err);
  }
}

/**
 * Turns an unexpected failure into a toast instead of the full-page error
 * boundary. A `RsvpError` is an expected "no" (event full window closed, already
 * signed up) with its own message; anything else is a bug or a DB blip, and the
 * member just needs to be told to try again. `unstable_rethrow` first, so
 * `redirect()` from `requireMember` still redirects.
 */
function toFailure(e: unknown, label: string): { ok: false; reason: RsvpErrorReason | "unknown" } {
  unstable_rethrow(e);
  if (e instanceof RsvpError) return { ok: false, reason: e.reason };
  console.error(label, e);
  return { ok: false, reason: "unknown" };
}

export async function rsvpToEvent(eventId: string): Promise<RsvpActionResult> {
  const user = await requireMember();

  try {
    const result = await rsvp(eventId, user.id);

    await afterCommit(eventId, async () => {
      await refreshDerivedLevel(user.id);

      if (result.status === "confirmed" && user.email) {
        const [event] = await db().select().from(schema.events).where(eq(schema.events.id, eventId));
        if (event) {
          await sendRsvpConfirmed({ email: user.email, name: user.name ?? null }, event).catch((err) =>
            console.error("rsvp confirmation email failed", err),
          );
        }
      }
    });

    return { ok: true, ...result };
  } catch (e) {
    return toFailure(e, "rsvpToEvent failed");
  }
}

export async function cancelEventRsvp(
  eventId: string,
): Promise<{ ok: true } | { ok: false; reason: RsvpErrorReason | "unknown" }> {
  const user = await requireMember();

  try {
    const { promoted } = await cancelRsvp(eventId, user.id);

    await afterCommit(eventId, async () => {
      await refreshDerivedLevel(user.id);

      if (promoted) {
        await refreshDerivedLevel(promoted.id);
        const [event] = await db().select().from(schema.events).where(eq(schema.events.id, eventId));
        if (event) {
          await sendWaitlistPromoted(promoted, event).catch((err) =>
            console.error("waitlist promotion email failed", err),
          );
        }
      }
    });

    return { ok: true };
  } catch (e) {
    return toFailure(e, "cancelEventRsvp failed");
  }
}
