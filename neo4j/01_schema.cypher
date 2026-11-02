// =====================================================================
//  CAMPUS BOOTSTRAP : Neo4j graph model (constraints + indexes)
// =====================================================================
//  Applied automatically by `npm run graph:sync`; listed here for the report
//  and for running by hand in Neo4j Browser.
//
//  Nodes (key = MySQL primary key, so every node maps to one MySQL row)
//    (:Student {s_id, usn, name, semester})
//    (:BootstrapGroup {g_id, name})
//    (:Activity {a_id, name, capacity})
//    (:Mentor {m_id, name, dept, designation})
//    (:Branch {name})                         -- distinct Student.branch values
//
//  Relationships derived from MySQL (rebuilt on every sync)
//    (Student)-[:BELONGS_TO]->(BootstrapGroup)
//    (Student)-[:STUDIES]->(Branch)
//    (Activity)-[:MENTORED_BY]->(Mentor)
//    (Student)-[:PARTICIPATED_IN {status, day, minutes}]->(Activity)
//    (Student)-[:RATED {rating, at}]->(Activity)
//    (Student)-[:INTERESTED_IN {source:'rating', weight}]->(Activity)   rating >= 4
//
//  Graph-native relationships (only in Neo4j, never removed by the sync)
//    (Student)-[:INTERESTED_IN {source:'declared', since}]->(Activity)
//    (Student)-[:CONNECTED_TO {since}]->(Student)       stored once, read undirected
// =====================================================================

CREATE CONSTRAINT student_id  IF NOT EXISTS FOR (n:Student)        REQUIRE n.s_id IS UNIQUE;
CREATE CONSTRAINT group_id    IF NOT EXISTS FOR (n:BootstrapGroup) REQUIRE n.g_id IS UNIQUE;
CREATE CONSTRAINT activity_id IF NOT EXISTS FOR (n:Activity)       REQUIRE n.a_id IS UNIQUE;
CREATE CONSTRAINT mentor_id   IF NOT EXISTS FOR (n:Mentor)         REQUIRE n.m_id IS UNIQUE;
CREATE CONSTRAINT branch_name IF NOT EXISTS FOR (n:Branch)         REQUIRE n.name IS UNIQUE;
CREATE INDEX student_usn      IF NOT EXISTS FOR (n:Student) ON (n.usn);
CREATE INDEX interest_source  IF NOT EXISTS FOR ()-[r:INTERESTED_IN]-() ON (r.source);

SHOW CONSTRAINTS;
