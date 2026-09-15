import { requireMember } from "@/lib/session";
import { MemberNav } from "@/components/site/member-nav";
import { Container } from "@/components/ui/container";

// Plain React.ReactNode rather than the generated LayoutProps<'/...'> helper:
// this layout sits on a route group `(member)`, which has no single URL
// segment of its own, so there's no one typed route to key the helper to.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const user = await requireMember();

  return (
    <div className="min-h-[100svh] bg-chalk">
      <MemberNav user={user} />
      <Container className="py-8 pb-24 sm:py-12 sm:pb-16">{children}</Container>
    </div>
  );
}
