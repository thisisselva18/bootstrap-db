import { handle, json, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { shortestPath } from "@/lib/services/graph";
import { pathQuery } from "@/lib/validation";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { from, to } = parseQuery(req, pathQuery);
  // A student may only search paths that start from themselves.
  const start = user.role === "student" ? (user.sId ?? -1) : from;
  return json({ path: await shortestPath(start, to) });
});
