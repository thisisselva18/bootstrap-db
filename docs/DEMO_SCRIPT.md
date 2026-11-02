# Demonstration script (≈ 15 minutes)

Ordered to match the evaluation checklist. Before starting:
- MySQL and Neo4j are running.
- `npm run graph:sync:demo` has been run.
- `npm run build && npm start` is serving the app.
- Have MySQL Workbench and Neo4j Browser open in other tabs.

| # | Evaluation item | What to show | Where |
|---|---|---|---|
| 1 | Problem and motivation | Five groups × five activities over five days. Coordinators can't see attendance while it happens, and students only meet their own group. | README, report §1 |
| 2 | ER diagram and design | Mermaid ER diagram; M:N Student–Activity resolved by Participates and Feedback; derived values not stored | Report §6 |
| 3 | Relational schema / dictionary | Keys, FK actions (CASCADE / RESTRICT / SET NULL), CHECK constraints | Report §6.2, §7 |
| 4 | Why two databases | Records and rules in MySQL; relationship questions in Neo4j | Report §5 |
| 5 | SQL implementation | Run Part 5 queries in Workbench; `EXPLAIN` shows `ix_student_group_branch` | `Campus_Bootstrap_Mini_Project.sql` |
| 6 | Admin dashboard | Overview: views, risk function, HAVING, subquery. MySQL and Neo4j status badges. | `/admin` |
| 7 | Stored procedure + transaction | Enrol a student (`sp_register_student`) → sign in as them in a private window → Transfer (`sp_transfer_student`) → Delete | `/admin/students` |
| 8 | Trigger: protect | Delete Aarav Sharma → *"Cannot delete a student with recorded attendance"* | `/admin/students` |
| 9 | Trigger: room clash | Schedule → set a slot's room to one already used that day → refused | `/admin/schedule` |
| 10 | Procedure guard | Regenerate rotation → refused while attendance exists | `/admin/schedule` |
| 11 | Mentor workflow | Sign in as `priya.iyer@univ.edu` → set a check-in 30 min after the start → status becomes **Late** (trigger) → Admin → Attendance → Audit log shows `priya.iyer@univ.edu` | `/mentor`, `/admin/attendance` |
| 12 | Full-text search | Feedback → `crowded lab` (natural); `+mentor -rushed` (boolean) | `/admin/feedback` |
| 13 | Student dashboard | Timetable with status per session, rank in group (window functions), rate a session | `/student` |
| 14 | Neo4j model | Graph page: node and relationship counts; Neo4j Browser: `neo4j/02_queries.cypher` G1–G3 | `/admin/graph` |
| 15 | Graph features | Matchmaking: reasons behind each score, switch the branch preference, Connect → the ego network updates, activities and mentors to explore, shortest path | `/matchmaking` |
| 16 | Integration | Rate an activity 5★ as a student → it appears as "rated ★4+" on Matchmaking and drops out of the activity suggestions (MySQL write → Neo4j refresh) | `/student` → `/matchmaking` |
| 17 | Security | Show the bcrypt hashes in AppUser; try `/admin` as a student (redirected); `.env.local` git-ignored; `sql/04_app_db_user.sql` | Workbench, browser |
| 18 | Testing | `npm run test:all` → 92 passing | Terminal, `docs/test-results.txt` |
| 19 | Contributions | Git history by member | `git log --format='%an %s'` |

## Accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@univ.edu | Admin@123 |
| Mentor | priya.iyer@univ.edu | Mentor@123 |
| Student | aarav.sharma@univ.edu | Student@123 |

## Resetting after the demo

```bash
mysql -u root -p < Campus_Bootstrap_Mini_Project.sql
mysql -u root -p < sql/02_app_extensions.sql
mysql -u root -p < sql/03_seed_accounts.sql
# In Neo4j Browser: MATCH (n) DETACH DELETE n
cd web && npm run graph:sync:demo
```
