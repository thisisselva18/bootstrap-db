import { handle, json, parseBody, parseQuery } from "@/lib/api";
import { requireUser, resolveStudentId } from "@/lib/auth/guard";
import { getInterests, setInterests } from "@/lib/services/graph";
import { interestsSchema, studentRef } from "@/lib/validation";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { studentId } = parseQuery(req, studentRef);
  return json({ interests: await getInterests(resolveStudentId(user, studentId)) });
});

export const PUT = handle(async (req) => {
  const user = await requireUser(req, "student");
  const { activityIds } = await parseBody(req, interestsSchema);
  return json({ interests: await setInterests(resolveStudentId(user), activityIds) });
});
