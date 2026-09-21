"use client"; // Error boundaries must be Client Components

import { club, errorCopy } from "@/lib/content";

/**
 * Last resort when the root layout itself fails. It replaces the whole
 * document and gets none of the global CSS, so styles are inline.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f7f9", color: "#0a2a66" }}>
        <title>{`${errorCopy.title} — ${club.name}`}</title>
        <main style={{ maxWidth: 440, margin: "18vh auto", padding: 32, background: "#fff", borderTop: "4px solid #fdb515" }}>
          <h1 style={{ margin: 0, fontSize: 24, textTransform: "uppercase" }}>{errorCopy.title}</h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#444" }}>
            {errorCopy.body} <a href={`mailto:${club.email}`}>{club.email}</a>
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ height: 44, padding: "0 24px", background: "#0a2a66", color: "#fff", border: 0, fontWeight: 700, cursor: "pointer" }}
          >
            {errorCopy.retry}
          </button>
          {error.digest && <p style={{ marginTop: 24, fontSize: 11, color: "#999" }}>Error ref: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
