#!/usr/bin/env node
/**
 * Import a roster CSV into the allowlist.
 *
 *   node scripts/import-roster.mjs roster.csv           # preview only
 *   node scripts/import-roster.mjs roster.csv --commit  # actually write
 *
 * Accepts a header row with an `email` column (and optional `name`/`note`), or
 * a bare list of one email per line. Re-running is safe: existing emails are
 * updated, not duplicated.
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const [, , file, ...flags] = process.argv;
const commit = flags.includes("--commit");

if (!file) {
  console.error("usage: node scripts/import-roster.mjs <roster.csv> [--commit]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Load it from .env first.");
  process.exit(1);
}

/** Minimal CSV split that respects double-quoted fields. */
function splitRow(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim());
if (!lines.length) {
  console.error("File is empty.");
  process.exit(1);
}

const header = splitRow(lines[0]).map((h) => h.toLowerCase());
const hasHeader = header.includes("email");
const idx = {
  email: hasHeader ? header.indexOf("email") : 0,
  name: hasHeader ? header.indexOf("name") : -1,
  note: hasHeader ? header.indexOf("note") : -1,
};

const rows = [];
const invalid = [];
const seen = new Set();

for (const line of lines.slice(hasHeader ? 1 : 0)) {
  const cols = splitRow(line);
  const email = (cols[idx.email] ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) { invalid.push(line); continue; }
  if (seen.has(email)) continue;          // de-dupe within the file
  seen.add(email);
  rows.push({
    email,
    name: idx.name >= 0 ? cols[idx.name] || null : null,
    note: idx.note >= 0 ? cols[idx.note] || null : null,
  });
}

const sql = neon(process.env.DATABASE_URL);
const existing = new Set(
  (await sql`SELECT email FROM roster_email`).map((r) => r.email),
);

const toAdd = rows.filter((r) => !existing.has(r.email));
const toUpdate = rows.filter((r) => existing.has(r.email));
const missing = [...existing].filter((e) => !seen.has(e));

console.log(`\nParsed ${rows.length} valid row(s) from ${file}`);
console.log(`  new           ${toAdd.length}`);
console.log(`  already known ${toUpdate.length}`);
if (invalid.length) console.log(`  invalid       ${invalid.length}  (skipped)`);
if (missing.length) {
  console.log(`\n  ${missing.length} roster email(s) are NOT in this file.`);
  console.log("  They are left untouched — remove them by hand if they left the club.");
}
if (invalid.length) {
  console.log("\nSkipped lines:");
  invalid.slice(0, 10).forEach((l) => console.log(`  ${l}`));
  if (invalid.length > 10) console.log(`  ...and ${invalid.length - 10} more`);
}

if (!commit) {
  console.log("\nPreview only. Re-run with --commit to write.\n");
  process.exit(0);
}

for (const r of rows) {
  await sql`
    INSERT INTO roster_email (email, name, note)
    VALUES (${r.email}, ${r.name}, ${r.note})
    ON CONFLICT (email) DO UPDATE
      SET name = COALESCE(EXCLUDED.name, roster_email.name),
          note = COALESCE(EXCLUDED.note, roster_email.note)
  `;
}

/* Everyone with an account who's on the roster gets flagged as such... */
await sql`
  UPDATE "user" u
     SET on_roster = true
    FROM roster_email r
   WHERE lower(u.email) = r.email
`;

/*
 * ...but only allowed-domain pending accounts are auto-approved — the same rule
 * as first sign-in (src/lib/access.ts). A non-Berkeley roster email still
 * needs an exec to approve it by hand.
 */
const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "berkeley.edu").toLowerCase();
const promoted = await sql`
  UPDATE "user" u
     SET status = 'approved'
    FROM roster_email r
   WHERE lower(u.email) = r.email
     AND u.status = 'pending'
     AND lower(u.email) LIKE ${"%@" + domain}
  RETURNING u.email
`;

console.log(`\nWrote ${rows.length} roster row(s).`);
if (promoted.length) {
  console.log(`Promoted ${promoted.length} pending member(s) to approved:`);
  promoted.forEach((p) => console.log(`  ${p.email}`));
}
console.log();
