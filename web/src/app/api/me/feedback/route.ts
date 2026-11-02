import { handle, json, parseBody } from "@/lib/api";
import { requireUser, resolveStudentId } from "@/lib/auth/guard";
import { refreshStudentAfterResponse } from "@/lib/graph-refresh";
import { submitFeedback } from "@/lib/services/students";
import { feedbackSubmitSchema } from "@/lib/validation";

// The student id always comes from the session, never from the request body.
export const POST = handle(async (req) => {
  const user = await requireUser(req, "student");
  const sId = resolveStudentId(user);
  const { activityId, rating, comments } = await parseBody(req, feedbackSubmitSchema);
  await submitFeedback(sId, activityId, rating, comments);
  refreshStudentAfterResponse(sId);
  return json({ ok: true }, 201);
});
