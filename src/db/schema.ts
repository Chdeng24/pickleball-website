import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

/* ─── Enums ──────────────────────────────────────────────────────────────── */

export const roleEnum = pgEnum("role", ["member", "exec", "admin"]);
export const memberStatusEnum = pgEnum("member_status", [
  "pending",
  "approved",
  "blocked",
]);
export const levelEnum = pgEnum("level", ["unknown", "beginner", "advanced"]);
export const eventTypeEnum = pgEnum("event_type", [
  "practice",
  "social",
  "fundraiser",
  "tournament",
]);
export const rsvpStatusEnum = pgEnum("rsvp_status", [
  "confirmed",
  "waitlist",
  "cancelled",
]);

/* ─── Auth.js core tables ────────────────────────────────────────────────── */
/* `users` is extended with club fields — one row per person, no join needed. */

export const users = pgTable("user", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),

  // Club fields
  role: roleEnum("role").notNull().default("member"),
  status: memberStatusEnum("status").notNull().default("pending"),
  /** Derived from the most recent Social Team practice RSVP — never self-reported. */
  derivedLevel: levelEnum("derived_level").notNull().default("unknown"),
  /** True when the email came from a roster CSV rather than self-signup. */
  onRoster: boolean("on_roster").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "account",
  {
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

/* ─── Roster allowlist ───────────────────────────────────────────────────── */
/**
 * The imported CSV. An email here is pre-approved; sign-in matches against it.
 * Kept separate from `users` so we can load the roster before anyone logs in.
 */
export const rosterEmails = pgTable("roster_email", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Always stored lowercased + trimmed. Match on this, never on raw input. */
  email: text("email").notNull().unique(),
  name: text("name"),
  note: text("note"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  importedBy: uuid("imported_by").references(() => users.id, { onDelete: "set null" }),
});

/** Exec-only notes on a member. Never visible to the member themselves. */
export const memberNotes = pgTable("member_note", {
  id: uuid("id").defaultRandom().primaryKey(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ─── Events + RSVP ──────────────────────────────────────────────────────── */

export const events = pgTable("event", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: eventTypeEnum("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  /** beginner | advanced for practices; null for socials. Feeds derivedLevel. */
  level: levelEnum("level").notNull().default("unknown"),
  location: text("location").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  /** null = uncapped (socials, fundraisers). 20 for practices. */
  capacity: integer("capacity"),
  rsvpOpensAt: timestamp("rsvp_opens_at", { withTimezone: true }),
  cancelDeadline: timestamp("cancel_deadline", { withTimezone: true }),
  /** Event id on the club's Google Calendar, for attendee sync. */
  gcalEventId: text("gcal_event_id"),
  published: boolean("published").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rsvps = pgTable(
  "rsvp",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: rsvpStatusEnum("status").notNull(),
    /** Ordering within confirmed/waitlist. Drives auto-promotion. */
    position: integer("position").notNull(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One row per person per event — the backstop behind the capacity transaction.
  (t) => [unique("rsvp_event_member_unique").on(t.eventId, t.memberId)],
);

/* ─── Tournaments ────────────────────────────────────────────────────────── */

export const tournamentKindEnum = pgEnum("tournament_kind", [
  "im_semester",
  "one_day",
]);
export const divisionEnum = pgEnum("division", ["beginner", "advanced"]);
export const tournamentStatusEnum = pgEnum("tournament_status", [
  "draft",
  "registration",
  "pools",
  "knockout",
  "complete",
]);
export const teamStatusEnum = pgEnum("team_status", [
  "registered",
  "active",
  "eliminated",
  "forfeited",
  "withdrawn",
]);
export const inviteStatusEnum = pgEnum("invite_status", [
  "pending",
  "accepted",
  "declined",
]);
export const matchStageEnum = pgEnum("match_stage", ["pool", "knockout"]);
export const matchStatusEnum = pgEnum("match_status", [
  "pending",
  "reported",
  "confirmed",
  "disputed",
  "forfeited",
]);

export const tournaments = pgTable("tournament", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  kind: tournamentKindEnum("kind").notNull(),
  division: divisionEnum("division").notNull(),
  status: tournamentStatusEnum("status").notNull().default("draft"),
  registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),
  /** Teams per pool. 8 gives each team 7 round-robin matches. */
  poolSize: integer("pool_size").notNull().default(8),
  /** Teams advancing out of each pool into the knockout. */
  advancePerPool: integer("advance_per_pool").notNull().default(3),
  /**
   * Pool play runs as one open window, not as sequential weekly rounds.
   * Round-robin matches have no dependency on each other, so teams schedule
   * their 7 games whenever both pairs are free — and can bank several in a
   * week to get ahead. Every pool match shares this single deadline.
   */
  poolPlayEndsAt: timestamp("pool_play_ends_at", { withTimezone: true }),
  knockoutStartsAt: timestamp("knockout_starts_at", { withTimezone: true }),
  /** Hours the other players have to dispute before a score auto-confirms. */
  autoconfirmHours: integer("autoconfirm_hours").notNull().default(24),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tmTeams = pgTable("tm_team", {
  id: uuid("id").defaultRandom().primaryKey(),
  tournamentId: uuid("tournament_id")
    .notNull()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  seed: integer("seed"),
  /** Pool label: "A", "B", ... Null until the draw runs. */
  pool: text("pool"),
  status: teamStatusEnum("status").notNull().default("registered"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tmTeamMembers = pgTable(
  "tm_team_member",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => tmTeams.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isCaptain: boolean("is_captain").notNull().default(false),
    inviteStatus: inviteStatusEnum("invite_status").notNull().default("pending"),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.memberId] })],
);

export const matches = pgTable("match", {
  id: uuid("id").defaultRandom().primaryKey(),
  tournamentId: uuid("tournament_id")
    .notNull()
    .references(() => tournaments.id, { onDelete: "cascade" }),
  stage: matchStageEnum("stage").notNull(),
  /** Pool label for pool matches; null in knockout. */
  pool: text("pool"),
  /**
   * Knockout round, increasing toward the final. Null for pool matches — pool
   * play has no rounds, just one window in which all 28 matches can happen.
   */
  round: integer("round"),
  slot: integer("slot"),
  teamAId: uuid("team_a_id").references(() => tmTeams.id, { onDelete: "set null" }),
  teamBId: uuid("team_b_id").references(() => tmTeams.id, { onDelete: "set null" }),
  winnerTeamId: uuid("winner_team_id").references(() => tmTeams.id, {
    onDelete: "set null",
  }),
  status: matchStatusEnum("status").notNull().default("pending"),
  /** Deadline for the pair to play. Drives reminder emails and forfeits. */
  dueBy: timestamp("due_by", { withTimezone: true }),
  /** Where the winner lands. Null for pool matches and the final. */
  nextMatchId: uuid("next_match_id"),
  nextSlot: integer("next_slot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const matchReports = pgTable("match_report", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id")
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
  /** Best of 3, stored as [[11,7],[9,11],[11,5]]. */
  games: jsonb("games").$type<number[][]>().notNull(),
  winnerTeamId: uuid("winner_team_id")
    .notNull()
    .references(() => tmTeams.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set once the dispute window closes or an admin confirms early. */
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  disputedBy: uuid("disputed_by").references(() => users.id, { onDelete: "set null" }),
  disputeReason: text("dispute_reason"),
});

/** Required by the Auth.js adapter contract even though we only use OAuth. */
export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* ─── Relations (for db().query.*.findFirst({ with: {...} })) ──────────────── */

export const usersRelations = relations(users, ({ many }) => ({
  rsvps: many(rsvps),
  notes: many(memberNotes, { relationName: "notesAboutMember" }),
}));

export const eventsRelations = relations(events, ({ many }) => ({
  rsvps: many(rsvps),
}));

export const rsvpsRelations = relations(rsvps, ({ one }) => ({
  event: one(events, { fields: [rsvps.eventId], references: [events.id] }),
  member: one(users, { fields: [rsvps.memberId], references: [users.id] }),
}));

export const memberNotesRelations = relations(memberNotes, ({ one }) => ({
  member: one(users, {
    fields: [memberNotes.memberId],
    references: [users.id],
    relationName: "notesAboutMember",
  }),
  author: one(users, { fields: [memberNotes.authorId], references: [users.id] }),
}));

export const rosterEmailsRelations = relations(rosterEmails, ({ one }) => ({
  importedByUser: one(users, { fields: [rosterEmails.importedBy], references: [users.id] }),
}));

export const tournamentsRelations = relations(tournaments, ({ many }) => ({
  teams: many(tmTeams),
  matches: many(matches),
}));

export const tmTeamsRelations = relations(tmTeams, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [tmTeams.tournamentId], references: [tournaments.id] }),
  members: many(tmTeamMembers),
}));

export const tmTeamMembersRelations = relations(tmTeamMembers, ({ one }) => ({
  team: one(tmTeams, { fields: [tmTeamMembers.teamId], references: [tmTeams.id] }),
  member: one(users, { fields: [tmTeamMembers.memberId], references: [users.id] }),
}));

export const matchesRelations = relations(matches, ({ one, many }) => ({
  tournament: one(tournaments, { fields: [matches.tournamentId], references: [tournaments.id] }),
  teamA: one(tmTeams, { fields: [matches.teamAId], references: [tmTeams.id] }),
  teamB: one(tmTeams, { fields: [matches.teamBId], references: [tmTeams.id] }),
  winnerTeam: one(tmTeams, { fields: [matches.winnerTeamId], references: [tmTeams.id] }),
  reports: many(matchReports),
}));

export const matchReportsRelations = relations(matchReports, ({ one }) => ({
  match: one(matches, { fields: [matchReports.matchId], references: [matches.id] }),
  reportedByUser: one(users, { fields: [matchReports.reportedBy], references: [users.id] }),
  winnerTeam: one(tmTeams, { fields: [matchReports.winnerTeamId], references: [tmTeams.id] }),
}));
