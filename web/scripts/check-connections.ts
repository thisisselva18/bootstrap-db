// Usage: npm run db:check — verifies both databases are reachable with the
// configured credentials and that the expected schema objects exist.
import "./load-env";
import { pool, query } from "../src/lib/mysql";
import { closeNeo4j, cypherRead } from "../src/lib/neo4j";

async function main() {
  let failed = false;
  try {
    const [v] = await query<{ v: string }>("SELECT VERSION() AS v");
    const objects = await query<{ kind: string; total: number }>(
      `SELECT 'tables' AS kind, COUNT(*) AS total FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
       UNION ALL SELECT 'views', COUNT(*) FROM information_schema.views WHERE table_schema = DATABASE()
       UNION ALL SELECT 'routines', COUNT(*) FROM information_schema.routines WHERE routine_schema = DATABASE()
       UNION ALL SELECT 'triggers', COUNT(*) FROM information_schema.triggers WHERE trigger_schema = DATABASE()
       UNION ALL SELECT 'accounts', COUNT(*) FROM AppUser`,
    );
    console.log(`MySQL  OK  (server ${v.v})`);
    console.table(objects);
  } catch (err) {
    failed = true;
    console.error("MySQL  FAILED:", (err as Error).message);
  }
  try {
    const [n] = await cypherRead<{ nodes: number }>("MATCH (n) RETURN count(n) AS nodes");
    console.log(`Neo4j  OK  (${n.nodes} nodes)`);
  } catch (err) {
    failed = true;
    console.error("Neo4j  FAILED:", (err as Error).message);
  }
  process.exitCode = failed ? 1 : 0;
}

main().finally(async () => {
  await closeNeo4j();
  await pool().end();
});
