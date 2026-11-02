import { handle, json, parseQuery } from "@/lib/api";
import { requireUser, resolveStudentId } from "@/lib/auth/guard";
import { egoGraph } from "@/lib/services/graph";
import { studentRef } from "@/lib/validation";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { studentId } = parseQuery(req, studentRef);
  return json(await egoGraph(resolveStudentId(user, studentId)));
});
