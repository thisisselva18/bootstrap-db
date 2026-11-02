import { handle, json, parseQuery } from "@/lib/api";
import { requireUser, resolveStudentId } from "@/lib/auth/guard";
import { similarStudents } from "@/lib/services/graph";
import { recommendationQuery } from "@/lib/validation";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { studentId, limit } = parseQuery(req, recommendationQuery);
  return json({ similar: await similarStudents(resolveStudentId(user, studentId), limit) });
});
