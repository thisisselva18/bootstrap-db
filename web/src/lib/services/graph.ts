import neo4j from "neo4j-driver";
import { ApiError } from "../api";
import { query } from "../mysql";
import { cypherRead, cypherWrite } from "../neo4j";
import type {
  ActivityRecommendation,
  Connection,
  EgoGraph,
  GraphPath,
  MentorRecommendation,
  PeerRecommendation,
  SimilarStudent,
} from "../types";

// Graph features. These traverse relationships (shared interests, friends of
// friends, multi-hop paths) that would need recursive self-joins in SQL.
// Every query is parameterized; ids are matched with toInteger() because the
// driver sends JavaScript numbers as floats.

export type Prefer = "cross-branch" | "same-branch" | "any";

/** Scoring weights for peer matchmaking; exported for the unit tests and docs. */
export const PEER_WEIGHTS = { jaccard: 0.6, mutual: 0.15, branch: 0.15, group: 0.1, mutualCap: 3 };

export function peerScore(p: {
  jaccard: number;
  mutuals: number;
  crossBranch: boolean;
  crossGroup: boolean;
  prefer: Prefer;
}): number {
  const w = PEER_WEIGHTS;
  const branchBonus =
    p.prefer === "cross-branch" ? (p.crossBranch ? w.branch : 0) : p.prefer === "same-branch" ? (p.crossBranch ? 0 : w.branch) : 0;
  const score =
    w.jaccard * p.jaccard + (w.mutual * Math.min(p.mutuals, w.mutualCap)) / w.mutualCap + branchBonus + (p.crossGroup ? w.group : 0);
  return Math.round(score * 1000) / 1000;
}

export async function assertStudentInGraph(sId: number) {
  const rows = await cypherRead(`MATCH (s:Student {s_id: toInteger($sid)}) RETURN s.s_id AS id`, { sid: sId });
  if (rows.length === 0) {
    throw new ApiError(404, "That student is not in the graph yet; an admin should run the graph sync");
  }
}

/**
 * Peer matchmaking. Candidates share at least one interest or one mutual
 * connection and are not already connected. Score = 0.6 x Jaccard similarity
 * of interest sets + up to 0.15 for mutual connections + 0.15 branch
 * preference + 0.1 for being in a different colour group (meet new people).
 */
export async function peerRecommendations(sId: number, prefer: Prefer, limit: number): Promise<PeerRecommendation[]> {
  await assertStudentInGraph(sId);
  const rows = await cypherRead<{
    s_id: number;
    name: string;
    usn: string;
    branch: string | null;
    group: string | null;
    sharedInterests: string[];
    mutuals: number;
    jaccard: number;
    crossBranch: boolean;
    crossGroup: boolean;
  }>(
    `MATCH (me:Student {s_id: toInteger($sid)})
     OPTIONAL MATCH (me)-[:STUDIES]->(myBranch:Branch)
     OPTIONAL MATCH (me)-[:BELONGS_TO]->(myGroup:BootstrapGroup)
     WITH me, myBranch, myGroup,
          COLLECT { MATCH (me)-[:INTERESTED_IN]->(a:Activity) RETURN DISTINCT a } AS myActs
     MATCH (peer:Student)
     WHERE peer <> me AND NOT EXISTS { (me)-[:CONNECTED_TO]-(peer) }
     WITH me, myBranch, myGroup, myActs, peer,
          COLLECT { MATCH (peer)-[:INTERESTED_IN]->(a:Activity) RETURN DISTINCT a } AS peerActs,
          COUNT { MATCH (me)-[:CONNECTED_TO]-(m:Student)-[:CONNECTED_TO]-(peer) RETURN DISTINCT m } AS mutuals
     WITH me, myBranch, myGroup, peer, mutuals, peerActs, myActs,
          [a IN myActs WHERE a IN peerActs] AS shared
     WHERE size(shared) > 0 OR mutuals > 0
     OPTIONAL MATCH (peer)-[:STUDIES]->(pb:Branch)
     OPTIONAL MATCH (peer)-[:BELONGS_TO]->(pg:BootstrapGroup)
     WITH peer, shared, mutuals, pb, pg,
          size(myActs) + size(peerActs) - size(shared) AS unionSize,
          (myBranch IS NOT NULL AND pb IS NOT NULL AND pb <> myBranch) AS crossBranch,
          (myGroup IS NOT NULL AND pg IS NOT NULL AND pg <> myGroup) AS crossGroup
     RETURN peer.s_id AS s_id, peer.name AS name, peer.usn AS usn, pb.name AS branch, pg.name AS group,
            [a IN shared | a.name] AS sharedInterests, mutuals,
            CASE WHEN unionSize = 0 THEN 0.0 ELSE toFloat(size(shared)) / unionSize END AS jaccard,
            crossBranch, crossGroup`,
    { sid: sId },
  );

  const scored = rows.map((r) => {
    const score = peerScore({ jaccard: r.jaccard, mutuals: r.mutuals, crossBranch: r.crossBranch, crossGroup: r.crossGroup, prefer });
    const reasons: string[] = [];
    if (r.sharedInterests.length) reasons.push(`Both interested in ${r.sharedInterests.join(", ")}`);
    if (r.mutuals) reasons.push(`${r.mutuals} mutual connection${r.mutuals > 1 ? "s" : ""}`);
    if (r.crossBranch) reasons.push(`Different branch (${r.branch})`);
    if (r.crossGroup) reasons.push(`Different colour group (${r.group})`);
    return {
      s_id: r.s_id,
      name: r.name,
      usn: r.usn,
      branch: r.branch,
      group: r.group,
      sharedInterests: r.sharedInterests,
      mutualConnections: r.mutuals,
      jaccard: Math.round(r.jaccard * 1000) / 1000,
      score,
      reasons,
    };
  });
  scored.sort((a, b) => b.score - a.score || b.sharedInterests.length - a.sharedInterests.length || a.name.localeCompare(b.name));
  const top = scored.slice(0, limit);

  // Combine with MySQL: attach each recommended peer's attendance record.
  if (top.length) {
    const att = await query<{ s_id: number; attendance_pct: number }>(
      "SELECT s_id, attendance_pct FROM vw_student_attendance WHERE s_id IN (?)",
      [top.map((p) => p.s_id)],
    );
    const byId = new Map(att.map((a) => [a.s_id, a.attendance_pct]));
    return top.map((p) => ({ ...p, attendance_pct: byId.get(p.s_id) ?? null }));
  }
  return top;
}

/**
 * Participation-pattern similarity over three signals:
 *  - shared interests (capped at 3)            weight 0.45
 *  - rating agreement on co-rated activities   weight 0.35
 *  - same attendance status per activity (of 5) weight 0.20
 */
export async function similarStudents(sId: number, limit: number): Promise<SimilarStudent[]> {
  await assertStudentInGraph(sId);
  return cypherRead<SimilarStudent>(
    `MATCH (me:Student {s_id: toInteger($sid)})
     MATCH (other:Student) WHERE other <> me
     WITH me, other,
          COUNT { MATCH (me)-[:INTERESTED_IN]->(a:Activity)<-[:INTERESTED_IN]-(other) RETURN DISTINCT a } AS sharedInterests,
          COLLECT { MATCH (me)-[r1:RATED]->(a:Activity)<-[r2:RATED]-(other)
                    RETURN 1.0 - abs(r1.rating - r2.rating) / 4.0 } AS agreements,
          COUNT { MATCH (me)-[p1:PARTICIPATED_IN]->(a:Activity)<-[p2:PARTICIPATED_IN]-(other)
                  WHERE p1.status = p2.status RETURN a } AS sameStatusCount
     WITH other, sharedInterests, sameStatusCount, size(agreements) AS coRated,
          CASE WHEN size(agreements) = 0 THEN null
               ELSE reduce(t = 0.0, x IN agreements | t + x) / size(agreements) END AS ratingAgreement
     WITH other, sharedInterests, sameStatusCount, coRated, ratingAgreement,
          0.45 * (CASE WHEN sharedInterests > 3 THEN 3 ELSE sharedInterests END) / 3.0
          + 0.35 * coalesce(ratingAgreement, 0.0)
          + 0.20 * sameStatusCount / 5.0 AS similarity
     WHERE sharedInterests > 0 OR coRated > 0
     OPTIONAL MATCH (other)-[:STUDIES]->(b:Branch)
     OPTIONAL MATCH (other)-[:BELONGS_TO]->(g:BootstrapGroup)
     RETURN other.s_id AS s_id, other.name AS name, b.name AS branch, g.name AS group,
            sharedInterests, coRated,
            CASE WHEN ratingAgreement IS NULL THEN null ELSE round(ratingAgreement, 3) END AS ratingAgreement,
            sameStatusCount, round(similarity, 3) AS similarity
     ORDER BY similarity DESC, name
     LIMIT $limit`,
    { sid: sId, limit: neo4j.int(limit) },
  );
}

/**
 * Collaborative filtering: activities that the student's peers (people who
 * share an interest with them, or are connected to them) are interested in
 * and the student is not yet. Falls back to overall popularity.
 */
export async function activityRecommendations(sId: number, limit: number): Promise<ActivityRecommendation[]> {
  await assertStudentInGraph(sId);
  const rows = await cypherRead<ActivityRecommendation>(
    `MATCH (me:Student {s_id: toInteger($sid)})
     CALL (me) {
       MATCH (me)-[:INTERESTED_IN]->(:Activity)<-[:INTERESTED_IN]-(p:Student) WHERE p <> me RETURN p
       UNION
       MATCH (me)-[:CONNECTED_TO]-(p:Student) RETURN p
     }
     WITH me, collect(DISTINCT p) AS peers
     UNWIND peers AS p
     MATCH (p)-[:INTERESTED_IN]->(rec:Activity)
     WHERE NOT EXISTS { (me)-[:INTERESTED_IN]->(rec) }
     WITH rec, size(peers) AS peerCount, collect(DISTINCT p) AS supporters
     OPTIONAL MATCH (rec)-[:MENTORED_BY]->(m:Mentor)
     RETURN rec.a_id AS a_id, rec.name AS name, m.name AS mentor, size(supporters) AS supporters,
            [x IN supporters | x.name][..5] AS supporterNames,
            round(toFloat(size(supporters)) / peerCount, 3) AS score
     ORDER BY score DESC, supporters DESC, name
     LIMIT $limit`,
    { sid: sId, limit: neo4j.int(limit) },
  );
  if (rows.length) return rows;
  return cypherRead<ActivityRecommendation>(
    `MATCH (me:Student {s_id: toInteger($sid)})
     MATCH (rec:Activity) WHERE NOT EXISTS { (me)-[:INTERESTED_IN]->(rec) }
     OPTIONAL MATCH (rec)-[:MENTORED_BY]->(m:Mentor)
     WITH rec, m, COLLECT { MATCH (s:Student)-[:INTERESTED_IN]->(rec) RETURN DISTINCT s } AS fans
     RETURN rec.a_id AS a_id, rec.name AS name, m.name AS mentor, size(fans) AS supporters,
            [x IN fans | x.name][..5] AS supporterNames, 0.0 AS score
     ORDER BY supporters DESC, name LIMIT $limit`,
    { sid: sId, limit: neo4j.int(limit) },
  );
}

/** Mentors reachable through the student's interests or their connections' interests. */
export async function mentorRecommendations(sId: number): Promise<MentorRecommendation[]> {
  await assertStudentInGraph(sId);
  return cypherRead<MentorRecommendation>(
    `MATCH (me:Student {s_id: toInteger($sid)})
     // length 2: me -INTERESTED_IN-> a -MENTORED_BY-> m
     // length 3: me -CONNECTED_TO- peer -INTERESTED_IN-> a -MENTORED_BY-> m
     MATCH path = (me)-[:INTERESTED_IN|CONNECTED_TO*1..2]-(a:Activity)-[:MENTORED_BY]->(m:Mentor)
     WITH m, a, CASE WHEN length(path) = 3 THEN nodes(path)[1] END AS peer
     RETURN m.m_id AS m_id, m.name AS name, m.dept AS dept,
            collect(DISTINCT a.name) AS viaActivities, count(DISTINCT peer) AS peers
     ORDER BY peers DESC, name LIMIT 5`,
    { sid: sId },
  );
}

// ---------------------------------------------------------- connections

export function listConnections(sId: number) {
  return cypherRead<Connection>(
    `MATCH (me:Student {s_id: toInteger($sid)})-[r:CONNECTED_TO]-(p:Student)
     OPTIONAL MATCH (p)-[:STUDIES]->(b:Branch)
     OPTIONAL MATCH (p)-[:BELONGS_TO]->(g:BootstrapGroup)
     RETURN p.s_id AS s_id, p.name AS name, b.name AS branch, g.name AS group, toString(r.since) AS since
     ORDER BY name`,
    { sid: sId },
  );
}

export async function connect(sId: number, peerId: number) {
  if (sId === peerId) throw new ApiError(400, "You cannot connect to yourself");
  const rows = await cypherWrite<{ created: boolean }>(
    `MATCH (me:Student {s_id: toInteger($sid)}), (p:Student {s_id: toInteger($pid)})
     WITH me, p, EXISTS { (me)-[:CONNECTED_TO]-(p) } AS already
     FOREACH (_ IN CASE WHEN already THEN [] ELSE [1] END |
       CREATE (me)-[:CONNECTED_TO {since: datetime()}]->(p))
     RETURN NOT already AS created`,
    { sid: sId, pid: peerId },
  );
  if (rows.length === 0) throw new ApiError(404, "Student not found in the graph");
  if (!rows[0].created) throw new ApiError(409, "You are already connected");
}

export async function disconnect(sId: number, peerId: number) {
  const rows = await cypherWrite<{ removed: number }>(
    `MATCH (:Student {s_id: toInteger($sid)})-[r:CONNECTED_TO]-(:Student {s_id: toInteger($pid)})
     DELETE r RETURN count(*) AS removed`,
    { sid: sId, pid: peerId },
  );
  if (!rows[0]?.removed) throw new ApiError(404, "No such connection");
}

// ------------------------------------------------------------ interests

export function getInterests(sId: number) {
  return cypherRead<{ a_id: number; name: string; declared: boolean; fromRating: boolean }>(
    `MATCH (a:Activity)
     OPTIONAL MATCH (:Student {s_id: toInteger($sid)})-[d:INTERESTED_IN {source: 'declared'}]->(a)
     OPTIONAL MATCH (:Student {s_id: toInteger($sid)})-[r:INTERESTED_IN {source: 'rating'}]->(a)
     RETURN a.a_id AS a_id, a.name AS name, d IS NOT NULL AS declared, r IS NOT NULL AS fromRating
     ORDER BY a.a_id`,
    { sid: sId },
  );
}

/** Replaces the student's self-declared interests (graph-native data). */
export async function setInterests(sId: number, activityIds: number[]) {
  await assertStudentInGraph(sId);
  await cypherWrite(
    `MATCH (s:Student {s_id: toInteger($sid)})
     OPTIONAL MATCH (s)-[old:INTERESTED_IN {source: 'declared'}]->(a:Activity)
     WHERE NOT a.a_id IN $ids
     DELETE old
     WITH DISTINCT s
     UNWIND $ids AS id
     MATCH (a:Activity {a_id: id})
     MERGE (s)-[i:INTERESTED_IN {source: 'declared'}]->(a)
     ON CREATE SET i.since = datetime()`,
    { sid: sId, ids: activityIds.map((id) => neo4j.int(id)) },
  );
  return getInterests(sId);
}

// ---------------------------------------------------------- exploration

/** The student's neighbourhood: group, branch, interests (+ mentors) and connections. */
export async function egoGraph(sId: number): Promise<EgoGraph> {
  await assertStudentInGraph(sId);
  const rows = await cypherRead<{
    me: { id: number; name: string };
    group: string | null;
    branch: string | null;
    interests: Array<{ id: number; name: string; mentorId: number | null; mentor: string | null }>;
    peers: Array<{ id: number; name: string }>;
  }>(
    `MATCH (me:Student {s_id: toInteger($sid)})
     OPTIONAL MATCH (me)-[:BELONGS_TO]->(g:BootstrapGroup)
     OPTIONAL MATCH (me)-[:STUDIES]->(b:Branch)
     RETURN {id: me.s_id, name: me.name} AS me, g.name AS group, b.name AS branch,
            COLLECT { MATCH (me)-[:INTERESTED_IN]->(a:Activity)
                      OPTIONAL MATCH (a)-[:MENTORED_BY]->(m:Mentor)
                      RETURN DISTINCT {id: a.a_id, name: a.name, mentorId: m.m_id, mentor: m.name} } AS interests,
            COLLECT { MATCH (me)-[:CONNECTED_TO]-(p:Student)
                      RETURN DISTINCT {id: p.s_id, name: p.name} } AS peers`,
    { sid: sId },
  );
  const r = rows[0];
  const nodes: EgoGraph["nodes"] = [{ id: `s${r.me.id}`, label: r.me.name, kind: "me" }];
  const edges: EgoGraph["edges"] = [];
  if (r.group) {
    nodes.push({ id: "g", label: `${r.group} group`, kind: "group" });
    edges.push({ source: `s${r.me.id}`, target: "g", type: "BELONGS_TO" });
  }
  if (r.branch) {
    nodes.push({ id: "b", label: r.branch, kind: "branch" });
    edges.push({ source: `s${r.me.id}`, target: "b", type: "STUDIES" });
  }
  for (const a of r.interests) {
    nodes.push({ id: `a${a.id}`, label: a.name, kind: "activity" });
    edges.push({ source: `s${r.me.id}`, target: `a${a.id}`, type: "INTERESTED_IN" });
    if (a.mentorId != null && !nodes.some((n) => n.id === `m${a.mentorId}`)) {
      nodes.push({ id: `m${a.mentorId}`, label: a.mentor ?? "Mentor", kind: "mentor" });
    }
    if (a.mentorId != null) edges.push({ source: `a${a.id}`, target: `m${a.mentorId}`, type: "MENTORED_BY" });
  }
  for (const p of r.peers) {
    nodes.push({ id: `s${p.id}`, label: p.name, kind: "student" });
    edges.push({ source: `s${r.me.id}`, target: `s${p.id}`, type: "CONNECTED_TO" });
  }
  return { nodes, edges };
}

/**
 * Shortest "how are we connected" path between two students. Social and
 * interest links are tried first; group/branch links are the fallback.
 */
export async function shortestPath(from: number, to: number): Promise<GraphPath> {
  const run = (types: string) =>
    cypherRead<{ length: number; nodes: Array<{ kind: string; label: string }>; rels: string[] }>(
      `MATCH (a:Student {s_id: toInteger($from)}), (b:Student {s_id: toInteger($to)})
       MATCH p = SHORTEST 1 (a)-[:${types}]-{1,6}(b)
       RETURN length(p) AS length,
              [n IN nodes(p) | {kind: labels(n)[0], label: coalesce(n.name, '')}] AS nodes,
              [r IN relationships(p) | type(r)] AS rels`,
      { from, to },
    );
  const social = await run("CONNECTED_TO|INTERESTED_IN");
  if (social.length) return social[0];
  const any = await run("CONNECTED_TO|INTERESTED_IN|BELONGS_TO|STUDIES|PARTICIPATED_IN");
  return any[0] ?? null;
}

/** Network-level insights for staff. */
export async function insights(mentorId?: number) {
  const [central, activityInterest, coInterest, bridges, crossBranch] = await Promise.all([
    // Degree centrality in the peer network.
    cypherRead<{ s_id: number; name: string; branch: string | null; degree: number }>(
      `MATCH (s:Student)
       OPTIONAL MATCH (s)-[:STUDIES]->(b:Branch)
       WITH s, b, COUNT { (s)-[:CONNECTED_TO]-() } AS degree
       WHERE degree > 0
       RETURN s.s_id AS s_id, s.name AS name, b.name AS branch, degree
       ORDER BY degree DESC, name LIMIT 8`,
    ),
    // Interest per activity by source, with its mentor.
    cypherRead<{ a_id: number; name: string; mentor: string | null; declared: number; fromRating: number; total: number }>(
      `MATCH (a:Activity)
       OPTIONAL MATCH (a)-[:MENTORED_BY]->(m:Mentor)
       RETURN a.a_id AS a_id, a.name AS name, m.name AS mentor,
              COUNT { (:Student)-[:INTERESTED_IN {source: 'declared'}]->(a) } AS declared,
              COUNT { (:Student)-[:INTERESTED_IN {source: 'rating'}]->(a) } AS fromRating,
              COUNT { MATCH (s:Student)-[:INTERESTED_IN]->(a) RETURN DISTINCT s } AS total
       ORDER BY total DESC, name`,
    ),
    // Activities that attract the same students (co-interest pairs).
    cypherRead<{ first: string; second: string; students: number }>(
      `MATCH (a1:Activity)<-[:INTERESTED_IN]-(s:Student)-[:INTERESTED_IN]->(a2:Activity)
       WHERE a1.a_id < a2.a_id
       RETURN a1.name AS first, a2.name AS second, count(DISTINCT s) AS students
       ORDER BY students DESC LIMIT 6`,
    ),
    // Bridges: students whose connections reach the most branches.
    cypherRead<{ s_id: number; name: string; branchesReached: number }>(
      `MATCH (s:Student)-[:CONNECTED_TO]-(:Student)-[:STUDIES]->(b:Branch)
       RETURN s.s_id AS s_id, s.name AS name, count(DISTINCT b) AS branchesReached
       ORDER BY branchesReached DESC, name LIMIT 6`,
    ),
    cypherRead<{ total: number; crossBranch: number }>(
      `MATCH (a:Student)-[:CONNECTED_TO]->(b:Student)
       OPTIONAL MATCH (a)-[:STUDIES]->(ba:Branch)
       OPTIONAL MATCH (b)-[:STUDIES]->(bb:Branch)
       RETURN count(*) AS total, sum(CASE WHEN ba <> bb THEN 1 ELSE 0 END) AS crossBranch`,
    ),
  ]);

  let mentorReach: Array<{ activity: string; branch: string | null; students: number; names: string[] }> = [];
  if (mentorId) {
    mentorReach = await cypherRead(
      `MATCH (:Mentor {m_id: toInteger($mid)})<-[:MENTORED_BY]-(a:Activity)<-[:INTERESTED_IN]-(s:Student)
       OPTIONAL MATCH (s)-[:STUDIES]->(b:Branch)
       WITH a, b, collect(DISTINCT s.name) AS names
       RETURN a.name AS activity, b.name AS branch, size(names) AS students, names[..6] AS names
       ORDER BY activity, students DESC`,
      { mid: mentorId },
    );
  }

  const cb = crossBranch[0] ?? { total: 0, crossBranch: 0 };
  return {
    central,
    activityInterest,
    coInterest,
    bridges,
    network: {
      connections: cb.total,
      crossBranch: cb.crossBranch,
      crossBranchPct: cb.total ? Math.round((1000 * cb.crossBranch) / cb.total) / 10 : 0,
    },
    mentorReach,
  };
}

/** Students for pickers (staff choose whose matchmaking to view). */
export function graphStudents() {
  return cypherRead<{ s_id: number; name: string; usn: string }>(
    `MATCH (s:Student) RETURN s.s_id AS s_id, s.name AS name, s.usn AS usn ORDER BY s.name`,
  );
}
