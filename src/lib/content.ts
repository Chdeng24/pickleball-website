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
    level: "Beginner",
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
    level: "Advanced",
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
      "Semester-long Pickleball League doubles tournament",
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

/** "How it works" steps on the Tournaments tab. `icon` maps to a lucide icon in the page. */
export const leagueSteps = [
  {
    icon: "users",
    title: "Sign up",
    body: "Register solo or with a partner — free. One league per person: Beginner, Advanced, or Comp (Competitive Team only). No partner? Exec pairs solo players before the draw.",
  },
  {
    icon: "trophy",
    title: "Get drawn into a pool",
    body: "When registration closes, exec draws pools of up to 8 teams in your division and emails everyone their opponents.",
  },
  {
    icon: "calendar",
    title: "Play your pool",
    body: `Play every other team in your pool once — best of 3 at ${venue.name}, on whatever days work for both teams.`,
  },
  {
    icon: "clipboard",
    title: "Top teams move up",
    body: "Any of the four players reports the score. Standings update live, and the top teams in each pool move up.",
  },
] as const;

export const officers = [
  { name: "Sienna Lam", role: "President", year: "Senior", photo: null },
  { name: "Jason Piech", role: "VP of External", year: "Sophomore", photo: null },
  { name: "Eric Liang", role: "VP of Partnerships", year: "Senior", photo: null },
  { name: "Will Chang", role: "Tournament Director", year: "Senior", photo: null },
  { name: "Vinay Palta", role: "Social Media Director", year: "Sophomore", photo: null },
  { name: "Kiara Eng", role: "VP of Internal", year: "Junior", photo: null },
  { name: "Caleb Deng", role: "Social Team Director", year: "Junior", photo: null },
];

/**
 * Team/event photo album on the About page. Empty until you add some — to
 * add one: drop the image file in `public/media/gallery/`, then add a line
 * here, e.g. { src: "/media/gallery/fall-social.jpg", alt: "Fall social at Clark Kerr" }.
 */
export const galleryPhotos: { src: string; alt: string }[] = [];

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
