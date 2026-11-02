"use client";

import { useState } from "react";
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Field,
  GroupTag,
  Loading,
  Modal,
  Notice,
  PageHeader,
  RiskBadge,
  TableWrap,
  pct,
} from "@/components/ui";
import { apiSend, qs, useApi } from "@/components/use-api";
import type { StudentRow } from "@/lib/types";

type Meta = { groups: Array<{ g_id: number; g_name: string }>; branches: string[] };

export default function StudentsAdmin() {
  const meta = useApi<Meta>("/api/meta");
  const [filters, setFilters] = useState({ q: "", groupId: "", branch: "", semester: "", risk: "", sort: "usn" });
  const [search, setSearch] = useState("");
  const list = useApi<{ students: StudentRow[] }>(`/api/students${qs({ ...filters, q: search })}`);
  const [modal, setModal] = useState<{ kind: "create" } | { kind: "edit" | "transfer"; s: StudentRow } | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));

  async function remove(s: StudentRow) {
    if (!confirm(`Delete ${s.s_name} (${s.s_usn})? Their participation, feedback and login are removed too.`)) return;
    setMsg(null);
    try {
      await apiSend("DELETE", `/api/students/${s.s_id}`);
      setMsg({ kind: "success", text: `${s.s_name} deleted` });
      list.reload();
    } catch (err) {
      // trg_student_protect blocks students with recorded attendance.
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }

  const done = (text: string) => {
    setModal(null);
    setMsg({ kind: "success", text });
    list.reload();
  };

  const students = list.data?.students ?? [];
  return (
    <>
      <PageHeader
        title="Students"
        subtitle="Enrol, edit, transfer between colour groups and remove students"
        actions={
          <Button variant="primary" onClick={() => setModal({ kind: "create" })}>
            + Enrol student
          </Button>
        }
      />
      {msg && (
        <div className="mb-4">
          <Notice kind={msg.kind}>{msg.text}</Notice>
        </div>
      )}
      <Card pad={false}>
        <form
          className="grid gap-2 border-b border-line p-4 sm:grid-cols-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr]"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(filters.q.trim());
          }}
        >
          <input className="input" placeholder="Search name, USN or email…" value={filters.q} onChange={set("q")} aria-label="Search" onBlur={() => setSearch(filters.q.trim())} />
          <select className="input" value={filters.groupId} onChange={set("groupId")} aria-label="Group">
            <option value="">All groups</option>
            {meta.data?.groups.map((g) => (
              <option key={g.g_id} value={g.g_id}>
                {g.g_name}
              </option>
            ))}
          </select>
          <select className="input" value={filters.branch} onChange={set("branch")} aria-label="Branch">
            <option value="">All branches</option>
            {meta.data?.branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <select className="input" value={filters.semester} onChange={set("semester")} aria-label="Semester">
            <option value="">All semesters</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                Semester {n}
              </option>
            ))}
          </select>
          <select className="input" value={filters.risk} onChange={set("risk")} aria-label="Risk">
            <option value="">Any risk</option>
            <option value="HIGH">High risk</option>
            <option value="MEDIUM">Medium risk</option>
            <option value="LOW">Low risk</option>
          </select>
          <select className="input" value={filters.sort} onChange={set("sort")} aria-label="Sort">
            <option value="usn">Sort: USN</option>
            <option value="name">Sort: name</option>
            <option value="attendance">Sort: attendance</option>
            <option value="group">Sort: group</option>
          </select>
        </form>
        <div className="p-4">
          {list.loading && !list.data ? (
            <Loading />
          ) : list.error ? (
            <ErrorNote message={list.error} onRetry={list.reload} />
          ) : students.length === 0 ? (
            <Empty>No students match these filters.</Empty>
          ) : (
            <>
              <p className="mb-2 text-xs text-ink-3">{students.length} student(s)</p>
              <TableWrap>
                <thead>
                  <tr>
                    <th>USN</th>
                    <th>Name</th>
                    <th>Branch · sem</th>
                    <th>Group</th>
                    <th className="text-right">P / L / A / E</th>
                    <th className="text-right">Attendance</th>
                    <th>Risk</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.s_id}>
                      <td className="font-mono text-xs">{s.s_usn}</td>
                      <td>
                        <div className="font-medium">{s.s_name}</div>
                        <div className="text-xs text-ink-3">{s.email}</div>
                      </td>
                      <td className="text-ink-2">
                        {s.branch} · {s.semester}
                      </td>
                      <td>
                        <GroupTag name={s.colour_group} />
                      </td>
                      <td className="tabular text-right text-ink-2">
                        {s.present} / {s.late_arrivals} / {s.absent} / {s.excused}
                      </td>
                      <td className="tabular text-right">{pct(s.attendance_pct)}</td>
                      <td>
                        <RiskBadge risk={s.risk} />
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Button size="sm" onClick={() => setModal({ kind: "edit", s })}>
                            Edit
                          </Button>
                          <Button size="sm" onClick={() => setModal({ kind: "transfer", s })}>
                            Transfer
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => remove(s)}>
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </>
          )}
        </div>
      </Card>

      <Modal open={modal?.kind === "create"} title="Enrol a student" onClose={() => setModal(null)}>
        <CreateForm groups={meta.data?.groups ?? []} branches={meta.data?.branches ?? []} onDone={done} />
      </Modal>
      <Modal open={modal?.kind === "edit"} title="Edit student" onClose={() => setModal(null)}>
        {modal?.kind === "edit" && <EditForm s={modal.s} onDone={done} />}
      </Modal>
      <Modal open={modal?.kind === "transfer"} title="Transfer to another colour group" onClose={() => setModal(null)}>
        {modal?.kind === "transfer" && <TransferForm s={modal.s} groups={meta.data?.groups ?? []} onDone={done} />}
      </Modal>
    </>
  );
}

function useSubmit(onSubmit: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function CreateForm({
  groups,
  branches,
  onDone,
}: {
  groups: Array<{ g_id: number; g_name: string }>;
  branches: string[];
  onDone: (msg: string) => void;
}) {
  const [f, setF] = useState({ usn: "", name: "", email: "", branch: "", semester: "1", groupId: "", password: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const { busy, error, submit } = useSubmit(async () => {
    const res = await apiSend<{ s_id: number }>("POST", "/api/students", {
      ...f,
      semester: Number(f.semester),
      groupId: Number(f.groupId),
    });
    onDone(`${f.name} enrolled (id ${res.s_id}) with five participation rows and a login`);
  });
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-xs text-ink-3">
        Runs <code>sp_register_student</code>: the student, their five participation rows and their login are created in one transaction.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="USN">
          <input className="input font-mono uppercase" required value={f.usn} onChange={set("usn")} placeholder="1BM26CS052" />
        </Field>
        <Field label="Full name">
          <input className="input" required value={f.name} onChange={set("name")} />
        </Field>
        <Field label="Email (login)">
          <input className="input" type="email" required value={f.email} onChange={set("email")} />
        </Field>
        <Field label="Branch">
          <input className="input" required list="branch-list" value={f.branch} onChange={set("branch")} />
          <datalist id="branch-list">
            {branches.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </Field>
        <Field label="Semester">
          <select className="input" value={f.semester} onChange={set("semester")}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
        <Field label="Colour group">
          <select className="input" required value={f.groupId} onChange={set("groupId")}>
            <option value="">Choose…</option>
            {groups.map((g) => (
              <option key={g.g_id} value={g.g_id}>
                {g.g_name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Initial password" hint="At least 8 characters with a letter and a digit">
        <input className="input" type="password" autoComplete="new-password" required value={f.password} onChange={set("password")} />
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" busy={busy}>
          Enrol
        </Button>
      </div>
    </form>
  );
}

function EditForm({ s, onDone }: { s: StudentRow; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ name: s.s_name, email: s.email, branch: s.branch ?? "", semester: String(s.semester) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const { busy, error, submit } = useSubmit(async () => {
    await apiSend("PATCH", `/api/students/${s.s_id}`, { ...f, semester: Number(f.semester) });
    onDone(`${f.name} updated`);
  });
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          <input className="input" required value={f.name} onChange={set("name")} />
        </Field>
        <Field label="Email" hint="The login username follows this (trg_student_email_sync)">
          <input className="input" type="email" required value={f.email} onChange={set("email")} />
        </Field>
        <Field label="Branch">
          <input className="input" required value={f.branch} onChange={set("branch")} />
        </Field>
        <Field label="Semester">
          <select className="input" value={f.semester} onChange={set("semester")}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </Field>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" busy={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}

function TransferForm({
  s,
  groups,
  onDone,
}: {
  s: StudentRow;
  groups: Array<{ g_id: number; g_name: string }>;
  onDone: (msg: string) => void;
}) {
  const [groupId, setGroupId] = useState("");
  const { busy, error, submit } = useSubmit(async () => {
    const res = await apiSend<{ message: string }>("POST", `/api/students/${s.s_id}/transfer`, { groupId: Number(groupId) });
    onDone(res.message);
  });
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-ink-2">
        {s.s_name} is in the <GroupTag name={s.colour_group} /> group. <code>sp_transfer_student</code> locks the row, moves the
        student and rebuilds their five participation rows (their attendance resets to absent).
      </p>
      <Field label="New group">
        <select className="input" required value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">Choose…</option>
          {groups.map((g) => (
            <option key={g.g_id} value={g.g_id}>
              {g.g_name}
            </option>
          ))}
        </select>
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" busy={busy}>
          Transfer
        </Button>
      </div>
    </form>
  );
}
