import { handle, json, parseBody } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { changePassword } from "@/lib/services/auth";
import { passwordChangeSchema } from "@/lib/validation";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = await parseBody(req, passwordChangeSchema);
  await changePassword(user.uid, body.currentPassword, body.newPassword);
  return json({ ok: true });
});
