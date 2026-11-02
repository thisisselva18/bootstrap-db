import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { graphCounts, syncAll } from "@/lib/services/graph-sync";

export const GET = handle(async (req) => {
  await requireUser(req, "admin");
  return json(await graphCounts());
});

// Full MySQL -> Neo4j rebuild of the derived graph.
export const POST = handle(async (req) => {
  await requireUser(req, "admin");
  const started = Date.now();
  const counts = await syncAll();
  return json({ ...counts, ms: Date.now() - started });
});
