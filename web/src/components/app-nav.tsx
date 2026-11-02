"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { Role } from "@/lib/auth/session";
import { cx } from "./ui";

const LINKS: Record<Role, Array<{ href: string; label: string }>> = {
  admin: [
    { href: "/admin", label: "Overview" },
    { href: "/admin/students", label: "Students" },
    { href: "/admin/mentors", label: "Mentors" },
    { href: "/admin/activities", label: "Activities & groups" },
    { href: "/admin/schedule", label: "Schedule" },
    { href: "/admin/attendance", label: "Attendance" },
    { href: "/admin/feedback", label: "Feedback" },
    { href: "/admin/graph", label: "Graph" },
    { href: "/matchmaking", label: "Matchmaking" },
  ],
  mentor: [
    { href: "/mentor", label: "My activities" },
    { href: "/matchmaking", label: "Matchmaking" },
  ],
  student: [
    { href: "/student", label: "My bootstrap" },
    { href: "/matchmaking", label: "Matchmaking" },
  ],
};

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", mentor: "Mentor", student: "Student" };

export function AppNav({ user }: { user: { name: string; role: Role; email: string } }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const links = LINKS[user.role];
  const isActive = (href: string) =>
    pathname === href || (href !== "/admin" && href !== "/mentor" && href !== "/student" && pathname.startsWith(`${href}/`));

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link href={links[0].href} className="flex shrink-0 items-center gap-2 font-semibold">
          <span className="flex gap-0.5" aria-hidden>
            {["var(--red)", "var(--blue)", "var(--green)", "var(--purple)", "var(--yellow)"].map((c) => (
              <span key={c} className="h-2 w-2 rounded-full" style={{ background: c }} />
            ))}
          </span>
          <span className="hidden sm:inline">Campus Bootstrap</span>
        </Link>
        <nav className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex" aria-label="Main">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cx(
                "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap",
                isActive(l.href) ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/account" className="hidden text-right leading-tight sm:block" title="Account settings">
            <div className="text-sm font-medium">{user.name}</div>
            <div className="text-xs text-ink-3">{ROLE_LABEL[user.role]}</div>
          </Link>
          <button onClick={logout} className="rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-surface-2">
            Sign out
          </button>
          <button
            className="rounded-md border border-line px-2.5 py-1.5 text-sm lg:hidden"
            aria-expanded={open}
            aria-label="Menu"
            onClick={() => setOpen((o) => !o)}
          >
            ☰
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line px-4 py-2 lg:hidden" aria-label="Main">
          {[...links, { href: "/account", label: "Account" }].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={cx("block rounded-md px-2 py-2 text-sm", isActive(l.href) ? "bg-accent-soft font-medium" : "text-ink-2")}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
