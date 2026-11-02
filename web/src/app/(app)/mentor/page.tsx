"use client";

import { useState } from "react";
import { FeedbackPanel, InsightsPanel, RosterPanel } from "@/components/staff";
import { Card, Empty, ErrorNote, Loading, PageHeader, Tabs, cx, pct } from "@/components/ui";
import { useApi } from "@/components/use-api";
import type { ActivityStats } from "@/lib/types";

type Tab = "attendance" | "feedback" | "insights";

export default function MentorPage() {
  const acts = useApi<{ activities: ActivityStats[] }>("/api/activities?mine=1");
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("attendance");

  if (acts.loading && !acts.data) return <Loading />;
  if (acts.error) return <ErrorNote message={acts.error} onRetry={acts.reload} />;
  const list = acts.data?.activities ?? [];
  const current = list.find((a) => a.a_id === selected) ?? list[0];

  return (
    <>
      <PageHeader title="My activities" subtitle="Monitor participation, record attendance and review feedback for the activities you mentor." />
      {list.length === 0 ? (
        <Card>
          <Empty>No activity is assigned to you yet. An administrator can assign you on the Activities page.</Empty>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((a) => (
              <button
                key={a.a_id}
                onClick={() => setSelected(a.a_id)}
                className={cx(
                  "rounded-xl border bg-surface p-4 text-left transition-colors",
                  current?.a_id === a.a_id ? "border-accent ring-1 ring-accent" : "border-line hover:bg-surface-2",
                )}
              >
                <div className="font-semibold">{a.a_name}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-ink-3">{a.description}</div>
                <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <dt className="text-ink-3">Enrolled</dt>
                    <dd className="tabular text-base font-semibold">{a.enrolled}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Attended</dt>
                    <dd className="tabular text-base font-semibold">{pct(a.attendance_pct)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Rating</dt>
                    <dd className="tabular text-base font-semibold">{Number(a.avg_rating).toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-3">Capacity</dt>
                    <dd className="tabular text-base font-semibold">{a.capacity}</dd>
                  </div>
                </dl>
              </button>
            ))}
          </div>

          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "attendance", label: "Attendance" },
              { id: "feedback", label: "Feedback" },
              { id: "insights", label: "Interest graph" },
            ]}
          />
          {tab === "attendance" && current && <RosterPanel key={current.a_id} activityId={current.a_id} activityName={current.a_name} />}
          {tab === "feedback" && <FeedbackPanel activities={list} />}
          {tab === "insights" && <InsightsPanel mentorView />}
        </>
      )}
    </>
  );
}
