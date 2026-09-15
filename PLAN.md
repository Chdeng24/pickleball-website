# Pickleball at Berkeley — Implementation Plan

## Stack (locked)
| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind v4, design tokens in `src/app/globals.css` |
| Host | Cloudflare Workers via `@opennextjs/cloudflare` |
| DB | Neon Postgres + Drizzle ORM |
| Media | Cloudflare R2 (zero egress) |
| Auth | Auth.js v5, Google, `hd=berkeley.edu` verified server-side |
| Calendar | Google Calendar API — club account only, members as attendees |
| Email | Resend + React Email |

**Running cost: ~$15/yr (domain only).** Everything else free-tier at 200 members.

## Phases

- [x] **1 · Foundation** — Next.js + Tailwind v4, brand tokens, fonts, logo, deploy-ready build
- [x] **2 · Public site** — Home (video hero, stats, teams, practices, sponsors), About, Social Team, Comp Team, Events placeholder, Sponsors, Login shell
- [ ] **2b · Real content + media** — swap TODOs in `src/lib/content.ts`, drone loop, team photos
- [ ] **2c · Deploy to Cloudflare** — custom domain, R2 bucket for media
- [~] **3 · Auth + roster** — DONE: schema, Auth.js config, server-side `hd` check,
      roster allowlist + CSV import, role seeding, 12 passing access tests.
      TODO: member area UI, exec approval screen, profile page. Needs `.env` (see SETUP.md)
- [ ] **4 · Events + RSVP** — admin CRUD, capacity-safe RSVP, waitlist auto-promotion, RSVP windows, cancel deadlines
- [ ] **5 · Calendar** — mobile agenda list, desktop month grid, `.ics` links, Google Calendar sync
- [ ] **6 · Intramural tournament** — pools of 8 (round robin, 7 matches each) into single-elim playoffs for the top 3 per pool; partner invites, draw, self-scheduled matches, one-player score reporting, 24h auto-confirm unless disputed, live standings, reminder emails
- [ ] **7 · One-day tournaments** — pool play into knockout, exec-run live scoring
- [ ] **8 · Retention** — email reminders, QR check-in, announcements, attendance export, PWA

## Key decisions

**Google Calendar — attendee model, not per-user OAuth.**
The club account owns two calendars (Practices, Events). On RSVP we add the member
as an *attendee*; Google puts it on their calendar. On cancel we remove them and it
disappears. One OAuth token total. Avoids the sensitive-scope 100-user cap and the
OAuth verification review entirely. Socials also get a public subscribable calendar.

**RSVP capacity is the highest-risk code.**
"First 20" is a race. Capacity check + insert must be one transaction:
```
BEGIN
  SELECT ... FROM events WHERE id = ? FOR UPDATE   -- serialize on the event row
  count confirmed -> assign 'confirmed' or 'waitlist' + position
  INSERT rsvp                                       -- UNIQUE(event_id, member_id)
COMMIT
```
Neon Postgres chosen over Cloudflare D1 specifically because it gives real
interactive transactions with row locks.

**Two auth gates, not one.** Verify the `hd` claim server-side (the client param is
spoofable), *then* check the roster allowlist. Domain alone would let any Berkeley
student take a practice spot.

**Mobile first, genuinely.** Hero video only mounts >=768px and when reduced-motion
is off — phones get the poster. Most RSVPs happen on a phone between classes.

## Roles

| Role | Who | Can |
|---|---|---|
| `member` | Any approved @berkeley.edu | RSVP, register for tournaments, report own scores |
| `exec` | Board members | Create/edit events, view roster + private notes, run tournaments |
| `admin` | chdeng@berkeley.edu, pickleballatberkeley@gmail.com | Everything + approve match scores + assign roles |

Seeded from `ADMIN_EMAILS` / `EXEC_EMAILS` env vars so there's no chicken-and-egg
on first deploy.

**The club account is a plain @gmail.com, not a Workspace account.** That means the
auth gate cannot be domain-only:

```
allow if  hd === "berkeley.edu"        // verified server-side, not the client param
      or  email in ALLOWLIST_EMAILS    // club gmail + any non-berkeley exec
```

## Intramural tournament — design notes

Semester-long doubles, run like campus IM. Two independent divisions (Beginner,
Advanced). Members self-schedule; the site tracks pairings, standings and results.

**Format:** pools of 8, full round robin — every team is guaranteed **7 matches**.
Top 3 from each pool advance to single elimination.

**Flow:** register as a pair (or enter free-agent pool) -> exec closes registration
and draws pools -> all 28 pool matches per pool open at once with a single
`pool_play_ends_at` deadline -> teams play best of 3, self-officiated -> any ONE of
the four players reports -> auto-confirms after 24h unless disputed -> standings
recompute -> exec seeds the knockout from final pool tables.

**Pool play is one open window, not weekly rounds.** Round-robin matches have no
dependency on each other, so a pair can bank three games in one week to get ahead
of midterms. This is the single biggest scheduling advantage over a pure bracket.

**Timing.** 7 pool matches at roughly one per week is ~7-8 weeks, plus ~4 knockout
rounds. That is 11-12 weeks of a ~15 week semester with little slack, and
self-scheduled matches do slip. Mitigations: open the whole pool window at once
(above), send nudges to teams with unplayed matches, and let exec shorten the
window or drop to top-2-advance if things run late.

**Standings and ties.** With 8-team pools and 3 spots, ties decide who advances.
Order: match wins -> head-to-head (2 teams) or mini-league among the tied group
(3+) -> game differential -> point differential. A genuinely identical tie is
surfaced as `unresolved` for exec rather than silently guessed.
Implemented and tested in `src/lib/standings.ts`.

**Score confirmation — recommended hybrid.** Requiring admin approval on all 63
matches per bracket (126 across both) is ~10 clicks a week for one person. Instead:
when a score is reported, the other three players are emailed and get 24h to
dispute. Silence auto-confirms. Disputes route to admin. Admin keeps a manual
override on every match either way. Configurable via `TOURNAMENT_AUTOCONFIRM_HOURS`.

**Edge cases that will actually happen:**
- *Match not played by `due_by`* — the single most common failure in self-scheduled
  brackets. Needs an admin action: extend, forfeit one side, or coin-flip advance.
- *Disputed score* — flagged, not silently overwritten.
- *Registration isn't a power of 2* — 37 teams means a 64 bracket with 27 byes,
  assigned to top seeds.
- *Partner drops mid-bracket* — admin can sub a replacement or forfeit the team.
- *Seeding* — default to `derived_level` from practice attendance, then random
  within band.

## Member skill level

Not self-reported. `derived_level` is computed from the most recent Social Team
practice the member RSVP'd to (`beginner` or `advanced` practice), which is free
signal we already collect. Used to suggest an intramural division and to give exec
a rough roster picture. Falls back to `unknown` for members who haven't attended.

## Exec notes on members

`member_notes` — free-text, authored by exec, for tracking Competitive Team
candidates. Visible only to `exec` and `admin`, never to the member. Worth a line in
the privacy policy saying exec keeps notes, since it's real data about real people.

## Data model (planned)
```
members       id, email, name, avatar, role(member|exec|admin),
              status(pending|approved|blocked), derived_level, created_at
member_notes  id, member_id, author_id, body, created_at        -- exec-only
events        id, type(practice|social|fundraiser|tournament), title, description,
              starts_at, ends_at, location, capacity, rsvp_opens_at,
              cancel_deadline, gcal_event_id, published
rsvps         id, event_id, member_id, status(confirmed|waitlist|cancelled),
              position, checked_in_at   -> UNIQUE(event_id, member_id)

tournaments   id, name, kind(im_semester|one_day), division(beginner|advanced),
              status(registration|active|complete), registration_closes_at,
              bracket_size, autoconfirm_hours
tm_teams      id, tournament_id, name, seed, status(active|eliminated|forfeited)
tm_members    team_id, member_id, is_captain, invite_status(pending|accepted)
matches       id, tournament_id, round, slot, team_a_id, team_b_id, winner_team_id,
              status(pending|reported|confirmed|disputed|forfeited),
              due_by, next_match_id, next_slot
match_reports id, match_id, reported_by, games jsonb, winner_team_id,
              created_at, confirmed_at, disputed_by, dispute_reason

sponsors      id, name, logo_url, tier, url
announcements id, body, level, active_until
```

## Content ownership
All club copy lives in `src/lib/content.ts` — one file, no code changes needed for
officer turnover, new sponsors, or schedule changes. Search `TODO` for open items.
