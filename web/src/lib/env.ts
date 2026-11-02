import { z } from "zod";

// All configuration comes from environment variables (.env.local in
// development). Nothing secret is hard-coded or exposed to the browser:
// none of these names start with NEXT_PUBLIC_.
const schema = z.object({
  MYSQL_HOST: z.string().min(1).default("127.0.0.1"),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().min(1),
  MYSQL_PASSWORD: z.string().default(""),
  MYSQL_DATABASE: z.string().min(1).default("bootstrap_db"),
  NEO4J_URI: z.string().min(1).default("bolt://localhost:7687"),
  NEO4J_USER: z.string().min(1).default("neo4j"),
  NEO4J_PASSWORD: z.string().default(""),
  NEO4J_DATABASE: z.string().min(1).default("neo4j"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      throw new Error(`Invalid environment configuration:\n  ${issues.join("\n  ")}`);
    }
    cached = parsed.data;
  }
  return cached;
}
