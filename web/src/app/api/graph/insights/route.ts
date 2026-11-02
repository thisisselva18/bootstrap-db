import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { insights } from "@/lib/services/graph";

export const GET = handle(async (req) => {
  const user = await requireUser(req, "admin", "mentor");
  return json(await insights(user.role === "mentor" ? (user.mId ?? undefined) : undefined));
});
