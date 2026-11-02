import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";

export const GET = handle(async (req) => json({ user: await requireUser(req) }));
