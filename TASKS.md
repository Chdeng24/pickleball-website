# Build Spec — Pickleball at Berkeley

**Audience:** an AI coding agent implementing one task at a time.
**Read "Ground rules" and "What already exists" before touching anything.**

---

## How to use this file

Tasks are grouped into tranches. **Do them in order.** Each task lists its
dependencies, the exact files it owns, hard requirements, and a verification
command that must pass before the task is considered done.

After every task, run:

```bash
npm test && npm run lint && npm run build
```

All three must pass. If any fails, fix it inside the same task — never move on
with a red build.

**MVP = Tranche A + B + C + D.** That makes practices usable this semester.
Tranches E–G are follow-on work. Do not start F before B is complete and green.

---

## Ground rules

1. **Node is at `~/.nvm/versions/node/v24.20.0/bin`** and is not on the default
   PATH. Every shell command needs:
   `export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"`
2. **Never edit `src/lib/access.ts` or `src/lib/standings.ts` logic.** They are
   tested and correct. You may add functions; do not change existing behaviour.
   If a test fails after your change, you broke it — revert.
3. **All club-facing copy lives in `src/lib/content.ts`.** Never hardcode club
   text in a component.
4. **Styling:** Tailwind v4 with tokens defined in `src/app/globals.css`. Use
   `navy-800`, `navy-900`, `navy-950`, `gold-500`, `chalk`, `ink`. Do not
   introduce new hex colors. Do not add `border-radius` — the design is
   deliberately sharp-cornered throughout.
5. **Components:** reuse `Container`, `Button`, `Section`, `Reveal`, `Kicker`
   from `src/components/ui` and `src/components/site`. Do not install a
   component library.
6. **Server-first.** Default to React Server Components. Add `"use client"` only
   when you need state, effects, or event handlers.
7. **Mutations are Next.js Server Actions** in `src/app/**/actions.ts`, not API
   routes. Every action must re-check authorization server-side — never trust
   that the UI hid a button.
8. **Validate every action input with Zod.** No exceptions.
9. **Do not install packages** beyond those named in a task's "Install" line.
10. **Write tests for pure logic** (`*.test.ts`, run by `node --test`). Do not
    write browser/E2E tests — there is no harness for them.
11. **Timezones:** all DB timestamps are `timestamptz`. Render in
    `America/Los_Angeles`. Never format a date with raw `toLocaleString()` and
    no timezone argument.

---

## What already exists — DO NOT REBUILD

| Path | Status |
|---|---|
| `src/app/page.tsx`, `/about`, `/teams/[slug]`, `/tournaments`, `/sponsors`, `/events`, `/login` | Public site, done. `/events` and `/login` are placeholders to be replaced. |
| `src/components/site/*`, `src/components/ui/*` | Design system, done |
| `src/lib/content.ts` | All club copy |
| `src/lib/access.ts` + tests | Auth gates, roles. **12 tests passing. Do not modify.** |
| `src/lib/standings.ts` + tests | Pool standings + tiebreakers. **9 tests passing. Do not modify.** |
| `src/lib/env.ts` | Zod-validated env, lazily parsed |
| `src/db/schema.ts` | Full Drizzle schema — members, roster, notes, events, rsvps, tournaments |
| `src/db/index.ts` | `db()` — neon-http driver (**cannot do transactions**, see B1) |
| `src/auth.ts` | Auth.js v5 config, Google provider, role seeding on first login |
| `src/app/api/auth/[...nextauth]/route.ts` | Auth route handler |
| `scripts/import-roster.mjs` | Roster CSV import, idempotent |
| `SETUP.md` | Neon + Google OAuth setup — the human must do this first |

---

## TRANCHE A — Make auth work end to end

### A1 · Run migrations
**Depends on:** human completing `SETUP.md` (`.env` populated)
**Files:** `drizzle/` (generated)

1. `npm run db:generate` then `npm run db:push`
2. Confirm tables exist. If `db:push` prompts interactively, answer to create.

**Verify:** `npm run db:push` reports no pending changes on a second run.

---

### A2 · Session helpers and route guards
**Depends on:** A1
**Files:** create `src/lib/session.ts`

Export these, all server-only:

```ts
getSessionUser()  // Session["user"] | null
requireUser()     // redirects to /login if not signed in
requireMember()   // requireUser + status === "approved", else redirect /pending
requireExec()     // requireMember + role exec|admin, else notFound()
requireAdmin()    // requireMember + role admin, else notFound()
```

Requirements:
1. Use `auth()` from `@/auth`.
2. `requireExec` / `requireAdmin` must call `notFound()` — **not** redirect. A
   non-exec must not be able to discover that an admin page exists.
3. Each returns the typed user so callers don't re-fetch.
4. Add `import "server-only"` at the top.

**Verify:** `npm run build` passes; guards are used in A5 and B4.

---

### A3 · Wire the real Google sign-in button
**Depends on:** A2
**Files:** replace `src/app/login/page.tsx`; create `src/app/login/sign-in-button.tsx`

1. Keep the existing visual design exactly — navy card, logo, sharp corners.
2. Replace the disabled button with a working one that calls
   `signIn("google", { redirectTo: "/dashboard" })` from a Server Action or a
   client component.
3. Add a real Google "G" logo as inline SVG (Lucide has no brand icons — see
   `src/components/ui/icons.tsx` for the existing pattern).
4. If already signed in and approved, redirect straight to `/dashboard`.
5. Render `searchParams.error` as a readable message. Map Auth.js's
   `AccessDenied` to: *"That account isn't eligible. Sign in with your
   @berkeley.edu address."* Never show a raw error code.

**Verify:** visiting `/login` signed-out shows the button; signing in with a
berkeley.edu account lands on `/dashboard`.

---

### A4 · Pending-approval screen
**Depends on:** A2
**Files:** create `src/app/pending/page.tsx`

Shown when a user is signed in but `status === "pending"` (strict roster mode,
email not on the imported CSV).

1. Explain plainly: their account is verified but not yet on the club roster.
2. Show the club email from `content.ts` as the contact.
3. Include a sign-out button.
4. If the user is actually `approved`, redirect to `/dashboard`.
5. Reuse the `/login` card styling.

**Verify:** build passes; manually reachable at `/pending`.

---

### A5 · Member layout and shell
**Depends on:** A2, A3
**Files:** create `src/app/(member)/layout.tsx`, `src/components/site/member-nav.tsx`

1. Route group `(member)` wraps all signed-in pages. Its layout calls
   `requireMember()`.
2. Nav links: Dashboard, Events, Tournaments, Profile. Add an "Exec" link
   **only** when `isExec(user)`.
3. Show avatar, name, and a sign-out button.
4. Must be usable one-handed on a phone — this is where RSVPs happen. Sticky
   bottom tab bar under `sm`, top nav at `sm` and up.
5. Visually consistent with the public header (navy, gold accents, sharp).

**Verify:** `npm run build`; `/dashboard` redirects to `/login` when signed out.

---

### A6 · Member dashboard
**Depends on:** A5
**Files:** create `src/app/(member)/dashboard/page.tsx`

1. Greeting with first name.
2. "Your next practice" card — the soonest future event the user has a
   `confirmed` RSVP for, with day, time, location, and a cancel button.
   (Cancel action comes in B5; render it disabled until then.)
3. "Open for RSVP" list — published future events where `rsvpOpensAt <= now()`.
4. Empty states for both. Never render a blank page.
5. Server Component. No client JS unless strictly needed.

**Verify:** build passes; page renders with zero events in the DB.

---

## TRANCHE B — Events and RSVP (the core of the product)

### B1 · Transaction-capable DB driver
**Depends on:** A1
**Install:** `npm i ws && npm i -D @types/ws`
**Files:** create `src/db/pool.ts`

`src/db/index.ts` uses the **neon-http** driver, which sends one HTTP request
per query and **cannot hold an interactive transaction**. The RSVP capacity
check requires `SELECT ... FOR UPDATE`, so it needs the WebSocket pool driver.

```ts
import "server-only";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Node has no global WebSocket; Cloudflare Workers provide one natively.
if (typeof WebSocket === "undefined") neonConfig.webSocketConstructor = ws;

let pool: Pool | null = null;

export function txDb() {
  if (!pool) pool = new Pool({ connectionString: env().DATABASE_URL });
  return drizzle(pool, { schema });
}
```

Rules:
- Use `txDb()` **only** for transactional writes. Everything else uses `db()`.
- Never import `src/db/pool.ts` into a Client Component.

**Verify:** `npm run build` passes.

---

### B2 · RSVP service — THE highest-risk code in the project
**Depends on:** B1
**Files:** create `src/lib/rsvp.ts`, `src/lib/rsvp.test.ts`

If 40 people tap RSVP at 8:00:00 PM for a 20-person practice, a naive
count-then-insert admits more than 20 and someone shows up to a full court.

**Required transaction shape — do not deviate:**

```ts
await txDb().transaction(async (tx) => {
  // 1. Lock the event row. Every concurrent RSVP for this event serializes here.
  const [event] = await tx
    .select()
    .from(events)
    .where(eq(events.id, eventId))
    .for("update");
  if (!event) throw new RsvpError("not_found");

  // 2. Gate checks INSIDE the transaction.
  if (!event.published) throw new RsvpError("not_published");
  if (event.rsvpOpensAt && event.rsvpOpensAt > new Date())
    throw new RsvpError("not_open");
  if (event.startsAt < new Date()) throw new RsvpError("past");

  // 3. Re-activate a prior cancellation rather than inserting a duplicate.
  const existing = await tx.select().from(rsvps)
    .where(and(eq(rsvps.eventId, eventId), eq(rsvps.memberId, memberId)));
  if (existing.length && existing[0].status !== "cancelled")
    throw new RsvpError("already_rsvpd");

  // 4. Count confirmed, decide confirmed vs waitlist.
  const confirmed = await tx.$count(rsvps,
    and(eq(rsvps.eventId, eventId), eq(rsvps.status, "confirmed")));
  const status = event.capacity === null || confirmed < event.capacity
    ? "confirmed" : "waitlist";

  // 5. Position is per-status, 1-based.
  // 6. Insert or update. UNIQUE(event_id, member_id) is the backstop.
});
```

Export:
```ts
rsvp(eventId, memberId)            -> { status, position }
cancelRsvp(eventId, memberId)      -> { promoted: Member | null }
listRsvps(eventId)                 -> rows joined to users, confirmed then waitlist
```

`cancelRsvp` requirements:
- Same `FOR UPDATE` lock on the event row.
- If the cancelling member was `confirmed`, promote the **lowest-position**
  waitlist entry to `confirmed` in the same transaction, and return it so the
  caller can email them.
- Re-pack positions so they stay contiguous.
- Cancelling after `cancelDeadline` is still allowed, but return a flag the UI
  can use to warn.

**Tests required in `src/lib/rsvp.test.ts`** — pure-function tests only, no DB.
Extract the decision logic into exported pure helpers and test them:

```
✔ assigns confirmed while under capacity
✔ assigns waitlist at exactly capacity
✔ treats null capacity as unlimited
✔ positions are 1-based and contiguous per status
✔ promotes the lowest waitlist position on cancel
✔ promotes nobody when the canceller was already on the waitlist
✔ rejects RSVP before rsvpOpensAt
✔ rejects RSVP for an event that already started
✔ re-activating a cancelled RSVP does not create a duplicate
```

**Verify:** `npm test` — all pass, including the 21 existing tests.

---

### B3 · Event server actions (exec)
**Depends on:** A2, B2
**Files:** create `src/app/(member)/exec/events/actions.ts`

Actions: `createEvent`, `updateEvent`, `deleteEvent`, `togglePublished`.

1. Every action calls `requireExec()` **first**.
2. Zod schema for input. Required: type, title, location, startsAt, endsAt.
   `capacity` nullable (null = unlimited). Practices default to 20.
3. Reject `endsAt <= startsAt`.
4. Reject `rsvpOpensAt > startsAt`.
5. `deleteEvent` refuses if any confirmed RSVPs exist — require unpublish first.
   Deleting an event people are counting on must not be a single click.
6. `revalidatePath()` the affected routes.
7. Return `{ ok: true }` or `{ ok: false, error: string }`. Never throw raw
   errors to the client.

**Verify:** `npm run lint && npm run build`.

---

### B4 · Exec event admin UI
**Depends on:** B3
**Files:** create `src/app/(member)/exec/events/page.tsx`,
`src/app/(member)/exec/events/event-form.tsx`

1. Page calls `requireExec()`.
2. Table of events: title, type, date, RSVP count vs capacity, published badge.
3. Create/edit form — client component, `useActionState`, inline field errors.
4. Datetime inputs in America/Los_Angeles. Label the timezone visibly.
5. Creating a practice prefills capacity 20 and level.
6. Per-event "View RSVPs" showing confirmed and waitlist in position order.
7. Destructive actions need a confirm step.

**Verify:** build passes; an exec can create an event and see it listed.

---

### B5 · Member events list + RSVP
**Depends on:** B2, A5
**Files:** replace `src/app/events/page.tsx`; create
`src/app/(member)/events/page.tsx`, `src/app/(member)/events/[id]/page.tsx`,
`src/app/(member)/events/actions.ts`

1. `/events` (public) stays a teaser for signed-out visitors and links to login.
2. `/(member)/events` — **mobile agenda list first**, grouped by date. The month
   grid is explicitly out of MVP scope; do not build it.
3. Event detail shows: title, when, where, capacity meter, attendee count, and
   the RSVP or Cancel button.
4. Capacity meter uses `@number-flow/react` (already installed) for the count.
5. RSVP button states: Open · Full (join waitlist) · You're in (#N) ·
   Waitlisted (#N) · Opens {date} · Closed.
6. Actions call `requireMember()` then `rsvp()` / `cancelRsvp()` from B2.
7. Use optimistic UI (`useOptimistic`), but **reconcile against the server
   result** — the server decides confirmed vs waitlist, never the client.
8. Show a `sonner` toast on success and on failure.
9. Mobile: the RSVP button must be reachable with one thumb. Use `vaul` for a
   bottom-sheet confirm.

**Verify:** `npm test && npm run lint && npm run build`.

---

## TRANCHE C — Roster and member management

### C1 · Pending approvals (exec)
**Depends on:** A2
**Files:** `src/app/(member)/exec/members/page.tsx`, `.../actions.ts`

1. `requireExec()`.
2. List `status = 'pending'` users with email, name, signup date.
3. Approve / Block actions, Zod-validated, `revalidatePath`.
4. Bulk approve via checkboxes.
5. Empty state: "No one is waiting for approval."

---

### C2 · Member roster + exec notes
**Depends on:** C1
**Files:** `src/app/(member)/exec/members/[id]/page.tsx`

1. `requireExec()`.
2. Profile: name, email, derived level, role, status, RSVP history.
3. Exec notes — add and list, newest first, each showing author and date.
4. **Notes are never visible to the member.** Verify the member-facing profile
   page does not query `member_notes` at all.
5. Role assignment is `requireAdmin()` only, not exec.

---

### C3 · Derived skill level
**Depends on:** B2
**Files:** `src/lib/derive-level.ts` + test

1. Pure function: given a member's RSVP history, return the `level` of the most
   recent **attended or confirmed** practice. `unknown` if none.
2. Call it after RSVP confirm and after cancel; write to `users.derivedLevel`.
3. Never overwrite a non-`unknown` value with `unknown`.

**Tests:** most-recent wins; ignores socials; ignores cancelled; empty → unknown.

---

## TRANCHE D — Email

### D1 · Resend + templates
**Install:** `npm i resend @react-email/components`
**Files:** `src/lib/email.ts`, `src/emails/*.tsx`
**Env:** add `RESEND_API_KEY`, `EMAIL_FROM` to `src/lib/env.ts` and `.env.example`

Templates: `RsvpConfirmed`, `WaitlistPromoted`, `EventCancelled`.

1. Navy/gold branding matching the site.
2. Every email includes event name, date/time in PT, and location.
3. **Sending must never break the request.** Wrap in try/catch, log failures,
   and still return success to the user — a dropped email must not roll back a
   confirmed RSVP.
4. Make `EMAIL_FROM` and `RESEND_API_KEY` optional in dev: if unset, log the
   email to the console instead of sending.

### D2 · Wire to RSVP
1. `WaitlistPromoted` fires from `cancelRsvp`'s promotion result.
2. `RsvpConfirmed` fires on successful confirm.

---

## TRANCHE E — Google Calendar (post-MVP)

**Read `PLAN.md` "Key decisions" first.** The club account is a plain Gmail, and
members are added as **attendees** — there is no per-user OAuth.

- **E1** Club OAuth: one-time authorization as `pickleballatberkeley@gmail.com`,
  refresh token in env. The Google Cloud app **must be published to Production**,
  not left in Testing, or the refresh token expires every 7 days.
- **E2** Create/update the event on the club calendar when an exec publishes it;
  store `gcal_event_id`.
- **E3** On RSVP confirm, add the member as an attendee. On cancel, remove them.
  Use `sendUpdates: "all"` on first add.
- **E4** Always also render an `.ics` download and an "Add to Google Calendar"
  template URL. This path has no dependency on invite settings and must work
  even if E1–E3 are broken.

---

## TRANCHE F — Intramural tournament (post-MVP)

Format is fixed: **pools of 8, full round robin (7 matches each), top 3 per pool
into single elimination.** Two divisions, Beginner and Advanced.

- **F1 Registration + partner invite.** Captain registers, invites a partner by
  roster email. Team is `registered` only once the partner accepts. Free-agent
  pool for members without a partner.
- **F2 Draw.** Admin closes registration and generates pools of 8 and all
  C(8,2)=28 matches per pool. Seed by `derivedLevel`, then random. Handle a team
  count that isn't a multiple of 8 (allow pools of 7 — those teams play 6).
  **All pool matches share one `pool_play_ends_at` deadline — do not create
  weekly rounds.** Round-robin matches have no inter-dependency; teams must be
  able to play three in one week.
- **F3 Standings.** Use `computeStandings()` from `src/lib/standings.ts`
  unchanged. Render the pool table with W-L, game diff, point diff, and a
  visible cut line after 3rd. Surface a `tiebreak: "unresolved"` row as an
  explicit admin prompt — never hide it.
- **F4 Score reporting.** Any one of the four players submits best-of-3 game
  scores. Validate: 2 or 3 games, a winner consistent with the games, each game
  to 11 win-by-2 (or 15 — make it a tournament setting). Email the other three
  with a dispute link. Auto-confirm after `autoconfirm_hours` (default 24)
  unless disputed. Disputes go to `requireAdmin()`.
- **F5 Knockout.** Admin seeds 3 per pool into single elim, byes to top seeds.
  Auto-advance winners via `next_match_id` / `next_slot`.
- **F6 Nudges.** Weekly email to teams with unplayed pool matches. This is the
  single most important operational feature — self-scheduled matches slip.

---

## TRANCHE G — Deploy (post-MVP)

- **G1** `npm i -D @opennextjs/cloudflare wrangler`, add `wrangler.toml`, deploy
  to Cloudflare Workers. Set all env vars as Worker secrets.
- **G2** Move `public/media/*` to R2. See `MEDIA.md` for encoding.
- **G3** Cron triggers: auto-confirm expiring match reports (hourly), event
  reminders at 24h and 2h, weekly unplayed-match nudges.

---

## Traps — these will bite you

1. **`db()` cannot do transactions.** neon-http is one request per query. Use
   `txDb()` from `src/db/pool.ts` for anything transactional. (B1/B2)
2. **Lucide has no brand icons.** `Instagram`, `Google` etc. do not exist. Add
   inline SVG to `src/components/ui/icons.tsx`.
3. **Next 16 typed routes.** A `<Link href="/foo">` to a route that doesn't
   exist is a *build* error, not a 404. Create the page before linking to it.
4. **`env()` is a function, not an object.** Call `env().DATABASE_URL`. It is
   lazy on purpose — `next build` prerenders public pages with no secrets set.
5. **Sign-in is not domain-restricted, but auto-approval is.** `canSignIn`
   only checks that Google verified the email — any account can sign in,
   roster or not, Berkeley or not. This is also why the club Gmail (not
   `@berkeley.edu`) can log into its own admin panel — it's in `ADMIN_EMAILS`,
   which always auto-approves regardless of domain. But `initialAccess`
   (strict mode) only auto-approves a roster email if it's *also* on
   `ALLOWED_EMAIL_DOMAIN` — a roster entry on some other domain (a sponsor, a
   coach who ended up in the CSV) still lands in `pending` for a human to
   approve. Being on the roster alone isn't enough.
6. **Test imports need the `.ts` extension** (`from "./access.ts"`) because
   `node --test` runs them as real ESM.
7. **Never trust hidden UI for authorization.** Re-check `requireExec()` /
   `requireAdmin()` inside every server action.
8. **Don't add border-radius.** Sharp corners are the brand.
9. **Practice times are still `TODO` in `content.ts`.** Do not invent them.

---

## Definition of done for MVP

- [ ] A berkeley.edu student signs in with Google and reaches `/dashboard`
- [ ] A non-berkeley account is refused with a readable message
- [ ] An off-roster student lands on `/pending`, not a crash
- [ ] An exec creates a practice with capacity 20 and publishes it
- [ ] 20 members RSVP and are confirmed; the 21st is waitlisted at position 1
- [ ] A confirmed member cancels; the waitlisted member is promoted and emailed
- [ ] The whole RSVP flow is usable one-handed on a phone
- [ ] `npm test && npm run lint && npm run build` all pass
