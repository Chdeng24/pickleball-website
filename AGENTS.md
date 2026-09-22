# Pickleball at Berkeley

**If you are here to build a feature, read `TASKS.md` first.** It is the build
spec: ordered tasks, file ownership, acceptance criteria, and a list of traps
specific to this repo. Do not improvise around it.

Supporting docs:

| File | What it is |
|---|---|
| `TASKS.md` | **The build spec.** Start here. Tranches A-G, do them in order. |
| `PLAN.md` | Architecture and the reasoning behind key decisions |
| `SETUP.md` | Neon + Google OAuth setup. A human must do this before Tranche A. |
| `MEDIA.md` | Drone footage encoding settings |
| `DEPLOY.md` | Cloudflare Workers deploy. A human must do this before going live (Tranche G). |

## Quick reference

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"   # node is not on PATH
npm run dev          # localhost:3000
npm test             # node --test over src/**/*.test.ts  (118 passing)
npm run test:league  # signup edge cases against the real DB, always rolled back
npm run test:rsvp    # RSVP edge cases + a 40-way race for 20 spots, against the real DB
npm run lint
npm run build
npm run db:push      # apply schema to Neon
npm run roster:import roster.csv -- --commit
```

**After every task: `npm test && npm run lint && npm run build` must all pass.**

## Non-negotiables

1. `src/lib/access.ts` and `src/lib/standings.ts` are tested and correct — do not
   change their behaviour.
2. All club copy lives in `src/lib/content.ts`. Never hardcode it in a component.
3. `db()` (neon-http) cannot do transactions. Transactional writes use `withTransaction()` from `src/db/pool.ts` (fresh pool per call — never cache it, Workers forbids cross-request sockets).
4. Re-check authorization inside every server action. Hiding a button is not
   access control.
5. No border-radius anywhere — sharp corners are the brand.
6. A `"use server"` file may export **only** async functions. Next enforces this
   at runtime, not build time, so an exported const there passes `npm run build`
   and then breaks every action in the file in production. Shared values go in
   `src/lib/content.ts`. `src/app/use-server-exports.test.ts` guards this.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
