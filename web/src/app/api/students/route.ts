import { handle, json, parseBody, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { refreshStudentAfterResponse } from "@/lib/graph-refresh";
import { listStudents, registerStudent } from "@/lib/services/students";
import { studentCreateSchema, studentListQuery } from "@/lib/validation";

export const GET = handle(async (req) => {
  await requireUser(req, "admin", "mentor");
  const filters = parseQuery(req, studentListQuery);
  return json({ students: await listStudents(filters) });
});

export const POST = handle(async (req) => {
  await requireUser(req, "admin");
  const input = await parseBody(req, studentCreateSchema);
  const sId = await registerStudent(input);
  refreshStudentAfterResponse(sId);
  return json({ s_id: sId }, 201);
});
