import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/guard";
import { AppNav } from "@/components/app-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  return (
    <div className="min-h-screen">
      <AppNav user={{ name: session.name, role: session.role, email: session.email }} />
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
