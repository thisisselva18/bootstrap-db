import { z } from "zod";
import { handle, json, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { listActivities, searchActivities } from "@/lib/services/catalog";

const q = z.object({ q: z.string().trim().max(100).optional(), mine: z.enum(["1"]).optional() });

// Everyone signed in may read activities; mentors can ask for just their own.
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { q: terms, mine } = parseQuery(req, q);
  if (terms) return json({ results: await searchActivities(terms) });
  const mentorId = mine && user.role === "mentor" ? (user.mId ?? -1) : undefined;
  return json({ activities: await listActivities(mentorId) });
});
