"use client";

import { useState } from "react";
import { Button, Card, DAY_NAMES, ErrorNote, Field, GroupTag, Loading, Modal, Notice, PageHeader, time } from "@/components/ui";
import { apiSend, useApi } from "@/components/use-api";
import type { TimetableSlot } from "@/lib/types";

export default function ScheduleAdmin() {
  const sched = useApi<{ slots: TimetableSlot[] }>("/api/schedule");
  const [edit, setEdit] = useState<TimetableSlot | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [gen, setGen] = useState({ startTime: "09:00", endTime: "16:30" });
  const [busy, setBusy] = useState(false);

  const slots = sched.data?.slots ?? [];
  const groups = [...new Map(slots.map((s) => [s.g_id, s.g_name])).entries()].sort((a, b) => a[0] - b[0]);
  const days = [1, 2, 3, 4, 5];
  const at = (day: number, g: number) => slots.find((s) => s.day === day && s.g_id === g);

  async function regenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm("Regenerate the whole 5 × 5 rotation? This replaces every slot.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiSend<{ message: string }>("POST", "/api/schedule/generate", gen);
      setMsg({ kind: "success", text: res.message });
      sched.reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle="Latin-square rotation: activity = ((group − 1 + day − 1) mod 5) + 1. UNIQUE keys stop double-booking a group or an activity; triggers stop double-booking a room."
      />
      {msg && (
        <div className="mb-4">
          <Notice kind={msg.kind}>{msg.text}</Notice>
        </div>
      )}
      <Card title="Rotation grid" subtitle="Select a slot to change its room or times" pad={false}>
        {sched.loading && !sched.data ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : sched.error ? (
          <div className="p-4">
            <ErrorNote message={sched.error} onRetry={sched.reload} />
          </div>
        ) : (
          <div className="overflow-x-auto p-4">
            <table className="w-full min-w-[760px] border-separate border-spacing-1 text-sm">
              <thead>
                <tr>
                  <th className="w-24 text-left text-xs font-medium text-ink-3">Group</th>
                  {days.map((d) => (
                    <th key={d} className="text-left text-xs font-medium text-ink-3">
                      {DAY_NAMES[d]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(([gid, gname]) => (
                  <tr key={gid}>
                    <td className="pr-2">
                      <GroupTag name={gname} />
                    </td>
                    {days.map((d) => {
                      const s = at(d, gid);
                      return (
                        <td key={d}>
                          {s ? (
                            <button
                              onClick={() => setEdit(s)}
                              className="w-full rounded-lg border border-line bg-surface-2 p-2 text-left hover:border-accent"
                            >
                              <div className="font-medium leading-tight">{s.a_name}</div>
                              <div className="mt-1 text-xs text-ink-3">
                                {s.room ?? "No room"} · <span className="tabular">{time(s.start_time)}–{time(s.end_time)}</span>
                              </div>
                              <div className="text-xs text-ink-3">{s.mentor ?? "No mentor"}</div>
                            </button>
                          ) : (
                            <div className="rounded-lg border border-dashed border-line p-2 text-xs text-ink-3">Empty</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-6">
        <Card
          title="Regenerate rotation"
          subtitle="Calls sp_generate_rotation. It refuses while attendance rows exist, so it only works before the programme starts."
        >
          <form onSubmit={regenerate} className="flex flex-wrap items-end gap-3">
            <Field label="Start">
              <input className="input" type="time" required value={gen.startTime} onChange={(e) => setGen((g) => ({ ...g, startTime: e.target.value }))} />
            </Field>
            <Field label="End">
              <input className="input" type="time" required value={gen.endTime} onChange={(e) => setGen((g) => ({ ...g, endTime: e.target.value }))} />
            </Field>
            <Button type="submit" busy={busy}>
              Regenerate
            </Button>
          </form>
        </Card>
      </div>

      <Modal open={!!edit} title={edit ? `${edit.g_name} · ${DAY_NAMES[edit.day]} · ${edit.a_name}` : ""} onClose={() => setEdit(null)}>
        {edit && (
          <SlotForm
            s={edit}
            onDone={(t) => {
              setEdit(null);
              setMsg({ kind: "success", text: t });
              sched.reload();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function SlotForm({ s, onDone }: { s: TimetableSlot; onDone: (t: string) => void }) {
  const [f, setF] = useState({ room: s.room ?? "", startTime: time(s.start_time), endTime: time(s.end_time) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await apiSend("PATCH", `/api/schedule/${s.schedule_id}`, { room: f.room || null, startTime: f.startTime, endTime: f.endTime });
          onDone("Slot updated");
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <Field label="Room" hint="Another group cannot use the same room on the same day">
        <input className="input" maxLength={20} value={f.room} onChange={(e) => setF((x) => ({ ...x, room: e.target.value }))} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start">
          <input className="input" type="time" required value={f.startTime} onChange={(e) => setF((x) => ({ ...x, startTime: e.target.value }))} />
        </Field>
        <Field label="End">
          <input className="input" type="time" required value={f.endTime} onChange={(e) => setF((x) => ({ ...x, endTime: e.target.value }))} />
        </Field>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" busy={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
