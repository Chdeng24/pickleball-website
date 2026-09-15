# Setup — the parts that need your accounts

Everything below is one-time. ~15 minutes. Do it with the club Gmail signed in.

## 1. Database (Neon, free)

1. https://neon.tech -> sign in with `pickleballatberkeley@gmail.com` -> new project
2. Copy the connection string into `.env` as `DATABASE_URL`
3. `npm run db:push` — creates every table

## 2. Google OAuth

1. https://console.cloud.google.com -> new project, "Pickleball at Berkeley"
2. **APIs & Services -> OAuth consent screen**
   - User type: **External**
   - App name, support email, logo (use `public/brand/logo.png`)
   - Scopes: leave at the defaults for now (`email`, `profile`, `openid`) —
     these are **non-sensitive**, so there is no verification review and no user cap
   - **PUBLISH THE APP.** Do not leave it in "Testing".
     In Testing mode Google expires refresh tokens every 7 days and the calendar
     sync will silently die every week.
3. **Credentials -> Create OAuth client ID -> Web application**
   - Authorized JavaScript origin: `http://localhost:3000`
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
   - Add the production equivalents once the domain exists
4. Copy the client ID and secret into `.env`

## 3. Environment

```bash
cp .env.example .env
npx auth secret          # writes AUTH_SECRET
```

Then fill in `DATABASE_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.

`ADMIN_EMAILS` and `ALLOWLIST_EMAILS` are pre-filled with your address and the
club Gmail. The club Gmail **must** stay in `ALLOWLIST_EMAILS` — it is not an
`@berkeley.edu` address, so it cannot pass the domain gate on its own and would
otherwise be locked out of its own admin panel.

## 4. Import the roster

```bash
npm run roster:import roster.csv            # preview — writes nothing
npm run roster:import roster.csv -- --commit # actually import
```

The CSV needs an `email` column; `name` and `note` are optional. A bare list of
one email per line also works. See `roster.example.csv`.

Re-running is safe — existing emails are updated, never duplicated. Anyone already
sitting in `pending` who appears in the new file is promoted to `approved`
automatically, so you can import mid-semester without chasing people down.

Emails in the file but **not** re-listed on a later import are left alone. Removing
someone who left the club is a deliberate manual step.

## 5. Later — Google Calendar

Only needed for phase 5. Requires adding the `calendar.events` scope (sensitive)
and authorizing **once** as the club Gmail. Because exactly one account ever
authorizes it, the 100-user cap for unverified apps is never a factor.

---

## Verify it works

```bash
npm test          # access-control rules
npm run lint
npm run build
npm run dev
```
