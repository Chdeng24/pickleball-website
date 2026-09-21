# Deploy — Cloudflare Workers

Everything below is one-time setup, then `npm run deploy` for every release after
that. Do it signed in as **`pickleballatberkeley@gmail.com`**, not your personal
account — see the note at the bottom on why.

The code side of this (adapter, `wrangler.jsonc`, build scripts) is already done.
What's left is the parts that need a real Cloudflare account.

## 1. Cloudflare account + CLI login

1. https://dash.cloudflare.com/sign-up -> sign up with the club Gmail (free plan
   is enough).
2. `npx wrangler login` — opens a browser, authorizes this machine against that
   account.

## 2. Set secrets

Every var in `.env` needs to exist as a Worker secret too — `.env` never leaves
your machine, Cloudflare only sees what you push explicitly:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put AUTH_SECRET
npx wrangler secret put AUTH_GOOGLE_ID
npx wrangler secret put AUTH_GOOGLE_SECRET
npx wrangler secret put ROSTER_MODE
npx wrangler secret put ALLOWED_EMAIL_DOMAIN
npx wrangler secret put ADMIN_EMAILS
npx wrangler secret put EXEC_EMAILS
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
npx wrangler secret put CRON_SECRET
```

Each prompts for a value and pastes go straight to Cloudflare, not into any
file. Use the same values as your `.env`.

Also add the production redirect URI in the Google Cloud OAuth client
(`SETUP.md` step 2) once you know the Worker's URL —
`https://YOURDOMAIN/api/auth/callback/google` — or the `workers.dev` URL if
you haven't attached a custom domain yet.

## 3. Register a workers.dev subdomain (one-time)

Cloudflare dashboard → **Workers & Pages** → if you haven't already, it'll
prompt you to pick a subdomain (e.g. `yourclub.workers.dev`) before your
first Worker URL actually resolves. Do this once, first, or the deploy
"succeeds" but the URL 404s/doesn't connect.

## 4. Deploy

**Recommended: let GitHub deploy it, not your laptop.** A GitHub Actions
deploy runs from GitHub's servers and re-deploys automatically on every push
to `main`.

1. Cloudflare dashboard -> profile icon (top right) -> **My Profile -> API
   Tokens -> Create Token** -> use the **"Edit Cloudflare Workers"** template
   -> Continue -> Create Token -> copy it.
2. Your GitHub repo -> **Settings -> Secrets and variables -> Actions** -> add
   a secret named `CLOUDFLARE_API_TOKEN` with that value.
3. Push to `main` (or Actions tab -> "Deploy to Cloudflare" -> Run workflow).
   `.github/workflows/deploy.yml` handles the rest.

First deploy prints a `*.workers.dev` URL in the Actions run log. Attach a
real domain afterward in the Cloudflare dashboard under Workers & Pages ->
your worker -> Settings -> Domains & Routes.

**If you still want to deploy from your own machine** (e.g. to test before
pushing):

```bash
npx opennextjs-cloudflare build
npx wrangler deploy
```

(`npm run deploy` also works now — the R2 cache pre-warm step that used to
hang has been removed entirely, see "Not yet built" below.)

## 5. Local preview against the Cloudflare build (optional)

`npm run dev` (plain `next dev`) is what you use day to day. To test the
*actual* Workers build before shipping it:

```bash
cp .dev.vars.example .dev.vars    # fill in the same values as .env
npm run preview                   # builds, then runs it under wrangler dev
```

## 6. Event reminder emails (24h before)

RSVP confirmation and waitlist-promotion emails already fire automatically —
no setup needed beyond step 2. The 24h-before reminder is different: Cloudflare
Workers has no built-in "run this every hour" for this kind of app, so
something outside the app has to call `/api/cron/event-reminders` on a
schedule. That route is protected by the `CRON_SECRET` you already set in
step 2 — without the right bearer token it just refuses.

Easiest free option, using GitHub Actions (works once the repo is on GitHub):

1. Repo → **Settings → Secrets and variables → Actions** → add two secrets:
   - `SITE_URL` — your deployed URL, e.g. `https://pickleball-website.<you>.workers.dev`
   - `CRON_SECRET` — the same value you set with `wrangler secret put CRON_SECRET`
2. The workflow file is already committed at
   `.github/workflows/event-reminders.yml` — it pings that route every hour.
   Nothing else to do; it starts running once the repo + secrets exist.

Test it manually any time from the repo's **Actions** tab → "Event reminders"
→ **Run workflow**.

## Media (drone footage)

`public/media/*` (see `MEDIA.md`) ships as part of the Worker's static assets
— Cloudflare serves those with the same free egress as everything else on the
platform, so there's no separate R2 step needed for it at the sizes MEDIA.md
targets (under ~4MB). If it ever grows past a few dozen MB of video, move it
to R2 and serve it through a route handler instead — not needed today.

## Email: verify the domain in Resend (do this before relying on emails)

`EMAIL_FROM` starts as `onboarding@resend.dev`, Resend's shared test sender.
Resend only lets that sender deliver to **the email address that owns the
Resend account** — every other recipient (partner invites, RSVP
confirmations, pool announcements, reminders) is rejected. The site never
crashes over this (failures are logged in Cloudflare's Worker logs as
"Resend rejected …"), and invites also show on the Tournaments tab, but
members won't get the emails until the domain is verified:

1. https://resend.com/domains → **Add Domain** → `pickleballatberkeley.com`.
2. Resend offers to add the DNS records to Cloudflare automatically — accept
   (or copy the records into Cloudflare → DNS by hand).
3. Once it shows **Verified**:
   `npx wrangler secret put EMAIL_FROM` → `Pickleball at Berkeley <noreply@pickleballatberkeley.com>`
   (and the same value in `.env`).

## Why the club Gmail, not your personal account

A Worker's secrets, R2 buckets, and DNS all live inside one Cloudflare
account. There's no clean "transfer this Worker to another account" — moving
later means recreating all of it. Your berkeley.edu login also stops existing
after you graduate. Cheapest path: create the account as the club Gmail once,
now. If you've already deployed under your own login, Cloudflare's **Members**
feature (Manage Account -> Members -> Invite) lets you add the club Gmail as
Super Administrator and remove yourself later — no redeploy needed.

---

## Not yet built

- **Google Calendar sync** (Tranche E in `TASKS.md`) — post-MVP, not part of
  this deploy pass.
- **Pickleball League** (registration with player caps, partner invites,
  free-agent pairing, pool draws, score reporting/disputes, weekly nudges) is
  built and live — see `npx wrangler secret put CRON_SECRET`
  above and the `event-reminders.yml` / `weekly-nudges.yml` GitHub Actions
  workflows, which also drive the tournament auto-confirm and weekly nudge
  crons now (not just event reminders).
- **Knockout bracket** (seeded single-elimination after pool play) isn't
  built — pool play currently ends in a ranked standings table, not an
  elimination bracket. Also not built: a **visual interactive bracket UI** —
  standings/results render as plain tables today.
