import { ExecNav } from "@/components/site/exec-nav";

export default function ExecLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <ExecNav />
      {children}
    </div>
  );
}
