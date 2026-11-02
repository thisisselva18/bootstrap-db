import { z } from "zod";
import { handle, idParam, json, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { assertMentorOwnsActivity } from "@/lib/services/catalog";
import { roster } from "@/lib/services/operations";

type Ctx = { params: Promise<{ id: string }> };
const q = z.object({ groupId: z.coerce.number().int().positive().optional() });

export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(req, "admin", "mentor");
  const id = idParam((await params).id);
  if (user.role === "mentor") await assertMentorOwnsActivity(user.mId ?? -1, id);
  const { groupId } = parseQuery(req, q);
  return json({ roster: await roster(id, groupId) });
});
