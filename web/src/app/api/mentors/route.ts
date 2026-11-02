import { handle, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { refreshGraphAfterResponse } from "@/lib/graph-refresh";
import { createMentor, listMentors } from "@/lib/services/catalog";
import { mentorCreateSchema } from "@/lib/validation";

export const GET = handle(async (req) => {
  await requireUser(req, "admin");
  return json({ mentors: await listMentors() });
});

export const POST = handle(async (req) => {
  await requireUser(req, "admin");
  const mId = await createMentor(await parseBody(req, mentorCreateSchema));
  refreshGraphAfterResponse();
  return json({ m_id: mId }, 201);
});
