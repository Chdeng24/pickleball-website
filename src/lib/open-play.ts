import "server-only";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export type OpenPlaySpots = { eventId: string; capacity: number; taken: number; left: number };

/**
 * Live spots for the latest posted beginner and advanced practice that hasn't
 * ended yet — what the public open-play cards show. A level with nothing
 * posted (or the database unreachable) is null, and the card falls back to
 * its plain capacity.
 */
export async function openPlaySpots(now = new Date()): Promise<Record<"beginner" | "advanced", OpenPlaySpots | null>> {
  // Spelled out with table names: inside a subquery Drizzle prints bare column names, and a bare "id" would mean rsvp.id.
  const confirmed = sql<number>`(select count(*)::int from "rsvp" r where r."event_id" = "event"."id" and r."status" = 'confirmed')`;
  const latest = async (level: "beginner" | "advanced"): Promise<OpenPlaySpots | null> => {
    const [row] = await db()
      .select({ eventId: schema.events.id, capacity: schema.events.capacity, taken: confirmed })
      .from(schema.events)
      .where(
        and(
          eq(schema.events.type, "practice"),
          eq(schema.events.level, level),
          eq(schema.events.published, true),
          isNotNull(schema.events.capacity),
          gt(schema.events.endsAt, now),
        ),
      )
      .orderBy(desc(schema.events.createdAt))
      .limit(1);
    if (!row?.capacity) return null;
    return { eventId: row.eventId, capacity: row.capacity, taken: row.taken, left: Math.max(0, row.capacity - row.taken) };
  };

  try {
    const [beginner, advanced] = await Promise.all([latest("beginner"), latest("advanced")]);
    return { beginner, advanced };
  } catch (e) {
    console.error("open play spots unavailable", e);
    return { beginner: null, advanced: null };
  }
}
