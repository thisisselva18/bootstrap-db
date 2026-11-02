import { handle, idParam, json, parseBody } from "@/lib/api";
import { requireUser, resolveStudentId } from "@/lib/auth/guard";
import { refreshStudentAfterResponse } from "@/lib/graph-refresh";
import { deleteStudent, getStudent, updateStudent } from "@/lib/services/students";
import { studentUpdateSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const id = resolveStudentId(user, idParam((await params).id));
  return json({ student: await getStudent(id) });
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  await requireUser(req, "admin");
  const id = idParam((await params).id);
  await updateStudent(id, await parseBody(req, studentUpdateSchema));
  refreshStudentAfterResponse(id);
  return json({ student: await getStudent(id) });
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  await requireUser(req, "admin");
  const id = idParam((await params).id);
  await deleteStudent(id);
  refreshStudentAfterResponse(id);
  return json({ ok: true });
});
