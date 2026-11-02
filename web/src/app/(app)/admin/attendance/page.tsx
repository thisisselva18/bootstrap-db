"use client";

import { useState } from "react";
import { RosterPanel } from "@/components/staff";
import { Button, Card, Empty, ErrorNote, GroupTag, Loading, PageHeader, RiskBadge, StatusBadge, TableWrap, Tabs, pct } from "@/components/ui";
import { qs, useApi } from "@/components/use-api";
import type { AuditRow, StudentRow } from "@/lib/types";

type Tab = "record" | "risk" | "audit";

export default function AttendanceAdmin() {
  const meta = useApi<{ activities: Array<{ a_id: number; a_name: string }> }>("/api/meta");
  const [tab, setTab] = useState<Tab>("record");
  const [activityId, setActivityId] = useState<number>(1);
  const activity = meta.data?.activities.find((a) => a.a_id === activityId);

  return (
    <>
      <PageHeader title="Attendance" subtitle="Record attendance for any activity, follow up at-risk students and inspect the audit trail" />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "record", label: "Record attendance" },
          { id: "risk", label: "At-risk students" },
          { id: "audit", label: "Audit log" },
        ]}
      />
      {tab === "record" && (
        <div className="space-y-4">
          <label className="flex max-w-sm items-center gap-2 text-sm">
            <span className="shrink-0 text-ink-2">Activity</span>
            <select className="input" value={activityId} onChange={(e) => setActivityId(Number(e.target.value))}>
              {meta.data?.activities.map((a) => (
                <option key={a.a_id} value={a.a_id}>
                  {a.a_name}
                </option>
              ))}
            </select>
          </label>
          {activity && <RosterPanel key={activity.a_id} activityId={activity.a_id} activityName={activity.a_name} />}
        </div>
      )}
      {tab === "risk" && <RiskList />}
      {tab === "audit" && <AuditLog activities={meta.data?.activities ?? []} />}
    </>
  );
}

const RECOMMENDATION: Record<string, string> = {
  HIGH: "Refer to the coordinator",
  MEDIUM: "Needs a make-up session",
  LOW: "Certificate eligible",
};

function RiskList() {
  const [risk, setRisk] = useState<"HIGH" | "MEDIUM">("HIGH");
  const list = useApi<{ students: StudentRow[] }>(`/api/students${qs({ risk, sort: "attendance" })}`);
  return (
    <Card
      title="Attendance risk report"
      subtitle="vw_student_attendance with fn_attendance_pct and fn_risk_level"
      actions={
        <div className="flex gap-1">
          {(["HIGH", "MEDIUM"] as const).map((r) => (
            <Button key={r} size="sm" variant={risk === r ? "primary" : "secondary"} onClick={() => setRisk(r)}>
              {r === "HIGH" ? "High" : "Medium"}
            </Button>
          ))}
        </div>
      }
    >
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error ? (
        <ErrorNote message={list.error} onRetry={list.reload} />
      ) : !list.data?.students.length ? (
        <Empty>No students at this risk level.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>Student</th>
              <th>Group</th>
              <th className="text-right">Attended</th>
              <th className="text-right">Attendance</th>
              <th>Risk</th>
              <th>Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {list.data.students.map((s) => (
              <tr key={s.s_id}>
                <td>
                  <div className="font-medium">{s.s_name}</div>
                  <div className="font-mono text-xs text-ink-3">{s.s_usn}</div>
                </td>
                <td>
                  <GroupTag name={s.colour_group} />
                </td>
                <td className="tabular text-right">
                  {s.present + s.late_arrivals}/{s.sessions}
                </td>
                <td className="tabular text-right">{pct(s.attendance_pct)}</td>
                <td>
                  <RiskBadge risk={s.risk} />
                </td>
                <td className="text-ink-2">{RECOMMENDATION[s.risk]}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}

function AuditLog({ activities }: { activities: Array<{ a_id: number; a_name: string }> }) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [activityId, setActivityId] = useState<number | "">("");
  const log = useApi<{ entries: AuditRow[] }>(`/api/attendance/audit${qs({ q, activityId, limit: 200 })}`);
  return (
    <Card title="Attendance audit log" subtitle="Append-only, written by trg_part_audit on every status change (vw_attendance_audit)">
      <form
        className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft.trim());
        }}
      >
        <input className="input" placeholder="Student, USN or changed by…" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Search audit log" />
        <select className="input" value={activityId} onChange={(e) => setActivityId(e.target.value ? Number(e.target.value) : "")} aria-label="Activity">
          <option value="">All activities</option>
          {activities.map((a) => (
            <option key={a.a_id} value={a.a_id}>
              {a.a_name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary">
          Filter
        </Button>
      </form>
      {log.loading && !log.data ? (
        <Loading />
      ) : log.error ? (
        <ErrorNote message={log.error} onRetry={log.reload} />
      ) : !log.data?.entries.length ? (
        <Empty>No audit entries match.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th>When</th>
              <th>Student</th>
              <th>Activity</th>
              <th>Change</th>
              <th>Changed by</th>
            </tr>
          </thead>
          <tbody>
            {log.data.entries.map((e) => (
              <tr key={e.log_id}>
                <td className="tabular whitespace-nowrap text-ink-2">{e.changed_at}</td>
                <td>
                  {e.s_name} <span className="font-mono text-xs text-ink-3">{e.s_usn}</span>
                </td>
                <td>{e.activity}</td>
                <td className="whitespace-nowrap">
                  <StatusBadge status={e.old_status} /> → <StatusBadge status={e.new_status} />
                </td>
                <td className="break-all text-ink-2">{e.changed_by}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  );
}
