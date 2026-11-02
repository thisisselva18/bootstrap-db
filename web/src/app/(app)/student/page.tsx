"use client";

import Link from "next/link";
import { useState } from "react";
import { Meter } from "@/components/charts";
import {
  Button,
  Card,
  DAY_NAMES,
  Empty,
  ErrorNote,
  Field,
  GroupTag,
  Loading,
  Modal,
  Notice,
  PageHeader,
  Pill,
  RiskBadge,
  Stat,
  StatusBadge,
  TableWrap,
  pct,
  time,
} from "@/components/ui";
import { apiSend, useApi } from "@/components/use-api";
import type { PeerRecommendation, ScheduleItem, StudentDashboard } from "@/lib/types";

export default function StudentPage() {
  const dash = useApi<StudentDashboard>("/api/me/dashboard");
  const recs = useApi<{ peers: PeerRecommendation[] }>("/api/graph/recommendations?limit=3");
  const [rating, setRating] = useState<ScheduleItem | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  if (dash.loading && !dash.data) return <Loading />;
  if (dash.error) return <ErrorNote message={dash.error} onRetry={dash.reload} />;
  if (!dash.data) return null;
  const { profile, stats, schedule, groupRank } = dash.data;
  const attended = stats.present + stats.late_arrivals;

  return (
    <>
      <PageHeader
        title={`Hello, ${profile.s_name.split(" ")[0]}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono">{profile.s_usn}</span>
            <GroupTag name={profile.g_name} />
            <span>{profile.branch}</span>
            <span>Semester {profile.semester}</span>
          </span>
        }
      />

      {flash && (
        <div className="mb-4">
          <Notice kind="success">{flash}</Notice>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Attendance" value={pct(stats.attendance_pct)} hint={<RiskBadge risk={stats.risk} />} />
        <Stat label="Sessions attended" value={`${attended} / ${stats.sessions}`} hint={`${stats.late_arrivals} late arrival(s)`} />
        <Stat label="Absent / excused" value={`${stats.absent} / ${stats.excused}`} />
        <Stat
          label={`Rank in ${profile.g_name} group`}
          value={groupRank ? `#${groupRank.rank_in_group}` : "—"}
          hint={groupRank ? `of ${groupRank.group_size} · group avg ${pct(groupRank.group_avg_pct)}` : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card
            title="My timetable"
            subtitle="Your colour group meets each activity once across the five days. Rate the sessions you attended."
            pad={false}
          >
            <div className="p-4">
              <TableWrap>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Activity</th>
                    <th>Room / time</th>
                    <th>Status</th>
                    <th>In → out</th>
                    <th>Your rating</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((s) => {
                    const canRate = s.status === "present" || s.status === "late";
                    return (
                      <tr key={s.schedule_id}>
                        <td className="whitespace-nowrap text-ink-2">{DAY_NAMES[s.day]}</td>
                        <td>
                          <div className="font-medium">{s.activity}</div>
                          <div className="text-xs text-ink-3">{s.mentor ?? "Mentor to be assigned"}</div>
                        </td>
                        <td className="whitespace-nowrap">
                          <div>{s.room ?? "—"}</div>
                          <div className="tabular text-xs text-ink-3">
                            {time(s.start_time)}–{time(s.end_time)}
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={s.status} />
                        </td>
                        <td className="tabular whitespace-nowrap text-ink-2">
                          {time(s.check_in_time)} → {time(s.check_out_time)}
                          {s.minutes != null && <div className="text-xs text-ink-3">{s.minutes} min</div>}
                        </td>
                        <td className="whitespace-nowrap">
                          {s.rating != null && (
                            <span className="mr-2" aria-label={`${s.rating} out of 5`}>
                              {"★".repeat(s.rating)}
                              <span className="text-ink-3">{"★".repeat(5 - s.rating)}</span>
                            </span>
                          )}
                          {canRate ? (
                            <Button size="sm" onClick={() => setRating(s)}>
                              {s.rating != null ? "Edit" : "Rate"}
                            </Button>
                          ) : (
                            <span className="text-xs text-ink-3">Attend to rate</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Attendance">
            <div className="space-y-4">
              <Meter label="Your attendance" value={stats.attendance_pct} />
              {groupRank && <Meter label={`${profile.g_name} group average`} value={groupRank.group_avg_pct} />}
              <p className="text-xs text-ink-3">
                80% or more keeps you certificate-eligible (risk is computed by fn_risk_level in MySQL).
              </p>
            </div>
          </Card>

          <Card
            title="People you might team up with"
            subtitle="From the Neo4j interest graph"
            actions={
              <Link href="/matchmaking" className="text-sm text-accent hover:underline">
                Matchmaking →
              </Link>
            }
          >
            {recs.loading ? (
              <Loading />
            ) : recs.error ? (
              <p className="text-sm text-ink-3">{recs.error}</p>
            ) : recs.data?.peers.length ? (
              <ul className="space-y-3">
                {recs.data.peers.map((p) => (
                  <li key={p.s_id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{p.name}</span>
                      <Pill tone="accent">match {Math.round(p.score * 100)}</Pill>
                    </div>
                    <div className="text-xs text-ink-3">{p.reasons.slice(0, 2).join(" · ")}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Pick some interests on the Matchmaking page to get suggestions.</Empty>
            )}
          </Card>
        </div>
      </div>

      <Modal open={!!rating} title={`Rate ${rating?.activity ?? ""}`} onClose={() => setRating(null)}>
        {rating && (
          <FeedbackForm
            item={rating}
            onDone={() => {
              setRating(null);
              setFlash("Thanks! Your feedback was saved.");
              dash.reload();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function FeedbackForm({ item, onDone }: { item: ScheduleItem; onDone: () => void }) {
  const [stars, setStars] = useState(item.rating ?? 0);
  const [comments, setComments] = useState(item.comments ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stars) {
      setError("Choose a rating from 1 to 5");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiSend("POST", "/api/me/feedback", { activityId: item.a_id, rating: stars, comments: comments || undefined });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-2">Rating</legend>
        <div className="flex gap-1" role="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              onClick={() => setStars(n)}
              className="rounded-md px-1.5 text-2xl leading-none"
              style={{ color: n <= stars ? "var(--yellow)" : "var(--border)" }}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="Comments (optional)" hint={`${comments.length}/1000`}>
        <textarea className="input min-h-28" maxLength={1000} value={comments} onChange={(e) => setComments(e.target.value)} />
      </Field>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end gap-2">
        <Button type="submit" variant="primary" busy={busy}>
          Save feedback
        </Button>
      </div>
    </form>
  );
}
