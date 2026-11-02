import { handle, idParam, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { refreshGraphAfterResponse } from "@/lib/graph-refresh";
import { assertMentorOwnsActivity } from "@/lib/services/catalog";
import { excuseAbsentees } from "@/lib/services/operations";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(req, "admin", "mentor");
  const id = idParam((await params).id);
  if (user.role === "mentor") await assertMentorOwnsActivity(user.mId ?? -1, id);
  const excused = await excuseAbsentees(user.email, id);
  if (excused > 0) refreshGraphAfterResponse();
  return json({ excused });
});
