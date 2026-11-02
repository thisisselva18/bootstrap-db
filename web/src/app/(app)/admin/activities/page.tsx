"use client";

import { useState } from "react";
import {
  Button,
  Card,
  DAY_NAMES,
  ErrorNote,
  Field,
  GroupTag,
  Loading,
  Modal,
  Notice,
  PageHeader,
  TableWrap,
  pct,
} from "@/components/ui";
import { apiSend, qs, useApi } from "@/components/use-api";
import type { ActivityStats, GroupStats } from "@/lib/types";

type Meta = { mentors: Array<{ m_id: number; m_name: string }> };
type ReportRow = {
  day: number;
  a_name: string;
  room: string | null;
  enrolled: number;
  present: number;
  late_arrivals: number;
  absent: number;
  attendance_pct: number;
  avg_rating: number;
};

export default function ActivitiesAdmin() {
  const acts = useApi<{ activities: ActivityStats[] }>("/api/activities");
  const groups = useApi<{ groups: GroupStats[] }>("/api/groups");
  const meta = useApi<Meta>("/api/meta");
  const [edit, setEdit] = useState<ActivityStats | null>(null);
  const [rename, setRename] = useState<GroupStats | null>(null);
  const [reportFor, setReportFor] = useState<GroupStats | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [terms, setTerms] = useState("");
  const [search, setSearch] = useState("");
  const results = useApi<{ results: Array<{ a_id: number; a_name: string; description: string; relevance: number }> }>(
    search ? `/api/activities${qs({ q: search })}` : null,
  );

  return (
    <>
      <PageHeader
        title="Activities & groups"
        subtitle="The programme is a fixed 5 × 5 rotation: five colour groups meet five activities once each. Activities and groups are edited, not added."
      />
      {msg && (
        <div className="mb-4">
          <Notice kind="success">{msg}</Notice>
        </div>
      )}

      <div className="space-y-6">
        <Card title="Activities" subtitle="Capacity must stay within 1–500 (CHECK constraints); removing a mentor leaves the activity unassigned.">
          {acts.loading && !acts.data ? (
            <Loading />
          ) : acts.error ? (
            <ErrorNote message={acts.error} onRetry={acts.reload} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Mentor</th>
                  <th className="text-right">Capacity</th>
                  <th className="text-right">Attendance</th>
                  <th className="text-right">Rating</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {acts.data?.activities.map((a) => (
                  <tr key={a.a_id}>
                    <td>
                      <div className="font-medium">{a.a_name}</div>
                      <div className="text-xs text-ink-3">{a.description}</div>
                    </td>
                    <td>{a.mentor ?? <span className="text-xs text-ink-3">Unassigned</span>}</td>
                    <td className="tabular text-right">{a.capacity}</td>
                    <td className="tabular text-right">
                      {pct(a.attendance_pct)}
                      <div className="text-xs text-ink-3">
                        {a.attended}/{a.enrolled}
                      </div>
                    </td>
                    <td className="tabular text-right">
                      {Number(a.avg_rating).toFixed(2)}
                      <div className="text-xs text-ink-3">n={a.responses}</div>
                    </td>
                    <td className="text-right">
                      <Button size="sm" onClick={() => setEdit(a)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>

        <Card title="Search activity descriptions" subtitle="FULLTEXT index ft_activity_text on (a_name, description)">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(terms.trim());
            }}
          >
            <input className="input" placeholder="e.g. prototyping lab safety" value={terms} onChange={(e) => setTerms(e.target.value)} aria-label="Search activities" />
            <Button type="submit" variant="primary">
              Search
            </Button>
          </form>
          {search && (
            <div className="mt-3">
              {results.loading ? (
                <Loading />
              ) : results.data?.results.length ? (
                <ul className="divide-y divide-line text-sm">
                  {results.data.results.map((r) => (
                    <li key={r.a_id} className="flex justify-between gap-3 py-2">
                      <span>
                        <span className="font-medium">{r.a_name}</span> <span className="text-ink-3">— {r.description}</span>
                      </span>
                      <span className="tabular shrink-0 text-xs text-ink-3">rel {r.relevance.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-3">No activity matches “{search}”.</p>
              )}
            </div>
          )}
        </Card>

        <Card title="Colour groups" subtitle="vw_group_stats; the report runs sp_group_report">
          {groups.loading && !groups.data ? (
            <Loading />
          ) : groups.error ? (
            <ErrorNote message={groups.error} onRetry={groups.reload} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th>Group</th>
                  <th className="text-right">Students</th>
                  <th className="text-right">Present / late / absent / excused</th>
                  <th className="text-right">Attendance</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {groups.data?.groups.map((g) => (
                  <tr key={g.g_id}>
                    <td>
                      <GroupTag name={g.g_name} />
                    </td>
                    <td className="tabular text-right">{g.students}</td>
                    <td className="tabular text-right text-ink-2">
                      {g.present} / {g.late_arrivals} / {g.absent} / {g.excused}
                    </td>
                    <td className="tabular text-right">{pct(g.attendance_pct)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" onClick={() => setReportFor(g)}>
                          Report
                        </Button>
                        <Button size="sm" onClick={() => setRename(g)}>
                          Rename
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>

      <Modal open={!!edit} title={`Edit ${edit?.a_name ?? ""}`} onClose={() => setEdit(null)}>
        {edit && (
          <ActivityForm
            a={edit}
            mentors={meta.data?.mentors ?? []}
            onDone={(t) => {
              setEdit(null);
              setMsg(t);
              acts.reload();
            }}
          />
        )}
      </Modal>
      <Modal open={!!rename} title="Rename group" onClose={() => setRename(null)}>
        {rename && (
          <RenameForm
            g={rename}
            onDone={(t) => {
              setRename(null);
              setMsg(t);
              groups.reload();
            }}
          />
        )}
      </Modal>
      <Modal open={!!reportFor} title={`${reportFor?.g_name ?? ""} group report`} onClose={() => setReportFor(null)}>
        {reportFor && <GroupReport g={reportFor} />}
      </Modal>
    </>
  );
}

function ActivityForm({ a, mentors, onDone }: { a: ActivityStats; mentors: Meta["mentors"]; onDone: (t: string) => void }) {
  const [f, setF] = useState({ name: a.a_name, capacity: String(a.capacity), description: a.description ?? "", mentorId: a.m_id ? String(a.m_id) : "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend("PATCH", `/api/activities/${a.a_id}`, {
        name: f.name,
        capacity: Number(f.capacity),
        description: f.description || null,
        mentorId: f.mentorId ? Number(f.mentorId) : null,
      });
      onDone(`${f.name} updated`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Name">
        <input className="input" required value={f.name} onChange={set("name")} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Capacity per group session" hint="1–500">
          <input className="input" type="number" required value={f.capacity} onChange={set("capacity")} />
        </Field>
        <Field label="Mentor">
          <select className="input" value={f.mentorId} onChange={set("mentorId")}>
            <option value="">Unassigned</option>
            {mentors.map((m) => (
              <option key={m.m_id} value={m.m_id}>
                {m.m_name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Description" hint={`${f.description.length}/255`}>
        <textarea className="input min-h-20" maxLength={255} value={f.description} onChange={set("description")} />
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" busy={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}

function RenameForm({ g, onDone }: { g: GroupStats; onDone: (t: string) => void }) {
  const [name, setName] = useState(g.g_name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await apiSend("PATCH", `/api/groups/${g.g_id}`, { name });
          onDone(`Group renamed to ${name}`);
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <Field label="Group name" hint="Letters only, must be unique">
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" busy={busy}>
          Rename
        </Button>
      </div>
    </form>
  );
}

function GroupReport({ g }: { g: GroupStats }) {
  const rep = useApi<{ report: ReportRow[] }>(`/api/groups/${g.g_id}/report`);
  if (rep.loading) return <Loading />;
  if (rep.error) return <ErrorNote message={rep.error} />;
  return (
    <TableWrap>
      <thead>
        <tr>
          <th>Day</th>
          <th>Activity</th>
          <th>Room</th>
          <th className="text-right">P / L / A</th>
          <th className="text-right">Attendance</th>
          <th className="text-right">Rating</th>
        </tr>
      </thead>
      <tbody>
        {rep.data?.report.map((r) => (
          <tr key={r.day}>
            <td className="whitespace-nowrap">{DAY_NAMES[r.day]}</td>
            <td>{r.a_name}</td>
            <td>{r.room}</td>
            <td className="tabular text-right">
              {r.present} / {r.late_arrivals} / {r.absent}
            </td>
            <td className="tabular text-right">{pct(r.attendance_pct)}</td>
            <td className="tabular text-right">{Number(r.avg_rating).toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}
