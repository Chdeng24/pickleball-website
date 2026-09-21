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
 * cannot hold an interactive transaction across statements. Capacity checks
 * (RSVPs, league spots) need `SELECT ... FOR UPDATE` inside a real transaction,
 * so those paths go through this WebSocket pool driver instead.
 *
 * Use `db()` for everything else — this is reserved for transactional writes.
 */
if (typeof WebSocket === "undefined") {
  // Node <22 has no global WebSocket; Workers and newer Node provide one.
  neonConfig.webSocketConstructor = ws;
}

function connect(pool: Pool) {
  return drizzle(pool, { schema });
}

export type Tx = Parameters<Parameters<ReturnType<typeof connect>["transaction"]>[0]>[0];

/**
 * Runs `fn` in one transaction on a pool that lives only for this call.
 *
 * The pool is deliberately NOT cached at module scope: Cloudflare Workers
 * forbids reusing a socket opened by one request from another request ("Cannot
 * perform I/O on behalf of a different request"), which is exactly what a
 * module-level pool does on the second request an isolate serves.
 */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: env().DATABASE_URL });
  try {
    return await connect(pool).transaction(fn);
  } finally {
    await pool.end().catch(() => {});
  }
}
