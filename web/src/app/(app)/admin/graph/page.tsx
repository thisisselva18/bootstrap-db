"use client";

import { useState } from "react";
import { PathFinder } from "@/components/path-finder";
import { InsightsPanel } from "@/components/staff";
import { Button, Card, ErrorNote, Loading, Notice, PageHeader, TableWrap } from "@/components/ui";
import { apiSend, useApi } from "@/components/use-api";

type Counts = { nodes: Array<{ label: string; total: number }>; relationships: Array<{ type: string; total: number }> };

export default function GraphAdmin() {
  const counts = useApi<Counts>("/api/graph/sync");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [insightsKey, setInsightsKey] = useState(0);

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiSend<Counts & { ms: number }>("POST", "/api/graph/sync");
      counts.setData(res);
      setInsightsKey((k) => k + 1);
      setMsg({ kind: "success", text: `Graph rebuilt from MySQL in ${res.ms} ms` });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Graph (Neo4j)"
        subtitle="MySQL is the source of truth for records; Neo4j holds the relationship graph used for matchmaking."
        actions={
          <Button variant="primary" busy={busy} onClick={sync}>
            Sync from MySQL
          </Button>
        }
      />
      {msg && (
        <div className="mb-4">
          <Notice kind={msg.kind}>{msg.text}</Notice>
        </div>
      )}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="Nodes">
          {counts.loading && !counts.data ? (
            <Loading />
          ) : counts.error ? (
            <ErrorNote message={counts.error} onRetry={counts.reload} />
          ) : (
            <TableWrap>
              <tbody>
                {counts.data?.nodes.map((n) => (
                  <tr key={n.label}>
                    <td className="font-mono text-xs">:{n.label}</td>
                    <td className="tabular text-right">{n.total}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
        <Card title="Relationships">
          {counts.data && (
            <TableWrap>
              <tbody>
                {counts.data.relationships.map((r) => (
                  <tr key={r.type}>
                    <td className="font-mono text-xs">[:{r.type}]</td>
                    <td className="tabular text-right">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
        <Card title="How the data is split">
          <ul className="list-disc space-y-1.5 pl-4 text-sm text-ink-2">
            <li>Students, groups, activities, mentors and branches become nodes keyed by their MySQL ids.</li>
            <li>Group membership, branch, mentoring, participation and ratings are copied as relationships and rebuilt on each sync.</li>
            <li>Peer connections and self-declared interests exist only in Neo4j; the sync never deletes them.</li>
            <li>Writes made in the app refresh the affected student automatically.</li>
          </ul>
        </Card>
      </div>
      <PathFinder />
      <div className="mt-6">
        <InsightsPanel key={insightsKey} />
      </div>
    </>
  );
}

