import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { timetable } from "@/lib/services/operations";

export const GET = handle(async (req) => {
  await requireUser(req);
  return json({ slots: await timetable() });
});
