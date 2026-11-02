"use client";

import { useState, type ReactNode } from "react";

// Small hand-built charts. One series per bar chart (single hue, no legend
// needed: the card title names it); the rating chart is an ordinal ramp
// with a legend. Every mark has a hover tooltip, values sit in text ink.

type Tip = { x: number; y: number; content: ReactNode } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: tip.x + 12, top: tip.y + 12 }}
    >
      {tip.content}
    </div>
  );
}

export type BarDatum = { label: ReactNode; value: number | null; detail?: ReactNode; key: string | number };

/** Horizontal bar list on a fixed 0..max scale (default 100 for percentages). */
export function BarList({ data, max = 100, format = (v) => `${v.toFixed(1)}%` }: {
  data: BarDatum[];
  max?: number;
  format?: (v: number) => string;
}) {
  const [tip, setTip] = useState<Tip>(null);
  return (
    <div className="space-y-2.5">
      {data.map((d) => {
        const v = d.value ?? 0;
        const w = Math.max(0, Math.min(100, (v / max) * 100));
        return (
          <div
            key={d.key}
            className="group grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr_auto]"
            onMouseMove={(e) =>
              setTip({
                x: e.clientX,
                y: e.clientY,
                content: (
                  <div>
                    <div className="font-medium">{d.label}</div>
                    <div className="tabular text-ink-2">{d.value == null ? "No data" : format(v)}</div>
                    {d.detail && <div className="text-ink-3">{d.detail}</div>}
                  </div>
                ),
              })
            }
            onMouseLeave={() => setTip(null)}
          >
            <div className="truncate text-ink-2">{d.label}</div>
            <div className="h-2.5 rounded-full" style={{ background: "var(--track)" }}>
              <div
                className="h-2.5 rounded-full transition-opacity group-hover:opacity-80"
                style={{ width: `${w}%`, background: "var(--series-1)" }}
              />
            </div>
            <div className="tabular w-14 text-right text-ink">{d.value == null ? "—" : format(v)}</div>
          </div>
        );
      })}
      <Tooltip tip={tip} />
    </div>
  );
}

const RATING_COLORS = ["var(--ramp-1)", "var(--ramp-2)", "var(--ramp-3)", "var(--ramp-4)", "var(--ramp-5)"];

/** 100%-stacked bars of ratings 1..5 per activity (ordinal blue ramp). */
export function RatingStacks({ rows }: { rows: Array<{ a_id: number; a_name: string; rating: number; votes: number }> }) {
  const [tip, setTip] = useState<Tip>(null);
  const byActivity = new Map<number, { name: string; counts: number[] }>();
  for (const r of rows) {
    const entry = byActivity.get(r.a_id) ?? { name: r.a_name, counts: [0, 0, 0, 0, 0] };
    entry.counts[r.rating - 1] = r.votes;
    byActivity.set(r.a_id, entry);
  }
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-ink-2" aria-label="Legend">
        {RATING_COLORS.map((c, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
            {i + 1}★
          </span>
        ))}
      </div>
      <div className="space-y-2.5">
        {[...byActivity.entries()].map(([id, { name, counts }]) => {
          const total = counts.reduce((a, b) => a + b, 0);
          const avg = total ? counts.reduce((a, c, i) => a + c * (i + 1), 0) / total : 0;
          return (
            <div key={id} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
              <div className="truncate text-ink-2">{name}</div>
              <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
                {counts.map((c, i) =>
                  c === 0 ? null : (
                    <div
                      key={i}
                      style={{ width: `${(c / total) * 100}%`, background: RATING_COLORS[i] }}
                      onMouseMove={(e) =>
                        setTip({
                          x: e.clientX,
                          y: e.clientY,
                          content: (
                            <div>
                              <div className="font-medium">{name}</div>
                              <div className="tabular text-ink-2">
                                {i + 1}★ — {c} response{c > 1 ? "s" : ""} ({Math.round((c / total) * 100)}%)
                              </div>
                            </div>
                          ),
                        })
                      }
                      onMouseLeave={() => setTip(null)}
                    />
                  ),
                )}
              </div>
              <div className="tabular w-20 text-right text-xs text-ink-2">
                avg {avg.toFixed(2)} · n={total}
              </div>
            </div>
          );
        })}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

/** Thin progress meter for a single percentage. */
export function Meter({ value, label }: { value: number | null; label: string }) {
  const w = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-ink-2">
        <span>{label}</span>
        <span className="tabular text-ink">{value == null ? "—" : `${value.toFixed(1)}%`}</span>
      </div>
      <div className="h-2 rounded-full" style={{ background: "var(--track)" }} role="meter" aria-valuenow={w} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-2 rounded-full" style={{ width: `${w}%`, background: "var(--series-1)" }} />
      </div>
    </div>
  );
}
