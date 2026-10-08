# Pickleball at Berkeley

**Live:** [pickleballatberkeley.com](https://pickleballatberkeley.com) · **Instagram:** [@pickleballatberkeley](https://www.instagram.com/pickleballatberkeley/)

The website and member platform for UC Berkeley's pickleball club. It replaced a
patchwork of Google Forms, spreadsheets and group chats with one system for practice
sign-ups, membership and a full season-long league — used by 130+ members.

Built and maintained by [Caleb Deng](https://github.com/Chdeng24).

---

## What it does

**Public site** — club info, teams, practice schedule, sponsors, and a month-view
event calendar.

**Members**
- Google sign-in, with access gated by the club roster (exec approves anyone else)
- RSVP to practices with hard capacity limits, an automatic waitlist, and email
  confirmations and 24-hour reminders
- Practice check-in, with a no-show strike policy

**League** — two divisions, 40+ doubles teams, run entirely on the site
- Sign up solo or invite a partner; free agents get paired by exec
- A strength-balanced weekly round robin generated automatically, then a seeded
  single-elimination playoff bracket
- Teams post their match time and report scores; the opponent confirms or
  disputes, and unanswered reports auto-confirm after 24 hours
- Live standings with real tiebreakers (head-to-head, game and point difference)
- One makeup ("skip") per team per season, late teams can take over open slots, and
  withdrawals turn into byes without reshuffling anyone else's schedule
- An hourly "league clock" that auto-confirms scores, settles unplayed matches,
  and sends the only two recurring emails: a "post your time" reminder and a
  "report tonight" reminder

**Exec dashboard** — event management, attendance, member approval and roles,
roster CSV import, and league tools (draw, swaps, result overrides, playoff
seeding, dispute rulings, schedule re-sends).

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, React Server Components, Server Actions), React 19, TypeScript |
| Styling | Tailwind CSS v4, Motion, Lucide icons |
| Database | Neon serverless Postgres, Drizzle ORM |
| Auth | Auth.js v5 (Google OAuth) with the Drizzle adapter |
| Email | Resend (batched sends) |
| Validation | Zod |
| Hosting | Cloudflare Workers via OpenNext |
| CI/CD | GitHub Actions — deploy on push to `main`, hourly cron for reminders and the league clock |
| Testing | Node's built-in test runner, plus scenario suites that run against a real Postgres database |

## Engineering highlights

- **Race-safe capacity.** "First 20 get a spot" is a race condition. Each RSVP
  runs in one transaction that locks the event row (`SELECT … FOR UPDATE`) before
  counting, and a stress test fires 40 concurrent RSVPs at 20 spots and checks
  that exactly 20 get in. Neon Postgres was chosen over Cloudflare D1 because it
  supports real interactive transactions.
- **Pure, tested scheduling.** The round robin (circle method), strength
  balancing, deadlines, playoff calendar and skip rules live in a pure module
  with no database access, so every rule is unit tested. Deadlines use Pacific
  calendar arithmetic, so they don't shift an hour at daylight-saving changes.
- **Every write is transactional and re-authorized.** Server actions re-check
  permissions on every call (hiding a button is not access control), and
  multi-step writes go through one transaction helper. Each request gets a fresh
  connection pool, because Workers doesn't allow sockets to be shared across
  requests.
- **Safe to test against production.** The DB scenario suites (sign-up edge cases,
  RSVP races, a full simulated season from draw to champion) run inside
  transactions that always roll back, on throwaway leagues and users.
- **Lean by design.** It runs on free tiers; the only running cost is the domain.

## Project structure

```
src/
  app/                 Routes: (public) site, (member) area, exec dashboard, API + cron endpoints
  components/          UI — site sections, league tables, team cards
  db/                  Drizzle schema (13 tables), connection + transaction helpers
  lib/                 Domain logic — access, RSVP, scheduling, standings, league engine, email
scripts/               Roster import and the database scenario test suites
.github/workflows/     Deploy and hourly cron
```

## Running locally

```bash
npm install
cp .env.example .env        # Neon, Google OAuth and Resend keys — see SETUP.md
npm run db:push
npm run dev                 # http://localhost:3000

npm test                    # unit tests
npm run test:season         # league engine against the real DB (always rolled back)
npm run lint && npm run build
```

Setup and deployment are documented in [`SETUP.md`](SETUP.md) and [`DEPLOY.md`](DEPLOY.md),
and the architecture decisions in [`PLAN.md`](PLAN.md).
