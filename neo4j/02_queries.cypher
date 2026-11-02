// =====================================================================
//  CAMPUS BOOTSTRAP : key Cypher queries (Neo4j 5.x / 2025+, Cypher 25)
// =====================================================================
//  The web app runs the same queries from web/src/lib/services/graph.ts.
//  In Neo4j Browser set parameters first:
//    :param sid => 1
//    :param to  => 40
//    :param mid => 2
// =====================================================================

// ---- G1 Verify the import: node and relationship counts --------------
MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS total ORDER BY label;
MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS total ORDER BY type;

// ---- G2 Students who share interests with a student ------------------
MATCH (me:Student {s_id: $sid})-[:INTERESTED_IN]->(a:Activity)<-[:INTERESTED_IN]-(peer:Student)
WHERE peer <> me
RETURN peer.name AS peer, collect(DISTINCT a.name) AS sharedActivities
ORDER BY size(sharedActivities) DESC, peer;

// ---- G3 Peer matchmaking (Jaccard + mutual friends + diversity) ------
//  score = 0.6*jaccard + 0.15*min(mutuals,3)/3 + 0.15*(different branch)
//          + 0.1*(different colour group)   -- weights: graph.ts PEER_WEIGHTS
MATCH (me:Student {s_id: $sid})
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
     (pb <> myBranch) AS crossBranch, (pg <> myGroup) AS crossGroup
WITH peer, shared, mutuals, pb, crossBranch, crossGroup,
     CASE WHEN unionSize = 0 THEN 0.0 ELSE toFloat(size(shared)) / unionSize END AS jaccard
RETURN peer.name AS peer, pb.name AS branch, [a IN shared | a.name] AS shared, mutuals,
       round(0.6 * jaccard
             + 0.15 * (CASE WHEN mutuals > 3 THEN 3 ELSE mutuals END) / 3.0
             + CASE WHEN crossBranch THEN 0.15 ELSE 0 END
             + CASE WHEN crossGroup  THEN 0.1  ELSE 0 END, 3) AS score
ORDER BY score DESC LIMIT 8;

// ---- G4 Similar participation patterns -------------------------------
MATCH (me:Student {s_id: $sid}), (other:Student) WHERE other <> me
WITH me, other,
     COUNT { MATCH (me)-[:INTERESTED_IN]->(a)<-[:INTERESTED_IN]-(other) RETURN DISTINCT a } AS sharedInterests,
     COLLECT { MATCH (me)-[r1:RATED]->(a)<-[r2:RATED]-(other)
               RETURN 1.0 - abs(r1.rating - r2.rating) / 4.0 } AS agreements,
     COUNT { MATCH (me)-[p1:PARTICIPATED_IN]->(a)<-[p2:PARTICIPATED_IN]-(other)
             WHERE p1.status = p2.status RETURN a } AS sameStatus
WHERE sharedInterests > 0 OR size(agreements) > 0
RETURN other.name AS student, sharedInterests, size(agreements) AS coRated, sameStatus,
       round(0.45 * (CASE WHEN sharedInterests > 3 THEN 3 ELSE sharedInterests END) / 3.0
             + 0.35 * CASE WHEN size(agreements) = 0 THEN 0.0
                           ELSE reduce(t = 0.0, x IN agreements | t + x) / size(agreements) END
             + 0.20 * sameStatus / 5.0, 3) AS similarity
ORDER BY similarity DESC LIMIT 8;

// ---- G5 Activity recommendation (collaborative filtering) ------------
MATCH (me:Student {s_id: $sid})
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
RETURN rec.name AS activity, m.name AS mentor, size(supporters) AS supporters,
       round(toFloat(size(supporters)) / peerCount, 3) AS score
ORDER BY score DESC;

// ---- G6 Mentor discovery through interests and friends ---------------
MATCH (me:Student {s_id: $sid})
MATCH path = (me)-[:INTERESTED_IN|CONNECTED_TO*1..2]-(a:Activity)-[:MENTORED_BY]->(m:Mentor)
WITH m, a, CASE WHEN length(path) = 3 THEN nodes(path)[1] END AS peer
RETURN m.name AS mentor, collect(DISTINCT a.name) AS via, count(DISTINCT peer) AS peers
ORDER BY peers DESC;

// ---- G7 How are two students connected? (shortest path) --------------
MATCH (a:Student {s_id: $sid}), (b:Student {s_id: $to})
MATCH p = SHORTEST 1 (a)-[:CONNECTED_TO|INTERESTED_IN]-{1,6}(b)
RETURN [n IN nodes(p) | coalesce(n.name, '')] AS route, [r IN relationships(p) | type(r)] AS via;

// ---- G8 Degree centrality: best-connected students --------------------
MATCH (s:Student)
RETURN s.name AS student, COUNT { (s)-[:CONNECTED_TO]-() } AS degree
ORDER BY degree DESC LIMIT 8;

// ---- G9 Activities that attract the same students ---------------------
MATCH (a1:Activity)<-[:INTERESTED_IN]-(s:Student)-[:INTERESTED_IN]->(a2:Activity)
WHERE a1.a_id < a2.a_id
RETURN a1.name AS first, a2.name AS second, count(DISTINCT s) AS students
ORDER BY students DESC;

// ---- G10 Bridges: whose connections reach the most branches -----------
MATCH (s:Student)-[:CONNECTED_TO]-(:Student)-[:STUDIES]->(b:Branch)
RETURN s.name AS student, count(DISTINCT b) AS branchesReached
ORDER BY branchesReached DESC LIMIT 6;

// ---- G11 Mentor reach: students interested in a mentor's activity -----
MATCH (:Mentor {m_id: $mid})<-[:MENTORED_BY]-(a:Activity)<-[:INTERESTED_IN]-(s:Student)
OPTIONAL MATCH (s)-[:STUDIES]->(b:Branch)
RETURN a.name AS activity, b.name AS branch, count(DISTINCT s) AS students;
