import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { overview } from "@/lib/services/stats";

export const GET = handle(async (req) => {
  await requireUser(req, "admin");
  return json(await overview());
});
