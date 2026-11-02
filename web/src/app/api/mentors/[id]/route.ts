import { handle, idParam, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { refreshGraphAfterResponse } from "@/lib/graph-refresh";
import { deleteMentor, updateMentor } from "@/lib/services/catalog";
import { mentorUpdateSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  await requireUser(req, "admin");
  await updateMentor(idParam((await params).id), await parseBody(req, mentorUpdateSchema));
  refreshGraphAfterResponse();
  return json({ ok: true });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  await requireUser(req, "admin");
  await deleteMentor(idParam((await params).id));
  refreshGraphAfterResponse();
  return json({ ok: true });
});
