"use client";

import { useState } from "react";
import { Button, Field, Notice } from "@/components/ui";
import { apiSend } from "@/components/use-api";

const DEMO = [
  { role: "Admin", email: "admin@univ.edu", password: "Admin@123" },
  { role: "Mentor", email: "priya.iyer@univ.edu", password: "Mentor@123" },
  { role: "Student", email: "aarav.sharma@univ.edu", password: "Student@123" },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ redirectTo: string }>("POST", "/api/auth/login", { email, password });
      const next = new URLSearchParams(window.location.search).get("next");
      // Only follow same-site relative paths.
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : res.redirectTo;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex w-fit gap-1" aria-hidden>
            {["var(--red)", "var(--blue)", "var(--green)", "var(--purple)", "var(--yellow)"].map((c) => (
              <span key={c} className="h-3 w-3 rounded-full" style={{ background: c }} />
            ))}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Campus Bootstrap</h1>
          <p className="mt-1 text-sm text-ink-2">Matchmaking &amp; student statistics</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-line bg-surface p-5">
          <Field label="Email">
            <input
              className="input"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <Notice kind="error">{error}</Notice>}
          <Button type="submit" variant="primary" busy={busy} className="w-full">
            Sign in
          </Button>
        </form>
        <div className="mt-4 rounded-xl border border-line bg-surface p-4 text-xs text-ink-2">
          <p className="mb-2 font-medium text-ink">Demo accounts (seeded by sql/03_seed_accounts.sql)</p>
          <ul className="space-y-1.5">
            {DEMO.map((d) => (
              <li key={d.role} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-ink">{d.role}</span> · {d.email}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded border border-line px-2 py-0.5 hover:bg-surface-2"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                  }}
                >
                  Use
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
