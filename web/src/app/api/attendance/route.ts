import { handle, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { refreshStudentAfterResponse } from "@/lib/graph-refresh";
import { assertMentorOwnsActivity } from "@/lib/services/catalog";
import { applyAttendance } from "@/lib/services/operations";
import { attendanceActionSchema } from "@/lib/validation";

export const POST = handle(async (req) => {
  const user = await requireUser(req, "admin", "mentor");
  const body = await parseBody(req, attendanceActionSchema);
  if (user.role === "mentor") await assertMentorOwnsActivity(user.mId ?? -1, body.activityId);
  const record = await applyAttendance(user.email, body.studentId, body.activityId, body.action, body.time);
  refreshStudentAfterResponse(body.studentId);
  return json({ record });
});
