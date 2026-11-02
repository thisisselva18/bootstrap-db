import { handle, idParam, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { groupReport } from "@/lib/services/catalog";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireUser(req, "admin", "mentor");
  return json({ report: await groupReport(idParam((await params).id)) });
});
