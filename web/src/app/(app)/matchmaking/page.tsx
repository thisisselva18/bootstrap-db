"use client";

import { useState } from "react";
import { EgoGraphView } from "@/components/graph-view";
import { PathFinder } from "@/components/path-finder";
import { Button, Card, Empty, ErrorNote, Loading, Notice, PageHeader, Pill, TableWrap, pct } from "@/components/ui";
import { apiSend, qs, useApi } from "@/components/use-api";
import type { Session } from "@/lib/auth/session";
import type {
  ActivityRecommendation,
  Connection,
  EgoGraph,
  MentorRecommendation,
  PeerRecommendation,
  SimilarStudent,
} from "@/lib/types";

type Prefer = "cross-branch" | "same-branch" | "any";
type Interest = { a_id: number; name: string; declared: boolean; fromRating: boolean };

export default function MatchmakingPage() {
  const me = useApi<{ user: Session }>("/api/auth/me");
  const isStudent = me.data?.user.role === "student";
  const staffList = useApi<{ students: Array<{ s_id: number; name: string; usn: string }> }>(
    me.data && !isStudent ? "/api/graph/students" : null,
  );
  const [chosen, setPicked] = useState<number | null>(null);
  const picked = chosen ?? staffList.data?.students[0]?.s_id ?? null;

  if (me.loading) return <Loading />;
  if (me.error) return <ErrorNote message={me.error} />;
  const studentId = isStudent ? me.data!.user.sId! : picked;

  return (
    <>
      <PageHeader
        title="Matchmaking"
        subtitle="Find teammates and activities through the Neo4j relationship graph: shared interests, mutual connections and cross-branch diversity."
        actions={
          !isStudent && (
            <select
              className="input w-auto min-w-56"
              value={picked ?? ""}
              onChange={(e) => setPicked(Number(e.target.value))}
              aria-label="View matchmaking for student"
            >
              {staffList.data?.students.map((s) => (
                <option key={s.s_id} value={s.s_id}>
                  {s.name} · {s.usn}
                </option>
              ))}
            </select>
          )
        }
      />
      {studentId ? <Matchmaking key={studentId} studentId={studentId} canEdit={isStudent} /> : <Loading />}
    </>
  );
}

function Matchmaking({ studentId, canEdit }: { studentId: number; canEdit: boolean }) {
  const [prefer, setPrefer] = useState<Prefer>("cross-branch");
  const ref = canEdit ? {} : { studentId };
  const recs = useApi<{ peers: PeerRecommendation[]; activities: ActivityRecommendation[]; mentors: MentorRecommendation[] }>(
    `/api/graph/recommendations${qs({ ...ref, prefer, limit: 8 })}`,
  );
  const similar = useApi<{ similar: SimilarStudent[] }>(`/api/graph/similar${qs({ ...ref, limit: 6 })}`);
  const conns = useApi<{ connections: Connection[] }>(`/api/graph/connections${qs(ref)}`);
  const ego = useApi<EgoGraph>(`/api/graph/ego${qs(ref)}`);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const refreshAll = () => {
    recs.reload();
    similar.reload();
    conns.reload();
    ego.reload();
  };

  async function connect(p: PeerRecommendation) {
    setMsg(null);
    try {
      await apiSend("POST", "/api/graph/connections", { peerId: p.s_id });
      setMsg({ kind: "success", text: `You are now connected with ${p.name}` });
      refreshAll();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }

  async function disconnect(c: Connection) {
    if (!confirm(`Remove your connection with ${c.name}?`)) return;
    try {
      await apiSend("DELETE", `/api/graph/connections${qs({ peerId: c.s_id })}`);
      refreshAll();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  }

  if (recs.error && recs.error.includes("Neo4j")) {
    return <ErrorNote message={`${recs.error}. Records in MySQL are unaffected; try again once the graph database is running.`} onRetry={refreshAll} />;
  }

  return (
    <div className="space-y-6">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="grid gap-6 lg:grid-cols-3">
        <InterestsCard studentId={studentId} canEdit={canEdit} onChanged={refreshAll} />
        <Card
          title="Recommended teammates"
          subtitle="0.6 × interest overlap (Jaccard) + mutual connections + branch preference + different colour group"
          className="lg:col-span-2"
          actions={
            <select className="input w-auto py-1 text-xs" value={prefer} onChange={(e) => setPrefer(e.target.value as Prefer)} aria-label="Branch preference">
              <option value="cross-branch">Prefer other branches</option>
              <option value="same-branch">Prefer my branch</option>
              <option value="any">No branch preference</option>
            </select>
          }
        >
          {recs.loading && !recs.data ? (
            <Loading label="Traversing the graph…" />
          ) : recs.error ? (
            <ErrorNote message={recs.error} onRetry={recs.reload} />
          ) : !recs.data?.peers.length ? (
            <Empty>No matches yet — add an interest or connect with someone first.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {recs.data.peers.map((p) => (
                <li key={p.s_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-ink-3">
                        {p.branch} · {p.group} group
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.reasons.map((r) => (
                        <Pill key={r}>{r}</Pill>
                      ))}
                    </div>
                    <div className="mt-1 text-xs text-ink-3">
                      Attendance {pct(p.attendance_pct)} (MySQL) · Jaccard {p.jaccard.toFixed(2)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="w-24">
                      <div className="tabular text-right text-sm font-semibold">{Math.round(p.score * 100)}</div>
                      <div className="mt-1 h-1.5 rounded-full" style={{ background: "var(--track)" }}>
                        <div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, p.score * 100)}%`, background: "var(--series-1)" }} />
                      </div>
                    </div>
                    {canEdit && (
                      <Button size="sm" variant="primary" onClick={() => connect(p)}>
                        Connect
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Activities to explore" subtitle="Collaborative filtering: what students like you are interested in">
          {recs.data?.activities.length ? (
            <ul className="space-y-3 text-sm">
              {recs.data.activities.map((a) => (
                <li key={a.a_id}>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{a.name}</span>
                    <span className="tabular text-xs text-ink-2">
                      {a.supporters} peer{a.supporters === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="text-xs text-ink-3">
                    Mentor {a.mentor ?? "—"} · liked by {a.supporterNames.join(", ")}
                    {a.supporters > a.supporterNames.length ? "…" : ""}
                  </div>
                </li>
              ))}
            </ul>
          ) : recs.loading ? (
            <Loading />
          ) : (
            <Empty>You already follow every activity.</Empty>
          )}
        </Card>
        <Card title="Mentors to meet" subtitle="Reached through your interests, or your connections' interests">
          {recs.data?.mentors.length ? (
            <ul className="space-y-3 text-sm">
              {recs.data.mentors.map((m) => (
                <li key={m.m_id}>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-xs text-ink-2">{m.peers ? `${m.peers} connection(s) interested` : "your interest"}</span>
                  </div>
                  <div className="text-xs text-ink-3">
                    {m.dept} · via {m.viaActivities.join(", ")}
                  </div>
                </li>
              ))}
            </ul>
          ) : recs.loading ? (
            <Loading />
          ) : (
            <Empty>No mentors reachable yet.</Empty>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Your network" subtitle="Hover a node to highlight its links" className="lg:col-span-3">
          {ego.loading && !ego.data ? <Loading /> : ego.error ? <ErrorNote message={ego.error} /> : ego.data && <EgoGraphView graph={ego.data} />}
        </Card>
        <Card title={`Connections (${conns.data?.connections.length ?? 0})`} className="lg:col-span-2">
          {conns.loading && !conns.data ? (
            <Loading />
          ) : !conns.data?.connections.length ? (
            <Empty>No connections yet.</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {conns.data.connections.map((c) => (
                <li key={c.s_id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{c.name}</span>
                    <span className="block text-xs text-ink-3">
                      {c.branch} · {c.group} group
                    </span>
                  </span>
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => disconnect(c)}>
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Similar participation patterns" subtitle="Shared interests (0.45) + rating agreement on co-rated activities (0.35) + same attendance status (0.20)">
        {similar.loading && !similar.data ? (
          <Loading />
        ) : !similar.data?.similar.length ? (
          <Empty>Not enough shared data yet.</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <th>Student</th>
                <th>Branch · group</th>
                <th className="text-right">Shared interests</th>
                <th className="text-right">Co-rated</th>
                <th className="text-right">Rating agreement</th>
                <th className="text-right">Same status</th>
                <th className="text-right">Similarity</th>
              </tr>
            </thead>
            <tbody>
              {similar.data.similar.map((s) => (
                <tr key={s.s_id}>
                  <td className="font-medium">{s.name}</td>
                  <td className="text-ink-2">
                    {s.branch} · {s.group}
                  </td>
                  <td className="tabular text-right">{s.sharedInterests}</td>
                  <td className="tabular text-right">{s.coRated}</td>
                  <td className="tabular text-right">{s.ratingAgreement == null ? "—" : `${Math.round(s.ratingAgreement * 100)}%`}</td>
                  <td className="tabular text-right">{s.sameStatusCount}/5</td>
                  <td className="tabular text-right font-semibold">{s.similarity.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <PathFinder fixedFrom={studentId} />
    </div>
  );
}

function InterestsCard({ studentId, canEdit, onChanged }: { studentId: number; canEdit: boolean; onChanged: () => void }) {
  const data = useApi<{ interests: Interest[] }>(`/api/graph/interests${qs(canEdit ? {} : { studentId })}`);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const interests = data.data?.interests ?? [];
  const declared = draft ?? interests.filter((i) => i.declared).map((i) => i.a_id);
  const dirty = draft !== null;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ interests: Interest[] }>("PUT", "/api/graph/interests", { activityIds: declared });
      data.setData(res);
      setDraft(null);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Interests" subtitle={canEdit ? "Tick what you would like to keep doing. Ratings of 4–5★ count automatically." : "Declared and rating-derived interests"}>
      {data.loading && !data.data ? (
        <Loading />
      ) : data.error ? (
        <ErrorNote message={data.error} onRetry={data.reload} />
      ) : (
        <>
          <ul className="space-y-2">
            {interests.map((i) => (
              <li key={i.a_id} className="flex items-center justify-between gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={declared.includes(i.a_id)}
                    onChange={(e) =>
                      setDraft(e.target.checked ? [...declared, i.a_id] : declared.filter((id) => id !== i.a_id))
                    }
                  />
                  {i.name}
                </label>
                {i.fromRating && <Pill tone="accent">rated ★4+</Pill>}
              </li>
            ))}
          </ul>
          {error && (
            <div className="mt-3">
              <Notice kind="error">{error}</Notice>
            </div>
          )}
          {canEdit && (
            <div className="mt-4 flex justify-end gap-2">
              {dirty && (
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  Reset
                </Button>
              )}
              <Button size="sm" variant="primary" disabled={!dirty} busy={busy} onClick={save}>
                Save interests
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
