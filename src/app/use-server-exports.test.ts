import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the bug that took RSVPs down in production: `events/actions.ts`
 * exported a plain object (`RSVP_ERROR_MESSAGES`) alongside its actions. A
 * `"use server"` module may only export async functions — Next enforces that
 * at *runtime*, not at build time, so `npm run build` stayed green while every
 * action in the file threw "A 'use server' file can only export async
 * functions, found object" on the server.
 *
 * Shared constants belong in a plain module (`src/lib/content.ts`) that both
 * the action and the client component import.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const SRC = join(import.meta.dirname, "..");

/** Type-only exports vanish at compile time, so they are always fine. */
const ALLOWED = /^export\s+(async\s+function\s|type\s|interface\s)/;
const EXPORT = /^export\b/;

test("every \"use server\" file exports only async functions", () => {
  const files = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));
  const offenders: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!/^\s*["']use server["'];/.test(source)) continue;

    source.split("\n").forEach((line, i) => {
      if (EXPORT.test(line) && !ALLOWED.test(line)) {
        offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}  ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(offenders, [], `non-function exports in "use server" files:\n${offenders.join("\n")}`);
});
