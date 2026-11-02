import { after } from "next/server";
import { syncAll, syncStudentQuietly } from "./services/graph-sync";

// Keep Neo4j in step with MySQL after a successful write, without making the
// user wait for it. Call these only after the MySQL change has committed.

export function refreshStudentAfterResponse(studentId: number) {
  after(() => syncStudentQuietly(studentId));
}

export function refreshGraphAfterResponse() {
  after(async () => {
    try {
      await syncAll();
    } catch (err) {
      console.warn("[graph] full refresh failed:", (err as Error).message);
    }
  });
}
