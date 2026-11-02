# Campus Bootstrap — web app

Next.js 16 frontend and Route Handler API for the Campus Bootstrap project. Setup, environment variables and scripts are documented in the [repository README](../README.md); the design is described in [docs/PROJECT_REPORT.md](../docs/PROJECT_REPORT.md).

```
src/
  proxy.ts                 Session check, role redirects, cross-site write rejection
  app/login                Sign-in page
  app/(app)/admin/...      Admin dashboard pages
  app/(app)/mentor         Mentor dashboard
  app/(app)/student        Student dashboard
  app/(app)/matchmaking    Graph-based matchmaking (all roles)
  app/(app)/account        Password change
  app/api/...              Route Handlers (JSON API)
  components/              UI kit, charts, graph view, shared staff panels
  lib/
    env.ts                 Environment validation
    mysql.ts, neo4j.ts     Database clients
    api.ts                 Error mapping and request parsing
    validation.ts          zod schemas
    auth/                  Sessions, guards, login rate limit
    services/              SQL and Cypher queries, graph sync
scripts/                   graph sync, connection check, password hash, screenshots
tests/                     unit, integration (MySQL + Neo4j), e2e (HTTP)
```
