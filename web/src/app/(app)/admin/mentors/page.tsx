"use client";

import { useState } from "react";
import { Button, Card, Empty, ErrorNote, Field, Loading, Modal, Notice, PageHeader, Pill, TableWrap } from "@/components/ui";
import { apiSend, useApi } from "@/components/use-api";
import type { MentorRow } from "@/lib/types";

export default function MentorsAdmin() {
  const list = useApi<{ mentors: MentorRow[] }>("/api/mentors");
  const [modal, setModal] = useState<{ kind: "create" } | { kind: "edit"; m: MentorRow } | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function remove(m: MentorRow) {
    const note = m.activities ? ` Their activities (${m.activities}) will have no mentor (ON DELETE SET NULL).` : "";
    if (!confirm(`Delete ${m.m_name}?${note}`)) return;
    try {
      await apiSend("DELETE", `/api/mentors/${m.m_id}`);
      setMsg({ kind: "success", text: `${m.m_name} deleted` });
      list.reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }

  const done = (text: string) => {
    setModal(null);
    setMsg({ kind: "success", text });
    list.reload();
  };

  return (
    <>
      <PageHeader
        title="Mentors"
        subtitle="Faculty who run the bootstrap activities"
        actions={
          <Button variant="primary" onClick={() => setModal({ kind: "create" })}>
            + Add mentor
          </Button>
        }
      />
      {msg && (
        <div className="mb-4">
          <Notice kind={msg.kind}>{msg.text}</Notice>
        </div>
      )}
      <Card>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <ErrorNote message={list.error} onRetry={list.reload} />
        ) : !list.data?.mentors.length ? (
          <Empty>No mentors yet.</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>Name</th>
                <th>Department</th>
                <th>Contact</th>
                <th>Assigned activity</th>
                <th>Login</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.mentors.map((m) => (
                <tr key={m.m_id}>
                  <td>
                    <div className="font-medium">{m.m_name}</div>
                    <div className="text-xs text-ink-3">{m.designation}</div>
                  </td>
                  <td className="text-ink-2">{m.dept ?? "—"}</td>
                  <td>
                    <div className="break-all">{m.email}</div>
                    <div className="tabular text-xs text-ink-3">{m.phone ?? ""}</div>
                  </td>
                  <td>{m.activities ? <Pill tone="accent">{m.activities}</Pill> : <span className="text-xs text-ink-3">Unassigned</span>}</td>
                  <td className="text-xs">{m.has_login ? "Yes" : <span className="text-ink-3">No</span>}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => setModal({ kind: "edit", m })}>
                        Edit
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => remove(m)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      <Modal open={modal?.kind === "create"} title="Add mentor" onClose={() => setModal(null)}>
        <MentorForm onDone={done} />
      </Modal>
      <Modal open={modal?.kind === "edit"} title="Edit mentor" onClose={() => setModal(null)}>
        {modal?.kind === "edit" && <MentorForm m={modal.m} onDone={done} />}
      </Modal>
    </>
  );
}

function MentorForm({ m, onDone }: { m?: MentorRow; onDone: (msg: string) => void }) {
  const [f, setF] = useState({
    name: m?.m_name ?? "",
    dept: m?.dept ?? "",
    designation: m?.designation ?? "",
    email: m?.email ?? "",
    phone: m?.phone ?? "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (m) {
        await apiSend("PATCH", `/api/mentors/${m.m_id}`, {
          name: f.name,
          dept: f.dept || null,
          designation: f.designation || null,
          email: f.email,
          phone: f.phone || null,
        });
        onDone(`${f.name} updated`);
      } else {
        await apiSend("POST", "/api/mentors", {
          name: f.name,
          dept: f.dept || undefined,
          designation: f.designation || undefined,
          email: f.email,
          phone: f.phone || undefined,
          password: f.password || undefined,
        });
        onDone(`${f.name} added${f.password ? " with a mentor login" : ""}`);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          <input className="input" required value={f.name} onChange={set("name")} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" required value={f.email} onChange={set("email")} />
        </Field>
        <Field label="Department">
          <input className="input" value={f.dept} onChange={set("dept")} />
        </Field>
        <Field label="Designation">
          <input className="input" value={f.designation} onChange={set("designation")} />
        </Field>
        <Field label="Phone" hint="10–15 digits (chk_phone_len)">
          <input className="input" inputMode="tel" value={f.phone} onChange={set("phone")} />
        </Field>
        {!m && (
          <Field label="Login password (optional)" hint="Creates a mentor login in the same transaction">
            <input className="input" type="password" autoComplete="new-password" value={f.password} onChange={set("password")} />
          </Field>
        )}
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" busy={busy}>
          {m ? "Save" : "Add mentor"}
        </Button>
      </div>
    </form>
  );
}
