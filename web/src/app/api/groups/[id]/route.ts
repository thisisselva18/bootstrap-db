import { handle, idParam, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { refreshGraphAfterResponse } from "@/lib/graph-refresh";
import { renameGroup } from "@/lib/services/catalog";
import { groupUpdateSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  await requireUser(req, "admin");
  const id = idParam((await params).id);
  const { name } = await parseBody(req, groupUpdateSchema);
  await renameGroup(id, name);
  refreshGraphAfterResponse();
  return json({ ok: true });
});
