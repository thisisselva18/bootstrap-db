"use client";

import { useState } from "react";
import { Button, Card, Notice } from "./ui";
import { useApi } from "./use-api";

/** Shortest path between two students in the Neo4j graph. */
export function PathFinder({ fixedFrom }: { fixedFrom?: number }) {
  const students = useApi<{ students: Array<{ s_id: number; name: string; usn: string }> }>("/api/graph/students");
  const [from, setFrom] = useState<number | "">(fixedFrom ?? "");
  const [to, setTo] = useState<number | "">("");
  const [path, setPath] = useState<{ length: number; nodes: Array<{ kind: string; label: string }>; rels: string[] } | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/graph/path?from=${fixedFrom ?? from}&to=${to}`).then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error);
        return body;
      });
      setPath(res.path);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const options = students.data?.students ?? [];
  return (
    <Card title="How are two students connected?" subtitle="Shortest path over connections and shared interests (Cypher SHORTEST)">
      <form onSubmit={find} className="flex flex-wrap items-end gap-2">
        {fixedFrom === undefined && (
          <select className="input w-auto min-w-48" required value={from} onChange={(e) => setFrom(e.target.value ? Number(e.target.value) : "")} aria-label="From student">
            <option value="">From…</option>
            {options.map((s) => (
              <option key={s.s_id} value={s.s_id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select className="input w-auto min-w-48" required value={to} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : "")} aria-label="To student">
          <option value="">{fixedFrom === undefined ? "To…" : "Choose a student…"}</option>
          {options
            .filter((s) => s.s_id !== fixedFrom)
            .map((s) => (
              <option key={s.s_id} value={s.s_id}>
                {s.name}
              </option>
            ))}
        </select>
        <Button type="submit" variant="primary" busy={busy}>
          Find path
        </Button>
      </form>
      {error && (
        <div className="mt-3">
          <Notice kind="error">{error}</Notice>
        </div>
      )}
      {path === null && <p className="mt-3 text-sm text-ink-3">No path within six hops.</p>}
      {path && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-sm">
          {path.nodes.map((n, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <span className="rounded-lg border border-line bg-surface-2 px-2 py-1">
                <span className="text-xs text-ink-3">{n.kind} </span>
                {n.label}
              </span>
              {i < path.rels.length && <span className="font-mono text-xs text-ink-3">—{path.rels[i]}—</span>}
            </span>
          ))}
          <span className="ml-2 text-xs text-ink-3">({path.length} hop{path.length > 1 ? "s" : ""})</span>
        </div>
      )}
    </Card>
  );
}
