import { handle, json, parseQuery } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { ratingDistribution, searchFeedback } from "@/lib/services/operations";
import { feedbackSearchQuery } from "@/lib/validation";

// Staff feedback review. Mentors only ever see their own activities.
export const GET = handle(async (req) => {
  const user = await requireUser(req, "admin", "mentor");
  const filters = parseQuery(req, feedbackSearchQuery);
  const mentorId = user.role === "mentor" ? (user.mId ?? -1) : undefined;
  const [feedback, distribution] = await Promise.all([
    searchFeedback({ ...filters, mentorId }),
    ratingDistribution(mentorId),
  ]);
  return json({ feedback, distribution });
});
