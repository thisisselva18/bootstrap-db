import { handle, json, parseBody, parseQuery } from "@/lib/api";
import { requireUser, resolveStudentId } from "@/lib/auth/guard";
import { connect, disconnect, listConnections } from "@/lib/services/graph";
import { connectSchema, studentRef } from "@/lib/validation";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const { studentId } = parseQuery(req, studentRef);
  return json({ connections: await listConnections(resolveStudentId(user, studentId)) });
});

// Only students create or remove their own connections.
export const POST = handle(async (req) => {
  const user = await requireUser(req, "student");
  const { peerId } = await parseBody(req, connectSchema);
  await connect(resolveStudentId(user), peerId);
  return json({ ok: true }, 201);
});

export const DELETE = handle(async (req) => {
  const user = await requireUser(req, "student");
  const { peerId } = parseQuery(req, connectSchema);
  await disconnect(resolveStudentId(user), peerId);
  return json({ ok: true });
});
