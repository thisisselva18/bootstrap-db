import neo4j, { type Driver } from "neo4j-driver";
import { env } from "./env";

const globalForNeo4j = globalThis as unknown as { __bootstrapNeo4j?: Driver };

export function driver(): Driver {
  if (!globalForNeo4j.__bootstrapNeo4j) {
    const e = env();
    globalForNeo4j.__bootstrapNeo4j = neo4j.driver(
      e.NEO4J_URI,
      neo4j.auth.basic(e.NEO4J_USER, e.NEO4J_PASSWORD),
      {
        // Integers come back as JS numbers; every id in this graph is small.
        disableLosslessIntegers: true,
        connectionAcquisitionTimeout: 5000,
        connectionTimeout: 5000,
        maxConnectionPoolSize: 20,
      },
    );
  }
  return globalForNeo4j.__bootstrapNeo4j;
}

/** Raised when Neo4j cannot be reached; the API turns it into a 503. */
export class GraphUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("The graph database (Neo4j) is not reachable right now");
    this.name = "GraphUnavailableError";
    this.cause = cause;
  }
}

function isConnectivityError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  return (
    code === "ServiceUnavailable" ||
    code === "SessionExpired" ||
    code.startsWith("Neo.ClientError.Security") ||
    /ECONNREFUSED|ENOTFOUND|Could not perform discovery|Failed to connect/i.test(String((err as Error)?.message))
  );
}

type Rows<T> = T[];

async function run<T>(cypher: string, params: Record<string, unknown>, mode: "READ" | "WRITE"): Promise<Rows<T>> {
  try {
    const { records } = await driver().executeQuery(cypher, params, {
      database: env().NEO4J_DATABASE,
      routing: mode === "READ" ? neo4j.routing.READ : neo4j.routing.WRITE,
    });
    return records.map((r) => r.toObject() as T);
  } catch (err) {
    if (isConnectivityError(err)) throw new GraphUnavailableError(err);
    throw err;
  }
}

/** Parameterized Cypher read; values are always passed as $params. */
export function cypherRead<T = Record<string, unknown>>(cypher: string, params: Record<string, unknown> = {}) {
  return run<T>(cypher, params, "READ");
}

export function cypherWrite<T = Record<string, unknown>>(cypher: string, params: Record<string, unknown> = {}) {
  return run<T>(cypher, params, "WRITE");
}

export async function pingNeo4j(): Promise<boolean> {
  try {
    await driver().verifyConnectivity({ database: env().NEO4J_DATABASE });
    return true;
  } catch {
    return false;
  }
}

export async function closeNeo4j() {
  await globalForNeo4j.__bootstrapNeo4j?.close();
  globalForNeo4j.__bootstrapNeo4j = undefined;
}
