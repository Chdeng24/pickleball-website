/**
 * Errors worth one automatic retry: the database dropped the connection, or
 * Postgres aborted the transaction for a lock conflict (deadlock /
 * serialization). A retry is safe because the failed transaction rolled back
 * — nothing was written. Anything else (bad input, a rule the user broke) is
 * not retried.
 */
const RETRYABLE_SQLSTATES = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "57P01", // admin_shutdown (Neon restarting the compute)
  "08000", // connection_exception
  "08001",
  "08003",
  "08006",
]);

const RETRYABLE_NODE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE"]);

const RETRYABLE_MESSAGES = [/connection terminated/i, /fetch failed/i, /socket hang up/i, /network/i];

export function isTransientDbError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 4; depth++) {
    const { code, message, cause } = e as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === "string" && (RETRYABLE_SQLSTATES.has(code) || RETRYABLE_NODE_CODES.has(code))) return true;
    if (typeof message === "string" && RETRYABLE_MESSAGES.some((re) => re.test(message))) return true;
    e = cause;
  }
  return false;
}
