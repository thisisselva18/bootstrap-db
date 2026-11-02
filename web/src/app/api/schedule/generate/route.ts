import { handle, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { generateRotation } from "@/lib/services/operations";
import { generateRotationSchema } from "@/lib/validation";

// sp_generate_rotation refuses (409) once attendance rows exist.
export const POST = handle(async (req) => {
  await requireUser(req, "admin");
  const { startTime, endTime } = await parseBody(req, generateRotationSchema);
  return json({ message: await generateRotation(startTime, endTime) });
});
