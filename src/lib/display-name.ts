/**
 * How a member's name reads on the public attendee list.
 *
 * Signed-in members see each other in full. The event page is also reachable
 * signed-out, on the open internet, so for those visitors last names shrink to
 * an initial — enough to answer "are my friends going?", not enough to scrape
 * a student directory. Emails never appear on either version; only the exec
 * RSVP page shows those.
 *
 * Pure and dependency-free so `node --test` can run it directly.
 */
export function attendeeName(
  member: { name: string | null; email: string },
  visibility: "full" | "abbreviated",
): string {
  const parts = (member.name ?? "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    // No Google display name on the account. The email local part identifies
    // them to fellow members; to the public they stay anonymous.
    return visibility === "full" ? (member.email.split("@")[0] || "Member") : "Member";
  }

  if (visibility === "full" || parts.length === 1) return parts.join(" ");

  const last = parts[parts.length - 1];
  return `${parts.slice(0, -1).join(" ")} ${last[0].toUpperCase()}.`;
}
