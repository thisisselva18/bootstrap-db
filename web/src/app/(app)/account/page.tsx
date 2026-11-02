"use client";

import { useState } from "react";
import { Button, Card, Field, Notice, PageHeader } from "@/components/ui";
import { apiSend, useApi } from "@/components/use-api";
import type { Session } from "@/lib/auth/session";

export default function AccountPage() {
  const me = useApi<{ user: Session }>("/api/auth/me");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) {
      setMsg({ kind: "error", text: "The new passwords do not match" });
      return;
    }
    setBusy(true);
    try {
      await apiSend("POST", "/api/auth/password", { currentPassword: current, newPassword: next });
      setMsg({ kind: "success", text: "Password changed. Use the new password next time you sign in." });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const u = me.data?.user;
  return (
    <>
      <PageHeader title="Account" subtitle="Your sign-in details" />
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Profile">
          {u ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-3">Name</dt>
              <dd>{u.name}</dd>
              <dt className="text-ink-3">Email</dt>
              <dd className="break-all">{u.email}</dd>
              <dt className="text-ink-3">Role</dt>
              <dd className="capitalize">{u.role}</dd>
            </dl>
          ) : (
            <p className="text-sm text-ink-3">Loading…</p>
          )}
        </Card>
        <Card title="Change password" subtitle="At least 8 characters, with a letter and a digit. Stored only as a bcrypt hash.">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Current password">
              <input className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password">
              <input className="input" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Confirm new password">
              <input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
            <Button type="submit" variant="primary" busy={busy}>
              Update password
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
