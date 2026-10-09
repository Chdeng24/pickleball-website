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
  url: "https://pickleballatberkeley.com",
  instagram: "https://instagram.com/pickleballatberkeley",
  instagramHandle: "@pickleballatberkeley",
  blurb:
    "UC Berkeley's pickleball club. 150+ students, from people who just picked up a paddle to players chasing tournament wins.",
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
  /** Matches the practice events exec posts — used to find this week's spots left. */
  level: "beginner" | "advanced";
  label: string;
  title: string;
  /** Shown with the upcoming Saturday's date. */
  time: string;
  location: string;
  capacity: number;
  note: string;
};

/** Social Team open play — every Saturday. The cards always show the upcoming Saturday. */
export const practices: Practice[] = [
  {
    id: "beginner",
    level: "beginner",
    label: "Beginner",
    title: "Beginner Open Play",
    time: "12–2 PM",
    location: venue.short,
    capacity: 20,
    note: "Open play.",
  },
  {
    id: "advanced",
    level: "advanced",
    label: "Advanced",
    title: "Advanced Open Play",
    time: "12–2 PM",
    location: venue.short,
    capacity: 20,
    note: "Open play.",
  },
];

export const teams = [
  {
    slug: "social",
    name: "Social Team",
    kicker: "Open to everyone",
    description: "Our biggest group. No tryouts and no experience needed — just RSVP and come play on Saturdays.",
    highlights: ["Saturday open play, beginner and advanced", "A semester-long doubles league", "Socials and club tournaments"],
  },
  {
    slug: "competitive",
    name: "Competitive Team",
    kicker: "By tryout",
    description: "Berkeley's travel team. We play collegiate tournaments around California and earned a bid to DUPR College Nationals.",
    highlights: [
      "Tryouts each semester", // TODO confirm timing
      "Collegiate tournament travel",
      "DUPR College Nationals bid",
    ],
  },
] as const;

/** The two flagship competitive programs open to all members. */
export const tournamentPrograms = [
  {
    id: "social-league",
    kicker: "Semester long",
    name: "Pickleball League",
    summary:
      "Grab a partner, register free, and get drawn into a pool. You're guaranteed a match against every other team in your pool — play them on your own schedule, with standings updating live as scores come in.",
    points: [
      "Beginner, Advanced, and Competitive-only divisions",
      "Find your own partner, or enter the free-agent pool",
      "Pool size scales to however many teams sign up",
      "Play in any order, whenever both pairs are free",
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

/** Shown by the app's error boundaries when a page fails to load. */
export const errorCopy = {
  title: "That didn't load",
  body: "Usually a hiccup on our end or a spotty connection. Nothing you already signed up for was lost — try again, and if it keeps happening, email us.",
  retry: "Try again",
  home: "Back to home",
};

/**
 * Why an RSVP attempt was refused, in plain English. Keyed by `RsvpErrorReason`
 * from `src/lib/rsvp-logic.ts`. Lives here, not in `events/actions.ts` — a
 * `"use server"` file may only export async functions, so a plain object
 * exported from there breaks every action in the file at runtime.
 */
export const rsvpErrorCopy = {
  not_found: "That event no longer exists.",
  not_published: "This event isn't open yet.",
  not_open: "RSVPs aren't open for this event yet.",
  past: "This event has already happened.",
  already_rsvpd: "You're already signed up for this.",
  not_rsvpd: "You're not signed up for this.",
  unknown: "Something went wrong. Try again.",
  /** The request never reached the server — usually a phone losing signal. */
  offline: "Couldn't reach the server. Check your connection and try again.",
} as const;

/** The public "who's coming" list on an event page. */
export const rsvpListCopy = {
  confirmed: "Who's coming",
  waitlist: "Waitlist",
  empty: "Nobody yet — be the first.",
  /** Shown to signed-out visitors, who only see first name + last initial. */
  signedOutNote: "Sign in to see full names.",
};

/**
 * Check-in and the strike policy. Exec-facing only — none of this is ever
 * rendered on a member-facing page.
 */
export const attendanceCopy = {
  present: "Present",
  noShow: "No-show",
  unmarked: "Not marked",
  markRemaining: "Mark everyone else as no-show",
  markRemainingHint: "Check people in as they arrive, then mark whoever is left.",
  clearAll: "Clear this session's attendance",
  notStartedYet: "Attendance opens once the session starts.",
  strikes: "Strikes",
  flagged: "At the limit — remove from club",
  warning: "1 more no-show = removal",
  policy:
    "A no-show on a confirmed spot is a strike. Two strikes and the member is removed from the club. Cancelling in advance is never a strike — it gives the spot back to someone on the waitlist.",
  noStrikes: "No strikes.",
  errors: {
    badInput: "That didn't look right — reload and try again.",
    notFound: "That RSVP no longer exists.",
    notStarted: "This session hasn't started yet.",
    notPractice: "Attendance is only taken at practices.",
    notConfirmed: "Only members who held a confirmed spot can be marked.",
    unknown: "Couldn't save that. Try again.",
  },
} as const;

/** "How it works" steps on the Tournaments tab. `icon` maps to a lucide icon in the page. */
export const leagueSteps = [
  {
    icon: "users",
    title: "Sign up",
    body: "Register solo or with a partner — free. One league per person: Beginner or Advanced. No partner? Free agents are paired at random when registration closes.",
  },
  {
    icon: "calendar",
    title: "One match a week",
    body: `Every week you get a new opponent. Message them on Slack, agree on a time, post it on the site by Wednesday, book a court at ${venue.name}, and play best of 3.`,
  },
  {
    icon: "clipboard",
    title: "Report the score",
    body: "Any of the four players reports it by Sunday night — you get the whole weekend to play. Sick or out of town? Each team gets one skip a season — the match becomes a makeup the next week. Standings update live.",
  },
  {
    icon: "trophy",
    title: "Playoffs",
    body: "After the round robin, the top teams play single elimination, one round a week, ending in the final on the last weekend of classes.",
  },
] as const;

/** Pickleball League week-to-week rules — shown on the Tournaments tab and in reminder emails. */
export const leagueInfo = {
  /** Courts open for reservation 72 hours ahead, on a rolling basis. */
  courtBookingUrl: "https://shop.rs.berkeley.edu/booking/164d5765-6775-46d4-ad51-2c9f51027a2d",
  courtBookingNote: "Courts open for reservation 72 hours ahead, on a rolling basis.",
  weekRule:
    "Each week: post when you're playing by Wednesday 11:59 PM, and play and report the score by Sunday 11:59 PM (the Sunday right after the week). Only one of the four players needs to do either.",
  outOfTownRule:
    "Sick or out of town? Each team gets ONE skip per season: tap \"Can't make it this week\" before Sunday's deadline and the match becomes a makeup due the next Sunday. If the makeup doesn't happen, the team that skipped forfeits. Every skip after the first is an automatic forfeit.",
  noShowRule:
    "A match nobody reports by Sunday counts as a double forfeit — neither team gets the win. If one team just didn't respond, tell exec and they'll award the win. The no-show strike policy applies, including not letting your opponents know you can't play that week.",
  scoreRule: "Best of 3, games to 11, win by 2. Any player reports; the other team can confirm or dispute it.",
};

export const officers = [
  { name: "Sienna Lam", role: "President", year: "Senior", photo: "/media/officers/sienna.jpg" },
  { name: "Jason Piech", role: "VP of External", year: "Sophomore", photo: "/media/officers/jason.jpg" },
  { name: "Eric Liang", role: "VP of Partnerships", year: "Senior", photo: "/media/officers/eric.jpg" },
  { name: "Will Chang", role: "Tournament Director", year: "Senior", photo: "/media/officers/will.jpg" },
  { name: "Vinay Palta", role: "Social Media Director", year: "Sophomore", photo: "/media/officers/vinay.jpg" },
  { name: "Kiara Eng", role: "VP of Internal", year: "Junior", photo: null },
  { name: "Caleb Deng", role: "Social Team Director", year: "Junior", photo: "/media/officers/caleb.jpg" },
];

export type AlbumPhoto = { src: string; alt: string; caption: string; width: number; height: number };

/**
 * Photo albums. To add a photo: drop a JPEG in `public/media/albums/<album>/`
 * (2000px on the long edge is plenty — strip location data first), then add a
 * line here with its pixel size. The first photo leads the carousel.
 */
export const albums: Record<"club" | "social", AlbumPhoto[]> = {
  /** Exec and tournament wins — About page and Comp Team page. */
  club: [
    { src: "/media/albums/club/nationals-bid.jpg", alt: "Berkeley players holding a DUPR Nationals Bid Winner sign under a Champions banner", caption: "Nationals bid winners · The Hub Silicon Valley", width: 1500, height: 2000 },
    { src: "/media/albums/club/gameday.jpg", alt: "Berkeley team lined up on an indoor court at Gameday CBD", caption: "The team at Gameday CBD", width: 1500, height: 2000 },
    { src: "/media/albums/club/outdoor-team.jpg", alt: "Berkeley players posing together at the net after a scrimmage with Stanford", caption: "Stanford scrimmage", width: 2000, height: 1500 },
    { src: "/media/albums/club/rooftop-club.jpg", alt: "Comp Team players beside the Pickleball at Berkeley banner at Neighborhood", caption: "Comp Team practice at Neighborhood", width: 2000, height: 1500 },
    { src: "/media/albums/club/rooftop-exec.jpg", alt: "Exec members arm in arm on the courts at Neighborhood", caption: "Exec at Neighborhood", width: 1500, height: 2000 },
  ],
  /** Saturday open play — Social Team page. */
  social: [
    { src: "/media/albums/social/open-play-2.jpg", alt: "Smiling players holding up their paddles behind the net at an outdoor court", caption: "Saturday open play", width: 2000, height: 1500 },
    { src: "/media/albums/social/open-play-3.jpg", alt: "Seven players with paddles lined up behind the net at an outdoor court", caption: "Paddles up", width: 2000, height: 1500 },
    { src: "/media/albums/social/open-play.jpg", alt: "Players with paddles lined up on a sunny outdoor court", caption: "The open play crew", width: 1024, height: 768 },
  ],
};

/** Current sponsors. Logos live in public/media/sponsors/ — trimmed, on a white background. */
export const sponsors: { name: string; logo: string; width: number; height: number; url: string | null }[] = [
  { name: "RPM", logo: "/media/sponsors/rpm.png", width: 800, height: 267, url: null },
  { name: "Centerline", logo: "/media/sponsors/centerline.png", width: 748, height: 80, url: null },
];

export const sponsorPitch = {
  headline: "Put your brand in front of 150+ Berkeley students.",
  points: [
    { stat: "150+", label: "Active members" },
    { stat: "Weekly", label: "Open play every Saturday, all semester" },
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
