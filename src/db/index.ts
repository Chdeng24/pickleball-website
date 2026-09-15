import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * HTTP driver: one round trip per query, works inside Cloudflare Workers.
 *
 * Note for phase 4 — the RSVP capacity check needs a real interactive
 * transaction with `SELECT ... FOR UPDATE`, which neon-http cannot do. That path
 * uses the WebSocket pool driver instead; see src/db/pool.ts when it lands.
 */
let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!cached) {
    cached = drizzle(neon(env().DATABASE_URL), { schema });
  }
  return cached;
}

export { schema };
