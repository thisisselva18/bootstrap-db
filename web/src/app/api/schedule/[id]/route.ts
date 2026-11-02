import { handle, idParam, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { updateSlot } from "@/lib/services/operations";
import { scheduleUpdateSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  await requireUser(req, "admin");
  await updateSlot(idParam((await params).id), await parseBody(req, scheduleUpdateSchema));
  return json({ ok: true });
});
