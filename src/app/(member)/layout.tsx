import { requireMember } from "@/lib/session";
import { MemberShell } from "@/components/site/member-shell";

// Plain React.ReactNode rather than the generated LayoutProps<'/...'> helper:
// this layout sits on a route group `(member)`, which has no single URL
// segment of its own, so there's no one typed route to key the helper to.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const user = await requireMember();

  return <MemberShell user={user}>{children}</MemberShell>;
}
