"use client";

import { useState } from "react";
import type { EgoGraph } from "@/lib/types";

// Radial ego network: the student in the centre, their group, branch and
// interests on the inner ring, mentors and connected students on the outer
// ring. Kinds differ by shape as well as colour, and every node is labelled.

type Kind = EgoGraph["nodes"][number]["kind"];

const KIND_STYLE: Record<Kind, { color: string; label: string }> = {
  me: { color: "var(--text)", label: "You" },
  student: { color: "#2a78d6", label: "Connected student" },
  activity: { color: "#eb6834", label: "Interest (activity)" },
  mentor: { color: "#1baf7a", label: "Mentor" },
  group: { color: "var(--text-3)", label: "Colour group" },
  branch: { color: "var(--text-3)", label: "Branch" },
};

function Shape({ kind, x, y, r }: { kind: Kind; x: number; y: number; r: number }) {
  const fill = KIND_STYLE[kind].color;
  const ring = { stroke: "var(--surface)", strokeWidth: 2 };
  if (kind === "activity") {
    return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} rx={3} fill={fill} {...ring} />;
  }
  if (kind === "mentor") {
    const p = `${x},${y - r * 1.15} ${x + r * 1.1},${y + r * 0.8} ${x - r * 1.1},${y + r * 0.8}`;
    return <polygon points={p} fill={fill} {...ring} />;
  }
  if (kind === "group" || kind === "branch") {
    const p = `${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`;
    return <polygon points={p} fill={fill} {...ring} />;
  }
  return <circle cx={x} cy={y} r={kind === "me" ? r * 1.4 : r} fill={fill} {...ring} />;
}

export function EgoGraphView({ graph }: { graph: EgoGraph }) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 640;
  const H = 440;
  const cx = W / 2;
  const cy = H / 2;

  const me = graph.nodes.find((n) => n.kind === "me");
  const inner = graph.nodes.filter((n) => n.kind === "group" || n.kind === "branch" || n.kind === "activity");
  const outer = graph.nodes.filter((n) => n.kind === "mentor" || n.kind === "student");

  const pos = new Map<string, { x: number; y: number }>();
  if (me) pos.set(me.id, { x: cx, y: cy });
  const place = (nodes: typeof inner, rx: number, ry: number, offset: number) =>
    nodes.forEach((n, i) => {
      const a = offset + (2 * Math.PI * i) / Math.max(nodes.length, 1);
      pos.set(n.id, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    });
  place(inner, 150, 105, -Math.PI / 2);
  place(outer, 270, 185, -Math.PI / 2 + Math.PI / Math.max(outer.length, 1));

  const neighbours = new Set<string>();
  if (hover) {
    neighbours.add(hover);
    for (const e of graph.edges) {
      if (e.source === hover) neighbours.add(e.target);
      if (e.target === hover) neighbours.add(e.source);
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
        {(["me", "student", "activity", "mentor", "group"] as Kind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <svg width="14" height="14" aria-hidden>
              <Shape kind={k} x={7} y={7} r={k === "me" ? 4 : 5} />
            </svg>
            {k === "group" ? "Group / branch" : KIND_STYLE[k].label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Your network graph">
        {graph.edges.map((e, i) => {
          const a = pos.get(e.source);
          const b = pos.get(e.target);
          if (!a || !b) return null;
          const lit = !hover || (neighbours.has(e.source) && neighbours.has(e.target));
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--text-3)"
              strokeOpacity={lit ? 0.55 : 0.12}
              strokeWidth={e.type === "CONNECTED_TO" ? 2 : 1.25}
              strokeDasharray={e.type === "MENTORED_BY" ? "4 3" : undefined}
            >
              <title>{e.type}</title>
            </line>
          );
        })}
        {graph.nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const dim = hover && !neighbours.has(n.id);
          const below = p.y >= cy;
          return (
            <g
              key={n.id}
              opacity={dim ? 0.3 : 1}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              className="cursor-default"
            >
              <circle cx={p.x} cy={p.y} r={18} fill="transparent" />
              <Shape kind={n.kind} x={p.x} y={p.y} r={8} />
              <text
                x={p.x}
                y={below ? p.y + 22 : p.y - 14}
                textAnchor="middle"
                fontSize={n.kind === "me" ? 13 : 11}
                fontWeight={n.kind === "me" ? 600 : 400}
                fill="var(--text)"
              >
                {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
              </text>
              <title>{`${KIND_STYLE[n.kind].label}: ${n.label}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
