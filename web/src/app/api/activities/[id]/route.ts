import { handle, idParam, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { refreshGraphAfterResponse } from "@/lib/graph-refresh";
import { getActivity, updateActivity } from "@/lib/services/catalog";
import { activityUpdateSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireUser(req);
  return json({ activity: await getActivity(idParam((await params).id)) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  await requireUser(req, "admin");
  const id = idParam((await params).id);
  await updateActivity(id, await parseBody(req, activityUpdateSchema));
  refreshGraphAfterResponse();
  return json({ activity: await getActivity(id) });
});
