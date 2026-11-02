"use client";

import Link from "next/link";
import { BarList } from "@/components/charts";
import { Card, ErrorNote, GroupTag, Loading, PageHeader, RiskBadge, Stat, TableWrap, pct } from "@/components/ui";
import { useApi } from "@/components/use-api";
import type { Overview } from "@/lib/services/stats";

export default function AdminOverview() {
  const ov = useApi<Overview>("/api/stats/overview");
  const health = useApi<{ mysql: boolean; neo4j: boolean }>("/api/health");

  if (ov.loading && !ov.data) return <Loading />;
  if (ov.error) return <ErrorNote message={ov.error} onRetry={ov.reload} />;
  if (!ov.data) return null;
  const d = ov.data;
  const riskCount = Object.fromEntries(d.risk.map((r) => [r.risk, r.students]));

  return (
    <>
      <PageHeader
        title="Programme overview"
        subtitle="Live figures from MySQL views, functions and analytical queries"
        actions={
          health.data && (
            <div className="flex items-center gap-3 text-xs text-ink-2">
              {(["mysql", "neo4j"] as const).map((k) => (
                <span key={k} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1">
                  <span aria-hidden style={{ color: health.data![k] ? "var(--good)" : "var(--critical)" }}>
                    {health.data![k] ? "●" : "✕"}
                  </span>
                  {k === "mysql" ? "MySQL" : "Neo4j"} {health.data![k] ? "connected" : "unreachable"}
                </span>
              ))}
            </div>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Students" value={d.totals.students} />
        <Stat label="Mentors" value={d.totals.mentors} />
        <Stat label="Sessions scheduled" value={d.totals.sessions} hint={`${d.totals.groups} groups × ${d.totals.activities} activities`} />
        <Stat label="Overall attendance" value={pct(d.overallAttendancePct)} hint="present + late" />
        <Stat label="Feedback responses" value={d.totals.feedback} />
        <Stat label="Audit log entries" value={d.totals.auditEntries} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Attendance by colour group" subtitle="vw_group_stats">
          <BarList
            data={d.groups.map((g) => ({
              key: g.g_id,
              label: <GroupTag name={g.g_name} />,
              value: g.attendance_pct,
              detail: `${g.students} students · ${g.present} present · ${g.late_arrivals} late · ${g.absent} absent · ${g.excused} excused`,
            }))}
          />
        </Card>
        <Card title="Attendance by activity" subtitle="vw_activity_stats">
          <BarList
            data={d.activities.map((a) => ({
              key: a.a_id,
              label: a.a_name,
              value: a.attendance_pct,
              detail: `${a.attended}/${a.enrolled} attended · avg rating ${Number(a.avg_rating).toFixed(2)} (${a.responses}) · ${a.mentor ?? "no mentor"}`,
            }))}
          />
        </Card>

        <Card title="Attendance risk" subtitle="fn_risk_level: LOW ≥ 80%, MEDIUM ≥ 60%, HIGH below">
          <div className="mb-4 flex flex-wrap gap-3">
            {(["HIGH", "MEDIUM", "LOW"] as const).map((r) => (
              <div key={r} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                <RiskBadge risk={r} />
                <span className="tabular text-lg font-semibold">{riskCount[r] ?? 0}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-ink-3">Late at least once</div>
              <div className="tabular text-lg font-semibold">{d.flags.late_once}</div>
            </div>
            <div>
              <div className="text-xs text-ink-3">Never absent</div>
              <div className="tabular text-lg font-semibold">{d.flags.never_absent}</div>
            </div>
            <div>
              <div className="text-xs text-ink-3">No feedback given</div>
              <div className="tabular text-lg font-semibold">{d.flags.no_feedback}</div>
            </div>
          </div>
        </Card>

        <Card title="Students by branch" subtitle="GROUP BY branch HAVING COUNT(*) ≥ 2">
          <BarList
            max={Math.max(1, ...d.branches.map((b) => b.students))}
            format={(v) => String(v)}
            data={d.branches.map((b) => ({ key: b.branch, label: b.branch, value: b.students, detail: `average semester ${b.avg_semester}` }))}
          />
        </Card>

        <Card
          title="Below programme average"
          subtitle="Scalar subquery against AVG(attendance_pct)"
          actions={
            <Link className="text-sm text-accent hover:underline" href="/admin/attendance">
              Attendance →
            </Link>
          }
          className="lg:col-span-2"
        >
          <TableWrap>
            <thead>
              <tr>
                <th>USN</th>
                <th>Name</th>
                <th>Group</th>
                <th className="text-right">Attendance</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {d.belowAverage.map((s) => (
                <tr key={s.s_id}>
                  <td className="font-mono text-xs">{s.s_usn}</td>
                  <td>{s.s_name}</td>
                  <td>
                    <GroupTag name={s.colour_group} />
                  </td>
                  <td className="tabular text-right">{pct(s.attendance_pct)}</td>
                  <td>
                    <RiskBadge risk={s.risk} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      </div>
    </>
  );
}
