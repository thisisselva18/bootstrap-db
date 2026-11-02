// Usage: npm run graph:sync            (rebuild graph from MySQL)
//        npm run graph:sync:demo       (also seed demo connections/interests)
import "./load-env";
import { pool } from "../src/lib/mysql";
import { closeNeo4j } from "../src/lib/neo4j";
import { graphCounts, seedDemoGraph, syncAll } from "../src/lib/services/graph-sync";

async function main() {
  const started = Date.now();
  console.log("Syncing MySQL -> Neo4j ...");
  await syncAll();
  if (process.argv.includes("--seed-demo")) {
    const seeded = await seedDemoGraph();
    console.log(`Seeded ${seeded.declaredInterests} declared interests, ${seeded.connectionPairs} connection pairs`);
  }
  const counts = await graphCounts();
  console.table(counts.nodes);
  console.table(counts.relationships);
  console.log(`Done in ${Date.now() - started} ms`);
}

main()
  .catch((err) => {
    console.error("Graph sync failed:", err.message ?? err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeNeo4j();
    await pool().end();
  });
