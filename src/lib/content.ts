/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  SINGLE SOURCE OF TRUTH FOR ALL CLUB CONTENT
 *  Officers can edit this one file to update the whole public site.
 *  Anything marked TODO is a placeholder awaiting real info.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const club = {
  name: "Pickleball at Berkeley",
  shortName: "Pickleball at Berkeley",
  tagline: "Social + Competitive",
  founded: "Fall 2025",
  foundedYear: 2025,
  email: "pickleballatberkeley@gmail.com",
  instagram: "https://instagram.com/pickleballatberkeley",
  instagramHandle: "@pickleballatberkeley",
  blurb:
    "We are UC Berkeley's pickleball club — a home for 150+ students who want to play, improve, and find their people on the court. Whether you picked up a paddle last week or you're chasing tournament wins, there's a place for you here.",
};

export const stats = [
  { value: 150, suffix: "+", label: "Active members" },
  { value: 2, suffix: "", label: "Weekly practices" },
  { value: 3, suffix: "", label: "Courts reserved" },
  { value: 2025, suffix: "", label: "Founded", plain: true },
];

/** Where the Social Team plays. */
export const venue = {
  name: "Golden Bear Tennis Courts",
  detail: "Clark Kerr Campus",
  short: "Clark Kerr — Golden Bear Courts",
};

export type Practice = {
  id: string;
  team: "social" | "competitive";
  title: string;
  level: string;
  day: string;
  time: string;
  location: string;
  capacity: number;
  note: string;
};

export const practices: Practice[] = [
  {
    id: "beginner",
    team: "social",
    title: "Beginner / Social Practice",
    level: "New to 3.0",
    day: "TODO — day", // TODO: confirm day
    time: "TODO — time", // TODO: confirm time
    location: venue.short,
    capacity: 20,
    note: "Drills, basics, and open play. No experience needed — paddles provided.",
  },
  {
    id: "advanced",
    team: "social",
    title: "Advanced Practice",
    level: "3.5+",
    day: "TODO — day", // TODO: confirm day
    time: "TODO — time", // TODO: confirm time
    location: venue.short,
    capacity: 20,
    note: "Faster-paced drilling and competitive games. Bring your own paddle.",
  },
];

export const teams = [
  {
    slug: "social",
    name: "Social Team",
    kicker: "Open to everyone",
    description:
      "Our largest community — 150+ members who play twice a week, hit socials, and keep things low-pressure. No tryouts, no experience required. Just show up, RSVP, and play.",
    highlights: [
      "Two weekly practices, beginner and advanced",
      "Semester-long intramural doubles tournament",
      "Socials, fundraisers, and one-day tournaments",
      "First 20 to RSVP get a spot — court capacity",
    ],
  },
  {
    slug: "competitive",
    name: "Competitive Team",
    kicker: "By tryout",
    description:
      "Our travel and tournament roster. Competitive Team members represent Berkeley at collegiate events across California, with structured training and coaching throughout the season.",
    highlights: [
      "Tryouts at the start of each semester", // TODO confirm
      "Structured training blocks and match play",
      "Collegiate tournament travel", // TODO: name the circuits/events
      "Team kit and sponsor gear",
    ],
  },
] as const;

/** The two flagship competitive programs open to all members. */
export const tournamentPrograms = [
  {
    id: "intramural",
    kicker: "Semester long",
    name: "Intramural Doubles",
    summary:
      "Grab a partner, register free, and get drawn into a pool of 8. You're guaranteed 7 matches against every other team in your pool — play them on your own schedule, then the top 3 advance to playoffs.",
    points: [
      "Two separate divisions — Beginner and Advanced",
      "Find your own partner, or enter the free-agent pool",
      "Pools of 8 — 7 guaranteed matches, best of 3",
      "Play them in any order, whenever both pairs are free",
      "Top 3 from each pool advance to single-elimination playoffs",
      "Any one player reports the score; standings update instantly",
    ],
  },
  {
    id: "one-day",
    kicker: "Every 4–8 weeks",
    name: "Club Tournaments",
    summary:
      "A full tournament run in a single day at Clark Kerr. Pool play into a knockout bracket, run on-site by exec.",
    points: [
      "One day, start to finish",
      "Split by level so games stay competitive",
      "Run and scored on-site by exec",
      "Prizes and sponsor giveaways",
    ],
  },
];

// TODO: replace with real officers
export const officers = [
  { name: "TODO", role: "President", photo: null },
  { name: "TODO", role: "Vice President", photo: null },
  { name: "TODO", role: "Social Chair", photo: null },
  { name: "TODO", role: "Competitive Captain", photo: null },
];

// TODO: replace with real sponsors as they come in
export const sponsors = [
  { name: "Your Brand Here", tier: "founding", url: null },
  { name: "Your Brand Here", tier: "founding", url: null },
  { name: "Your Brand Here", tier: "supporting", url: null },
  { name: "Your Brand Here", tier: "supporting", url: null },
];

export const sponsorPitch = {
  headline: "Put your brand in front of 150+ Berkeley students.",
  points: [
    { stat: "150+", label: "Active members" },
    { stat: "2x", label: "Practices every week, all semester" },
    { stat: "100%", label: "UC Berkeley students, verified by .edu login" },
  ],
};

export const nav = [
  { href: "/about", label: "About" },
  { href: "/teams/social", label: "Social Team" },
  { href: "/teams/competitive", label: "Comp Team" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/events", label: "Events" },
  { href: "/sponsors", label: "Sponsors" },
];
