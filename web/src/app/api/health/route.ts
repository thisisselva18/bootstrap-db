import { json } from "@/lib/api";
import { pingMysql } from "@/lib/mysql";
import { pingNeo4j } from "@/lib/neo4j";

// Public liveness check: reports only whether each database answers.
export async function GET() {
  const [mysql, neo4j] = await Promise.all([pingMysql(), pingNeo4j()]);
  return json({ mysql, neo4j }, mysql ? 200 : 503);
}
