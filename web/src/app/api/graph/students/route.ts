import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { graphStudents } from "@/lib/services/graph";

export const GET = handle(async (req) => {
  await requireUser(req);
  return json({ students: await graphStudents() });
});
