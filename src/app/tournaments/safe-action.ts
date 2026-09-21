import { unstable_rethrow } from "next/navigation";
import type { ActionResult } from "./actions";

export const CONNECTION_LOST =
  "Couldn't reach the site — check your connection and try again. If you think it went through, refresh the page to check.";

/**
 * Wraps a server action for the browser. The server side already turns every
 * failure into an `ActionResult`, so the only thing left that can throw here
 * is the request itself (wifi drop, deploy mid-request) — that becomes an
 * inline message instead of the page's error screen. Next's own redirects
 * still pass through.
 */
export function safeAction<A extends unknown[]>(fn: (...args: A) => Promise<ActionResult>) {
  return async (...args: A): Promise<ActionResult> => {
    try {
      return await fn(...args);
    } catch (e) {
      unstable_rethrow(e);
      console.error("action request failed", e);
      return { ok: false, error: CONNECTION_LOST };
    }
  };
}
