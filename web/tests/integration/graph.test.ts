// Neo4j integration tests: the MySQL -> graph sync and the recommendation
// queries. Requires both databases (npm run test:db). Graph-native test
// data (connections, declared interests) is removed again afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, query, queryOne } from "@/lib/mysql";
import { closeNeo4j, cypherRead } from "@/lib/neo4j";
import {
  activityRecommendations,
  connect,
  disconnect,
  egoGraph,
  getInterests,
  listConnections,
  mentorRecommendations,
  peerRecommendations,
  setInterests,
  shortestPath,
  similarStudents,
} from "@/lib/services/graph";
import { INTEREST_RATING_THRESHOLD, syncAll, syncStudent } from "@/lib/services/graph-sync";

let sid: number;
let declaredBefore: number[];

beforeAll(async () => {
  await syncAll();
  // A student who rated something 4+ so they have at least one interest.
  sid = (await queryOne<{ s_id: number }>(`SELECT s_id FROM Feedback WHERE rating >= 4 ORDER BY s_id LIMIT 1`))!.s_id;
  declaredBefore = (await getInterests(sid)).filter((i) => i.declared).map((i) => i.a_id);
});

afterAll(async () => {
  await setInterests(sid, declaredBefore);
  await closeNeo4j();
  await pool().end();
});

describe("sync", () => {
  it("creates one node per MySQL row", async () => {
    const [mysql] = await query<{ s: number; m: number; a: number; g: number; b: number }>(
      `SELECT (SELECT COUNT(*) FROM Student) AS s, (SELECT COUNT(*) FROM Mentor) AS m, (SELECT COUNT(*) FROM Activity) AS a,
              (SELECT COUNT(*) FROM BootstrapGroup) AS g, (SELECT COUNT(DISTINCT branch) FROM Student) AS b`,
    );
    const nodes = Object.fromEntries(
      (await cypherRead<{ label: string; n: number }>("MATCH (n) RETURN labels(n)[0] AS label, count(*) AS n")).map((r) => [r.label, r.n]),
    );
    expect(nodes).toMatchObject({ Student: mysql.s, Mentor: mysql.m, Activity: mysql.a, BootstrapGroup: mysql.g, Branch: mysql.b });
  });

  it("copies participation, ratings and derived interests exactly", async () => {
    const [mysql] = await query<{ p: number; f: number; liked: number }>(
      `SELECT (SELECT COUNT(*) FROM Participates) AS p, (SELECT COUNT(*) FROM Feedback) AS f,
              (SELECT COUNT(*) FROM Feedback WHERE rating >= ?) AS liked`,
      [INTEREST_RATING_THRESHOLD],
    );
    const [g] = await cypherRead<{ p: number; f: number; liked: number }>(
      `RETURN COUNT { ()-[:PARTICIPATED_IN]->() } AS p, COUNT { ()-[:RATED]->() } AS f,
              COUNT { ()-[:INTERESTED_IN {source: 'rating'}]->() } AS liked`,
    );
    expect(g).toEqual(mysql);
  });

  it("is idempotent and has uniqueness constraints", async () => {
    const count = () => cypherRead<{ n: number }>("MATCH ()-[r]->() RETURN count(r) AS n");
    const [before] = await count();
    await syncAll();
    const [after] = await count();
    expect(after.n).toBe(before.n);
    const constraints = await cypherRead<{ name: string }>("SHOW CONSTRAINTS YIELD name RETURN name");
    expect(constraints.map((c) => c.name)).toEqual(expect.arrayContaining(["student_id", "activity_id", "mentor_id", "group_id", "branch_name"]));
  });

  it("refreshes a single student from MySQL", async () => {
    await syncStudent(sid);
    const [r] = await cypherRead<{ g: number }>("MATCH (:Student {s_id: $sid})-[:BELONGS_TO]->(g) RETURN g.g_id AS g", { sid });
    const s = await queryOne<{ g_id: number }>("SELECT g_id FROM Student WHERE s_id = ?", [sid]);
    expect(r.g).toBe(s?.g_id);
  });
});

describe("matchmaking queries", () => {
  it("never recommends yourself or an existing connection, and sorts by score", async () => {
    const peers = await peerRecommendations(sid, "cross-branch", 10);
    const connected = new Set((await listConnections(sid)).map((c) => c.s_id));
    expect(peers.length).toBeGreaterThan(0);
    for (const p of peers) {
      expect(p.s_id).not.toBe(sid);
      expect(connected.has(p.s_id)).toBe(false);
      expect(p.sharedInterests.length > 0 || p.mutualConnections > 0).toBe(true);
      expect(p.jaccard).toBeGreaterThanOrEqual(0);
      expect(p.jaccard).toBeLessThanOrEqual(1);
      expect(p.attendance_pct).not.toBeUndefined(); // merged from MySQL
    }
    for (let i = 1; i < peers.length; i++) expect(peers[i - 1].score).toBeGreaterThanOrEqual(peers[i].score);
  });

  it("connect/disconnect changes the recommendations", async () => {
    const [top] = await peerRecommendations(sid, "any", 1);
    await connect(sid, top.s_id);
    try {
      await expect(connect(sid, top.s_id)).rejects.toThrow(/already connected/);
      expect((await listConnections(sid)).some((c) => c.s_id === top.s_id)).toBe(true);
      expect((await peerRecommendations(sid, "any", 50)).some((p) => p.s_id === top.s_id)).toBe(false);
    } finally {
      await disconnect(sid, top.s_id);
    }
    await expect(disconnect(sid, top.s_id)).rejects.toThrow(/No such connection/);
    await expect(connect(sid, sid)).rejects.toThrow(/yourself/);
  });

  it("declared interests are stored and drive activity recommendations", async () => {
    const all = await cypherRead<{ id: number }>("MATCH (a:Activity) RETURN a.a_id AS id ORDER BY id");
    await setInterests(sid, [all[0].id]);
    const interests = await getInterests(sid);
    expect(interests.find((i) => i.a_id === all[0].id)?.declared).toBe(true);
    const recs = await activityRecommendations(sid, 5);
    const mine = new Set(interests.filter((i) => i.declared || i.fromRating).map((i) => i.a_id));
    for (const r of recs) expect(mine.has(r.a_id)).toBe(false);
  });

  it("similarity, mentors, ego graph and paths return well-formed results", async () => {
    const sim = await similarStudents(sid, 5);
    for (const s of sim) {
      expect(s.s_id).not.toBe(sid);
      expect(s.similarity).toBeGreaterThan(0);
      expect(s.similarity).toBeLessThanOrEqual(1);
    }
    const mentors = await mentorRecommendations(sid);
    for (const m of mentors) expect(m.viaActivities.length).toBeGreaterThan(0);

    const ego = await egoGraph(sid);
    expect(ego.nodes.filter((n) => n.kind === "me")).toHaveLength(1);
    const ids = new Set(ego.nodes.map((n) => n.id));
    for (const e of ego.edges) expect(ids.has(e.source) && ids.has(e.target)).toBe(true);

    const other = (await queryOne<{ s_id: number }>("SELECT s_id FROM Student WHERE s_id <> ? ORDER BY s_id DESC LIMIT 1", [sid]))!.s_id;
    const path = await shortestPath(sid, other);
    expect(path).not.toBeNull();
    expect(path!.nodes[0].kind).toBe("Student");
    expect(path!.nodes).toHaveLength(path!.length + 1);
  });

  it("reports unknown students clearly", async () => {
    await expect(peerRecommendations(999999, "any", 5)).rejects.toThrow(/not in the graph/);
  });
});
