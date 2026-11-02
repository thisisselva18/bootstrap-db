import { handle, json, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { auditLog } from "@/lib/services/operations";
import { auditQuery } from "@/lib/validation";

export const GET = handle(async (req) => {
  await requireUser(req, "admin");
  return json({ entries: await auditLog(parseQuery(req, auditQuery)) });
});
