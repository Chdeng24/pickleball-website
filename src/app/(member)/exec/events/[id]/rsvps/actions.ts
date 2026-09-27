"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { requireExec } from "@/lib/session";
import { db, schema } from "@/db";
import { withTransaction } from "@/db/pool";
import { clearAttendanceTx, markRemainingNoShowTx, setAttendanceTx } from "@/lib/rsvp";
import { canRecordAttendance, tracksAttendance } from "@/lib/strikes";
import { attendanceCopy } from "@/lib/content";

// A `"use server"` file may export only async functions — see AGENTS.md rule 6.

type ActionResult = { ok: true } | { ok: false; error: string };

const markSchema = z.object({
  rsvpId: z.uuid(),
  attendance: z.enum(["unmarked", "present", "no_show"]),
});

function revalidate(eventId: string, memberId?: string) {
  revalidatePath(`/exec/events/${eventId}/rsvps`);
  revalidatePath("/exec/members");
  revalidatePath("/exec");
  if (memberId) revalidatePath(`/exec/members/${memberId}`);
}

/**
 * Record whether one member turned up. Exec-only, and re-checked here rather
 * than trusting that the page rendered the button — hiding a control is not
 * access control.
 *
 * A `no_show` becomes a strike, and two strikes removes someone from the club,
 * so this also refuses to mark a session that hasn't started yet and refuses
 * to mark anyone who wasn't holding a confirmed spot.
 */
export async function markAttendance(
  rsvpId: string,
  attendance: "unmarked" | "present" | "no_show",
): Promise<ActionResult> {
  const exec = await requireExec();

  try {
    const parsed = markSchema.safeParse({ rsvpId, attendance });
    if (!parsed.success) return { ok: false, error: attendanceCopy.errors.badInput };

    const [row] = await db()
      .select({ rsvp: schema.rsvps, event: schema.events })
      .from(schema.rsvps)
      .innerJoin(schema.events, eq(schema.rsvps.eventId, schema.events.id))
      .where(eq(schema.rsvps.id, parsed.data.rsvpId));

    if (!row) return { ok: false, error: attendanceCopy.errors.notFound };
    if (!tracksAttendance(row.event)) return { ok: false, error: attendanceCopy.errors.notPractice };
    if (!canRecordAttendance(row.event, new Date())) {
      return { ok: false, error: attendanceCopy.errors.notStarted };
    }
    if (row.rsvp.status !== "confirmed") {
      return { ok: false, error: attendanceCopy.errors.notConfirmed };
    }

    const next = parsed.data.attendance;
    const saved = await withTransaction((tx) => setAttendanceTx(tx, parsed.data.rsvpId, next, exec.id));
    if (!saved) return { ok: false, error: attendanceCopy.errors.notConfirmed };

    revalidate(row.event.id, row.rsvp.memberId);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    console.error("markAttendance failed", e);
    return { ok: false, error: attendanceCopy.errors.unknown };
  }
}

/**
 * After a session: check people in as they arrive, then mark whoever is left.
 *
 * Scoped to confirmed + still-unmarked rows only, so it can never overwrite a
 * check-in an exec already recorded, and can never reach someone who cancelled
 * their spot in advance.
 */
export async function markRemainingAsNoShow(eventId: string): Promise<ActionResult> {
  const exec = await requireExec();

  try {
    if (!z.uuid().safeParse(eventId).success) {
      return { ok: false, error: attendanceCopy.errors.badInput };
    }

    const [event] = await db().select().from(schema.events).where(eq(schema.events.id, eventId));
    if (!event) return { ok: false, error: attendanceCopy.errors.notFound };
    if (!tracksAttendance(event)) return { ok: false, error: attendanceCopy.errors.notPractice };
    if (!canRecordAttendance(event, new Date())) {
      return { ok: false, error: attendanceCopy.errors.notStarted };
    }

    await withTransaction((tx) => markRemainingNoShowTx(tx, eventId, exec.id));

    revalidatePath("/(member)/exec/members/[id]", "page");
    revalidate(eventId);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    console.error("markRemainingAsNoShow failed", e);
    return { ok: false, error: attendanceCopy.errors.unknown };
  }
}

/** Undo a whole session's attendance — the escape hatch for marking the wrong event. */
export async function clearAttendance(eventId: string): Promise<ActionResult> {
  await requireExec();

  try {
    if (!z.uuid().safeParse(eventId).success) {
      return { ok: false, error: attendanceCopy.errors.badInput };
    }

    const [event] = await db()
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, eventId));
    if (!event) return { ok: false, error: attendanceCopy.errors.notFound };

    await withTransaction((tx) => clearAttendanceTx(tx, eventId));

    // Clearing can drop several members' strikes at once — refresh every profile.
    revalidatePath("/(member)/exec/members/[id]", "page");
    revalidate(eventId);
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    console.error("clearAttendance failed", e);
    return { ok: false, error: attendanceCopy.errors.unknown };
  }
}
