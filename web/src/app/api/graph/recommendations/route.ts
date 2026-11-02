import { handle, json, parseQuery } from "@/lib/api";
import { requireUser, resolveStudentId } from "@/lib/auth/guard";
import { activityRecommendations, mentorRecommendations, peerRecommendations } from "@/lib/services/graph";
import { recommendationQuery } from "@/lib/validation";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { studentId, prefer, limit } = parseQuery(req, recommendationQuery);
  const sId = resolveStudentId(user, studentId);
  const [peers, activities, mentors] = await Promise.all([
    peerRecommendations(sId, prefer, limit),
    activityRecommendations(sId, 5),
    mentorRecommendations(sId),
  ]);
  return json({ peers, activities, mentors });
});
