"use client";

import { useState } from "react";
import { BarList, RatingStacks } from "./charts";
import {
  Button,
  Card,
  DAY_NAMES,
  Empty,
  ErrorNote,
  GroupTag,
  Loading,
  Notice,
  Pill,
  StatusBadge,
  TableWrap,
  time,
} from "./ui";
import { apiSend, qs, useApi } from "./use-api";
import type { FeedbackRow, RosterRow } from "@/lib/types";

// Panels shared by the mentor and admin dashboards.

/** Attendance roster for one activity, with check-in/out and status actions. */
export function RosterPanel({ activityId, activityName }: { activityId: number; activityName: string }) {
  // null = not chosen yet: show the first group's session rather than every row.
  const [chosenGroup, setGroupId] = useState<number | "" | null>(null);
  const roster = useApi<{ roster: RosterRow[] }>(`/api/activities/${activityId}/roster`);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [times, setTimes] = useState<Record<number, string>>({});

  const all = roster.data?.roster ?? [];
  const groups = [...new Map(all.map((r) => [r.g_id, { g_id: r.g_id, g_name: r.g_name, day: r.day }])).values()];
  const groupId = chosenGroup ?? groups[0]?.g_id ?? "";
  const rows = groupId === "" ? all : all.filter((r) => r.g_id === groupId);

  async function act(r: RosterRow, action: string, label: string) {
    const key = `${r.s_id}:${action}`;
    setBusyKey(key);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { studentId: r.s_id, activityId, action };
      if (action === "set_check_in") body.time = times[r.s_id];
      const res = await apiSend<{ record: { status: string } }>("POST", "/api/attendance", body);
      setMsg({ kind: "success", text: `${r.s_name}: ${label} — status is now ${res.record.status}` });
      roster.reload();
    } catch (err) {
      setMsg({ kind: "error", text: `${r.s_name}: ${(err as Error).message}` });
    } finally {
      setBusyKey(null);
    }
  }

  async function excuseAll() {
    if (!confirm(`Mark everyone still absent from ${activityName} as excused? (runs sp_mark_absentees)`)) return;
    setBusyKey("bulk");
    try {
      const res = await apiSend<{ excused: number }>("POST", `/api/activities/${activityId}/excuse-absentees`);
      setMsg({ kind: "success", text: `${res.excused} student(s) excused` });
      roster.reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusyKey(null);
    }
  }

  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

  return (
    <Card
      title={`Attendance — ${activityName}`}
      subtitle="Status is derived by trg_part_set_status (15+ minutes after the start = late); every change is written to the audit log under your name."
      actions={
        <>
          <select className="input w-auto" value={groupId} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : "")} aria-label="Filter by group">
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.g_id} value={g.g_id}>
                {`${g.g_name} (${DAY_NAMES[g.day]})`}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={excuseAll} busy={busyKey === "bulk"}>
            Excuse all absentees
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {(["present", "late", "absent", "excused"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <StatusBadge status={s} /> <span className="tabular">{counts[s] ?? 0}</span>
          </span>
        ))}
      </div>
      {msg && (
        <div className="mb-3">
          <Notice kind={msg.kind}>{msg.text}</Notice>
        </div>
      )}
      {roster.loading && !roster.data ? (
        <Loading />
      ) : roster.error ? (
        <ErrorNote message={roster.error} onRetry={roster.reload} />
      ) : rows.length === 0 ? (
        <Empty>No students are scheduled for this activity.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Student</th>
              <th>Group / day</th>
              <th>Status</th>
              <th>In → out</th>
              <th className="min-w-[470px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.p_id}>
                <td>
                  <div className="font-medium">{r.s_name}</div>
                  <div className="font-mono text-xs text-ink-3">{r.s_usn}</div>
                </td>
                <td className="whitespace-nowrap">
                  <GroupTag name={r.g_name} />
                  <div className="text-xs text-ink-3">{DAY_NAMES[r.day]}</div>
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td className="tabular whitespace-nowrap text-ink-2">
                  {time(r.check_in_time)} → {time(r.check_out_time)}
                </td>
                <td>
                  <div className="flex flex-nowrap items-center gap-1">
                    <Button size="sm" busy={busyKey === `${r.s_id}:check_in`} onClick={() => act(r, "check_in", "checked in now")}>
                      Check in
                    </Button>
                    <Button
                      size="sm"
                      disabled={!r.check_in_time}
                      busy={busyKey === `${r.s_id}:check_out`}
                      onClick={() => act(r, "check_out", "checked out now")}
                    >
                      Check out
                    </Button>
                    <input
                      type="time"
                      aria-label={`Check-in time for ${r.s_name}`}
                      className="input w-[110px] py-1 text-xs"
                      value={times[r.s_id] ?? ""}
                      onChange={(e) => setTimes((t) => ({ ...t, [r.s_id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      disabled={!times[r.s_id]}
                      busy={busyKey === `${r.s_id}:set_check_in`}
                      onClick={() => act(r, "set_check_in", `check-in set to ${times[r.s_id]}`)}
                    >
                      Set
                    </Button>
                    <Button size="sm" variant="ghost" busy={busyKey === `${r.s_id}:excuse`} onClick={() => act(r, "excuse", "excused")}>
                      Excuse
                    </Button>
                    <Button size="sm" variant="ghost" busy={busyKey === `${r.s_id}:mark_absent`} onClick={() => act(r, "mark_absent", "marked absent")}>
                      Absent
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}

/** Feedback review with MySQL FULLTEXT search and the rating distribution. */
export function FeedbackPanel({ activities }: { activities: Array<{ a_id: number; a_name: string }> }) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"natural" | "boolean">("natural");
  const [activityId, setActivityId] = useState<number | "">("");
  const [maxRating, setMaxRating] = useState<number | "">("");
  const fb = useApi<{
    feedback: FeedbackRow[];
    distribution: Array<{ a_id: number; a_name: string; rating: number; votes: number }>;
  }>(`/api/feedback${qs({ q, mode, activityId, maxRating })}`);

  return (
    <div className="space-y-6">
      <Card title="Rating distribution" subtitle="Share of each star rating per activity">
        {fb.data ? fb.data.distribution.length ? <RatingStacks rows={fb.data.distribution} /> : <Empty>No ratings yet.</Empty> : <Loading />}
      </Card>
      <Card
        title="Student feedback"
        subtitle="Search uses the FULLTEXT index on Feedback.comments. Boolean mode supports +must -exclude &quot;exact phrase&quot;."
      >
        <form
          className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(draft.trim());
          }}
        >
          <input className="input" placeholder='e.g. crowded lab   or   +mentor -rushed' value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Search feedback" />
          <select className="input" value={mode} onChange={(e) => setMode(e.target.value as "natural" | "boolean")} aria-label="Search mode">
            <option value="natural">Natural language</option>
            <option value="boolean">Boolean</option>
          </select>
          <select className="input" value={activityId} onChange={(e) => setActivityId(e.target.value ? Number(e.target.value) : "")} aria-label="Activity">
            <option value="">All activities</option>
            {activities.map((a) => (
              <option key={a.a_id} value={a.a_id}>
                {a.a_name}
              </option>
            ))}
          </select>
          <select className="input" value={maxRating} onChange={(e) => setMaxRating(e.target.value ? Number(e.target.value) : "")} aria-label="Maximum rating">
            <option value="">Any rating</option>
            <option value="2">2★ or lower</option>
            <option value="3">3★ or lower</option>
          </select>
          <Button type="submit" variant="primary">
            Search
          </Button>
        </form>
        {fb.loading && !fb.data ? (
          <Loading />
        ) : fb.error ? (
          <ErrorNote message={fb.error} onRetry={fb.reload} />
        ) : fb.data?.feedback.length ? (
          <>
            <p className="mb-2 text-xs text-ink-3">
              {fb.data.feedback.length} result(s){q ? ` for “${q}”, ranked by relevance` : ", newest first"}
            </p>
            <ul className="divide-y divide-line">
              {fb.data.feedback.map((f) => (
                <li key={f.f_id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{f.s_name}</span> <span className="font-mono text-xs text-ink-3">{f.s_usn}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Pill>{f.a_name}</Pill>
                      <span aria-label={`${f.rating} out of 5`}>
                        {"★".repeat(f.rating)}
                        <span className="text-ink-3">{"★".repeat(5 - f.rating)}</span>
                      </span>
                      {f.relevance != null && <span className="tabular text-xs text-ink-3">rel {Number(f.relevance).toFixed(2)}</span>}
                    </span>
                  </div>
                  {f.comments && <p className="mt-1 text-ink-2">{f.comments}</p>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Empty>No feedback matches.</Empty>
        )}
      </Card>
    </div>
  );
}

type Insights = {
  central: Array<{ s_id: number; name: string; branch: string | null; degree: number }>;
  activityInterest: Array<{ a_id: number; name: string; mentor: string | null; declared: number; fromRating: number; total: number }>;
  coInterest: Array<{ first: string; second: string; students: number }>;
  bridges: Array<{ s_id: number; name: string; branchesReached: number }>;
  network: { connections: number; crossBranch: number; crossBranchPct: number };
  mentorReach: Array<{ activity: string; branch: string | null; students: number; names: string[] }>;
};

/** Network-level findings computed in Neo4j. */
export function InsightsPanel({ mentorView = false }: { mentorView?: boolean }) {
  const ins = useApi<Insights>("/api/graph/insights");
  if (ins.loading && !ins.data) return <Loading label="Querying the graph…" />;
  if (ins.error) return <ErrorNote message={ins.error} onRetry={ins.reload} />;
  if (!ins.data) return null;
  const d = ins.data;
  const maxInterest = Math.max(1, ...d.activityInterest.map((a) => a.total));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {mentorView && (
        <Card title="Who is interested in your activities" subtitle="Students with an INTERESTED_IN edge to your activity, by branch" className="lg:col-span-2">
          {d.mentorReach.length ? (
            <TableWrap>
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Branch</th>
                  <th>Students</th>
                  <th>Names</th>
                </tr>
              </thead>
              <tbody>
                {d.mentorReach.map((r, i) => (
                  <tr key={i}>
                    <td>{r.activity}</td>
                    <td>{r.branch ?? "—"}</td>
                    <td className="tabular">{r.students}</td>
                    <td className="text-ink-2">{r.names.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <Empty>No interest recorded yet.</Empty>
          )}
        </Card>
      )}
      <Card title="Interest per activity" subtitle="Distinct students interested (declared or rated 4–5★)">
        <BarList
          max={maxInterest}
          format={(v) => String(v)}
          data={d.activityInterest.map((a) => ({
            key: a.a_id,
            label: a.name,
            value: a.total,
            detail: `${a.declared} declared · ${a.fromRating} from ratings · mentor ${a.mentor ?? "—"}`,
          }))}
        />
      </Card>
      <Card title="Peer network" subtitle="CONNECTED_TO relationships between students">
        <div className="mb-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-ink-3">Connections</div>
            <div className="tabular text-xl font-semibold">{d.network.connections}</div>
          </div>
          <div>
            <div className="text-xs text-ink-3">Cross-branch</div>
            <div className="tabular text-xl font-semibold">{d.network.crossBranchPct}%</div>
          </div>
        </div>
        <h3 className="mb-2 text-xs font-medium text-ink-3">Best-connected students (degree centrality)</h3>
        <ul className="space-y-1 text-sm">
          {d.central.slice(0, 6).map((c) => (
            <li key={c.s_id} className="flex justify-between gap-2">
              <span>
                {c.name} <span className="text-xs text-ink-3">{c.branch}</span>
              </span>
              <span className="tabular text-ink-2">{c.degree}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Activities that attract the same students" subtitle="Pairs of activities sharing interested students">
        {d.coInterest.length ? (
          <ul className="space-y-1.5 text-sm">
            {d.coInterest.map((c, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>
                  {c.first} <span className="text-ink-3">+</span> {c.second}
                </span>
                <span className="tabular text-ink-2">{c.students}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No overlapping interests yet.</Empty>
        )}
      </Card>
      <Card title="Bridges between branches" subtitle="Students whose connections reach the most branches">
        <ul className="space-y-1.5 text-sm">
          {d.bridges.map((b) => (
            <li key={b.s_id} className="flex justify-between gap-2">
              <span>{b.name}</span>
              <span className="tabular text-ink-2">{b.branchesReached} branches</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
