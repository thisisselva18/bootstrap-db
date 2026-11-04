import neo4j from "neo4j-driver";
import { query } from "../mysql";
import { cypherRead, cypherWrite } from "../neo4j";

/*
 * MySQL -> Neo4j synchronisation.
 *
 * MySQL stays the source of truth for records. Neo4j receives the entities
 * as nodes keyed by their MySQL primary keys (s_id, g_id, a_id, m_id) and the
 * relationships that are derived from MySQL rows:
 *
 *   (Student)-[:BELONGS_TO]->(BootstrapGroup)      Student.g_id
 *   (Student)-[:STUDIES]->(Branch)                 Student.branch
 *   (Activity)-[:MENTORED_BY]->(Mentor)            Activity.m_id
 *   (Student)-[:PARTICIPATED_IN {status,...}]->(Activity)   Participates
 *   (Student)-[:RATED {rating}]->(Activity)        Feedback
 *   (Student)-[:INTERESTED_IN {source:'rating'}]->(Activity)  Feedback.rating >= 4
 *
 * Derived relationships are rebuilt on every sync. Graph-native data that
 * has no MySQL table is never touched by the sync:
 *
 *   (Student)-[:CONNECTED_TO {since}]->(Student)   peer connections
 *   (Student)-[:INTERESTED_IN {source:'declared'}]->(Activity)  self-declared
 */

export const INTEREST_RATING_THRESHOLD = 4;

export const CONSTRAINTS = [
  "CREATE CONSTRAINT student_id IF NOT EXISTS FOR (n:Student) REQUIRE n.s_id IS UNIQUE",
  "CREATE CONSTRAINT group_id IF NOT EXISTS FOR (n:BootstrapGroup) REQUIRE n.g_id IS UNIQUE",
  "CREATE CONSTRAINT activity_id IF NOT EXISTS FOR (n:Activity) REQUIRE n.a_id IS UNIQUE",
  "CREATE CONSTRAINT mentor_id IF NOT EXISTS FOR (n:Mentor) REQUIRE n.m_id IS UNIQUE",
  "CREATE CONSTRAINT branch_name IF NOT EXISTS FOR (n:Branch) REQUIRE n.name IS UNIQUE",
  "CREATE INDEX student_usn IF NOT EXISTS FOR (n:Student) ON (n.usn)",
  "CREATE INDEX interest_source IF NOT EXISTS FOR ()-[r:INTERESTED_IN]-() ON (r.source)",
];

export async function ensureConstraints() {
  for (const c of CONSTRAINTS) await cypherWrite(c);
}

type SourceData = Awaited<ReturnType<typeof loadFromMysql>>;

async function loadFromMysql(studentId?: number) {
  const sFilter = studentId ? "WHERE s.s_id = ?" : "";
  const pFilter = studentId ? "WHERE p.s_id = ?" : "";
  const fFilter = studentId ? "WHERE f.s_id = ?" : "";
  const sp = studentId ? [studentId] : [];
  const [groups, mentors, activities, students, participation, ratings] = await Promise.all([
    query<{ g_id: number; name: string }>("SELECT g_id, g_name AS name FROM bootstrap_group"),
    query<{ m_id: number; name: string; dept: string | null; designation: string | null }>(
      "SELECT m_id, m_name AS name, dept, designation FROM Mentor",
    ),
    query<{ a_id: number; name: string; capacity: number; m_id: number | null }>(
      "SELECT a_id, a_name AS name, capacity, m_id FROM Activity",
    ),
    query<{ s_id: number; usn: string; name: string; branch: string | null; semester: number; g_id: number }>(
      `SELECT s.s_id, s.s_usn AS usn, s.s_name AS name, s.branch, s.semester, s.g_id FROM Student s ${sFilter}`,
      sp,
    ),
    query<{ s_id: number; a_id: number; status: string; day: number | null; minutes: number | null }>(
      `SELECT p.s_id, p.a_id, p.status, fn_scheduled_day(s.g_id, p.a_id) AS day,
              fn_session_minutes(p.check_in_time, p.check_out_time) AS minutes
       FROM Participates p JOIN Student s ON s.s_id = p.s_id ${pFilter}`,
      sp,
    ),
    query<{ s_id: number; a_id: number; rating: number; at: string }>(
      `SELECT f.s_id, f.a_id, f.rating, f.\`time\` AS at FROM Feedback f ${fFilter}`,
      sp,
    ),
  ]);
  return { groups, mentors, activities, students, participation, ratings };
}

async function upsertCatalog(d: SourceData) {
  await cypherWrite(
    `UNWIND $rows AS row
     MERGE (g:BootstrapGroup {g_id: toInteger(row.g_id)}) SET g.name = row.name`,
    { rows: d.groups },
  );
  await cypherWrite(
    `UNWIND $rows AS row
     MERGE (m:Mentor {m_id: toInteger(row.m_id)})
     SET m.name = row.name, m.dept = row.dept, m.designation = row.designation`,
    { rows: d.mentors },
  );
  await cypherWrite(
    `UNWIND $rows AS row
     MERGE (a:Activity {a_id: toInteger(row.a_id)})
     SET a.name = row.name, a.capacity = toInteger(row.capacity)`,
    { rows: d.activities },
  );
  await cypherWrite(`MATCH (:Activity)-[r:MENTORED_BY]->(:Mentor) DELETE r`);
  await cypherWrite(
    `UNWIND $rows AS row
     WITH row WHERE row.m_id IS NOT NULL
     MATCH (a:Activity {a_id: toInteger(row.a_id)}), (m:Mentor {m_id: toInteger(row.m_id)})
     MERGE (a)-[:MENTORED_BY]->(m)`,
    { rows: d.activities },
  );
}

async function upsertStudents(d: SourceData) {
  await cypherWrite(
    `UNWIND $rows AS row
     MERGE (s:Student {s_id: toInteger(row.s_id)})
     SET s.usn = row.usn, s.name = row.name, s.semester = toInteger(row.semester)
     WITH s, row
     OPTIONAL MATCH (s)-[old:BELONGS_TO|STUDIES|PARTICIPATED_IN|RATED]->()
     DELETE old
     WITH DISTINCT s, row
     OPTIONAL MATCH (s)-[oldInterest:INTERESTED_IN {source: 'rating'}]->()
     DELETE oldInterest
     WITH DISTINCT s, row
     MATCH (g:BootstrapGroup {g_id: toInteger(row.g_id)})
     MERGE (s)-[:BELONGS_TO]->(g)
     WITH s, row WHERE row.branch IS NOT NULL
     MERGE (b:Branch {name: row.branch})
     MERGE (s)-[:STUDIES]->(b)`,
    { rows: d.students },
  );
  await cypherWrite(
    `UNWIND $rows AS row
     MATCH (s:Student {s_id: toInteger(row.s_id)}), (a:Activity {a_id: toInteger(row.a_id)})
     CREATE (s)-[:PARTICIPATED_IN {status: row.status, day: toInteger(row.day), minutes: toInteger(row.minutes)}]->(a)`,
    { rows: d.participation },
  );
  await cypherWrite(
    `UNWIND $rows AS row
     MATCH (s:Student {s_id: toInteger(row.s_id)}), (a:Activity {a_id: toInteger(row.a_id)})
     CREATE (s)-[:RATED {rating: toInteger(row.rating), at: row.at}]->(a)
     WITH s, a, row WHERE row.rating >= $threshold
     MERGE (s)-[i:INTERESTED_IN {source: 'rating'}]->(a)
     SET i.weight = toInteger(row.rating)`,
    { rows: d.ratings, threshold: neo4j.int(INTEREST_RATING_THRESHOLD) },
  );
}

/** Full rebuild of the derived part of the graph. Idempotent. */
export async function syncAll() {
  await ensureConstraints();
  const d = await loadFromMysql();
  await upsertCatalog(d);
  await upsertStudents(d);

  // Remove nodes whose MySQL rows were deleted.
  await cypherWrite(`MATCH (s:Student) WHERE NOT s.s_id IN $ids DETACH DELETE s`, {
    ids: d.students.map((s) => neo4j.int(s.s_id)),
  });
  await cypherWrite(`MATCH (m:Mentor) WHERE NOT m.m_id IN $ids DETACH DELETE m`, {
    ids: d.mentors.map((m) => neo4j.int(m.m_id)),
  });
  await cypherWrite(`MATCH (a:Activity) WHERE NOT a.a_id IN $ids DETACH DELETE a`, {
    ids: d.activities.map((a) => neo4j.int(a.a_id)),
  });
  await cypherWrite(`MATCH (g:BootstrapGroup) WHERE NOT g.g_id IN $ids DETACH DELETE g`, {
    ids: d.groups.map((g) => neo4j.int(g.g_id)),
  });
  await cypherWrite(`MATCH (b:Branch) WHERE NOT EXISTS { (b)<-[:STUDIES]-() } DELETE b`);

  return graphCounts();
}

/** Refreshes one student after a MySQL change (feedback, attendance, transfer). */
export async function syncStudent(studentId: number) {
  const d = await loadFromMysql(studentId);
  if (d.students.length === 0) {
    await cypherWrite(`MATCH (s:Student {s_id: toInteger($id)}) DETACH DELETE s`, { id: studentId });
    return;
  }
  await upsertStudents(d);
}

/**
 * Best-effort graph refresh after a MySQL write. The MySQL write has already
 * committed, so a graph outage must not fail the request; the next full sync
 * repairs any drift.
 */
export async function syncStudentQuietly(studentId: number) {
  try {
    await syncStudent(studentId);
  } catch (err) {
    console.warn(`[graph] could not refresh student ${studentId}:`, (err as Error).message);
  }
}

export async function graphCounts() {
  const [nodes, rels] = await Promise.all([
    cypherRead<{ label: string; total: number }>(
      `MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS total ORDER BY label`,
    ),
    cypherRead<{ type: string; total: number }>(
      `MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS total ORDER BY type`,
    ),
  ]);
  return { nodes, relationships: rels };
}

// ----------------------------------------------------------- demo data

const BRANCH_INTEREST: Record<string, string> = {
  "Computer Science": "Prompt Engineering",
  Electronics: "Electrical Circuits",
  Mechanical: "Automobiles and Robotics",
  Biotechnology: "Biotechnology",
  Civil: "Design Thinking",
};

/**
 * Deterministic demo data for the graph-native relationships (like the
 * modulo-derived seed rows in the SQL script): some declared interests that
 * follow each student's branch, and a sparse peer-connection network.
 */
export async function seedDemoGraph() {
  const students = await query<{ s_id: number; branch: string | null }>("SELECT s_id, branch FROM Student ORDER BY s_id");
  const ids = students.map((s) => s.s_id);
  const n = ids.length;

  const declared: Array<{ s_id: number; activity: string }> = [];
  students.forEach((s, i) => {
    const own = s.branch ? BRANCH_INTEREST[s.branch] : undefined;
    if (own && i % 3 !== 0) declared.push({ s_id: s.s_id, activity: own });
    if (i % 4 === 0) declared.push({ s_id: s.s_id, activity: "Design Thinking" });
    if (i % 5 === 2) declared.push({ s_id: s.s_id, activity: "Prompt Engineering" });
  });

  const pairs: Array<{ a: number; b: number }> = [];
  ids.forEach((id, i) => {
    for (const step of [7, 13]) {
      const j = (i * 3 + step) % n;
      if (j !== i && (i + j) % 3 !== 0) pairs.push({ a: id, b: ids[j] });
    }
  });

  await cypherWrite(
    `UNWIND $rows AS row
     MATCH (s:Student {s_id: toInteger(row.s_id)}), (a:Activity {name: row.activity})
     MERGE (s)-[i:INTERESTED_IN {source: 'declared'}]->(a)
     ON CREATE SET i.since = datetime()`,
    { rows: declared },
  );
  await cypherWrite(
    `UNWIND $rows AS row
     MATCH (a:Student {s_id: toInteger(row.a)}), (b:Student {s_id: toInteger(row.b)})
     WHERE NOT EXISTS { (a)-[:CONNECTED_TO]-(b) }
     CREATE (a)-[:CONNECTED_TO {since: datetime()}]->(b)`,
    { rows: pairs },
  );
  return { declaredInterests: declared.length, connectionPairs: pairs.length };
}
