"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";
import { club, errorCopy } from "@/lib/content";

/**
 * Catch-all for any page below the root layout that throws while rendering
 * (usually a database blip). `retry` re-renders the segment in place, so a
 * transient failure recovers without a full reload.
 */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] flex-1 items-center justify-center bg-chalk px-6 py-24">
      <div className="max-w-md border-t-4 border-gold-500 bg-white p-8">
        <h1 className="font-display text-2xl font-extrabold uppercase text-navy-900">{errorCopy.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink/65">
          {errorCopy.body}{" "}
          <a href={`mailto:${club.email}`} className="font-semibold text-navy-800 underline underline-offset-2">
            {club.email}
          </a>
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => retry()}
            className="h-11 bg-navy-900 px-6 font-display text-xs font-bold uppercase tracking-[0.12em] text-white hover:bg-navy-800"
          >
            {errorCopy.retry}
          </button>
          <Link
            href="/"
            className="flex h-11 items-center border-2 border-navy-900/15 px-6 font-display text-xs font-bold uppercase tracking-[0.12em] text-navy-900 hover:border-navy-900"
          >
            {errorCopy.home}
          </Link>
        </div>
        {error.digest && <p className="mt-6 text-[11px] text-ink/35">Error ref: {error.digest}</p>}
      </div>
    </main>
  );
}
