# Campus Bootstrap — Matchmaking & Student Statistics

A web application for a five-day campus bootstrap programme: five colour groups rotate through five activities (a 5 × 5 Latin square), mentors record attendance, students rate sessions, and a relationship graph matches students with teammates, activities and mentors.

**Stack:** MySQL 8 (records, rules, statistics) · Neo4j 5 / 2025+ (relationship graph, recommendations) · Next.js 16 (UI and Route Handler API) · `mysql2` · `neo4j-driver`

**Team:** PES2UG24CS451 and PES2UG24CS456

| Role | What they can do |
|---|---|
| **Admin** | Manage students, mentors, activities, groups and the rotation; record attendance for any activity; see programme statistics, the risk report, the audit log and all feedback; rebuild the graph |
| **Mentor** | See their own activities; check students in and out; excuse or mark absences; review and full-text search feedback on their activities; see which students the graph links to them |
| **Student** | See their timetable, attendance and rank; rate attended sessions; declare interests; get teammate, activity and mentor recommendations; connect with peers |

The full write-up (problem statement, ER diagram, data dictionary, graph model, queries, architecture, security, testing) is in [docs/PROJECT_REPORT.md](docs/PROJECT_REPORT.md). Screenshots are in [docs/screenshots](docs/screenshots).

---

## Repository layout

```
Campus_Bootstrap_Mini_Project.sql   Base MySQL script: schema, seed data, routines, views, demo queries
sql/
  02_app_extensions.sql             AppUser table, extra triggers/views, sp_register_student
  03_seed_accounts.sql              Demo logins (bcrypt hashes only)
  04_app_db_user.sql                Least-privilege MySQL account for the app
neo4j/
  01_schema.cypher                  Graph constraints and indexes
  02_queries.cypher                 Key Cypher queries (also used by the app)
web/                                Next.js application
  src/app/(app)/…                   Admin, mentor, student and matchmaking pages
  src/app/api/…                     Route Handlers (the backend API)
  src/lib/                          DB clients, auth, validation, services
  scripts/                          Graph sync, connection check, screenshots
  tests/                            Unit, integration and end-to-end tests
docs/                               Report, demo script, screenshots, test results
```

---

## Setup

### 1. Prerequisites

- **MySQL 8.0.16+** (CHECK constraints are enforced from 8.0.16)
- **Neo4j 5.x or 2025+** — Neo4j Desktop is fine
- **Node.js 20.11+** (tested on Node 24)

### 2. MySQL

Run the scripts in this order, as `root` (or another account allowed to create routines and triggers). **The first script drops and recreates `bootstrap_db`**, so back up an existing copy first:

```bash
mysqldump -u root -p bootstrap_db > backup_bootstrap_db.sql        # only if it already exists

mysql -u root -p < Campus_Bootstrap_Mini_Project.sql
mysql -u root -p < sql/02_app_extensions.sql
mysql -u root -p < sql/03_seed_accounts.sql
```

If binary logging is enabled and creating functions fails, run `SET GLOBAL log_bin_trust_function_creators = 1;` first.

Optional but recommended: create the least-privilege app account. Edit the password in `sql/04_app_db_user.sql`, then run it:

```bash
mysql -u root -p < sql/04_app_db_user.sql
```

### 3. Neo4j

Create and start a local DBMS in Neo4j Desktop (or any Neo4j 5+ server) and note its bolt URL (normally `bolt://localhost:7687`) and password. The graph is filled from MySQL in step 5; constraints are created automatically.

### 4. Configure and install the web app

```bash
cd web
cp .env.example .env.local      # Windows: copy .env.example .env.local
npm install
```

Edit `web/.env.local`:

```ini
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=bootstrap_app          # or root
MYSQL_PASSWORD=...
MYSQL_DATABASE=bootstrap_db
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=...
NEO4J_DATABASE=neo4j
AUTH_SECRET=...                   # node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

`.env.local` is git-ignored. Nothing secret lives in the source code.

### 5. Check connections and build the graph

```bash
npm run db:check           # verifies both databases and the schema objects
npm run graph:sync:demo    # copies MySQL into Neo4j and seeds demo connections/interests
```

Use `npm run graph:sync` (without `:demo`) for later rebuilds; it never deletes connections or declared interests. Admins can also rebuild from **Graph → Sync from MySQL**.

### 6. Run

```bash
npm run dev                      # development, http://localhost:3000
# or
npm run build && npm start       # production
```

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Admin | `admin@univ.edu` | `Admin@123` |
| Mentor | any mentor email, e.g. `priya.iyer@univ.edu` | `Mentor@123` |
| Student | any student email, e.g. `aarav.sharma@univ.edu` | `Student@123` |

These are for the demonstration only. Change them on the **Account** page, or generate a hash with `npm run hash-password -- "NewPass123"`.

---

## Tests

```bash
cd web
npm test                                   # unit tests (no database needed)
npm run test:db                            # MySQL + Neo4j integration tests
APP_URL=http://localhost:3000 npm run test:e2e   # HTTP tests against the running app
npm run test:all                           # everything
```

Integration and end-to-end tests run against the databases in `.env.local` and clean up after themselves. The latest run (92 tests, all passing) is in [docs/test-results.txt](docs/test-results.txt).

Other checks: `npm run typecheck`, `npm run lint`, and `npm run screenshots` (needs Microsoft Edge or Chrome; saves to `docs/screenshots`).

---

## npm scripts (in `web/`)

| Script | Purpose |
|---|---|
| `dev` / `build` / `start` | Run the Next.js app |
| `db:check` | Test MySQL and Neo4j connectivity and list schema objects |
| `graph:sync` | Rebuild the derived graph from MySQL |
| `graph:sync:demo` | Same, plus deterministic demo connections and interests |
| `hash-password` | Print a bcrypt hash for a password |
| `test`, `test:db`, `test:e2e`, `test:all` | Test suites |
| `screenshots` | Capture every dashboard to `docs/screenshots` |
| `typecheck`, `lint` | Static checks |
