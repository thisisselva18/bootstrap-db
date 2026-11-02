import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { listGroups } from "@/lib/services/catalog";

export const GET = handle(async (req) => {
  await requireUser(req, "admin", "mentor");
  return json({ groups: await listGroups() });
});
