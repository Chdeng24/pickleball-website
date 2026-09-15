import "server-only";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Transaction-capable driver.
 *
 * `src/db/index.ts` uses neon-http, which sends one HTTP request per query and
 * cannot hold an interactive transaction across statements. The RSVP capacity
 * check needs `SELECT ... FOR UPDATE` inside a real transaction, so that path
 * goes through this WebSocket pool driver instead.
 *
 * Use `db()` for everything else — this one is reserved for transactional writes.
 */
if (typeof WebSocket === "undefined") {
  // Node has no global WebSocket; Cloudflare Workers provide one natively and
  // this branch is skipped there.
  neonConfig.webSocketConstructor = ws;
}

let pool: Pool | null = null;

export function txDb() {
  if (!pool) {
    pool = new Pool({ connectionString: env().DATABASE_URL });
  }
  return drizzle(pool, { schema });
}
