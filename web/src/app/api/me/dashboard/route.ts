import { handle, json } from "@/lib/api";
import { requireUser, resolveStudentId } from "@/lib/auth/guard";
import { studentDashboard } from "@/lib/services/students";

export const GET = handle(async (req) => {
  const user = await requireUser(req, "student");
  return json(await studentDashboard(resolveStudentId(user)));
});
