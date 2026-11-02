import { handle, idParam, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { refreshStudentAfterResponse } from "@/lib/graph-refresh";
import { transferStudent } from "@/lib/services/students";
import { transferSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  await requireUser(req, "admin");
  const id = idParam((await params).id);
  const { groupId } = await parseBody(req, transferSchema);
  const message = await transferStudent(id, groupId);
  refreshStudentAfterResponse(id);
  return json({ message });
});
