import { query } from "../mysql";
import type { ActivityStats, GroupStats } from "../types";
import { listActivities, listGroups } from "./catalog";

/**
 * Admin overview. Each block is one of the analytical queries from the SQL
 * report (aggregates, GROUP BY/HAVING, subqueries, EXISTS/NOT EXISTS, views).
 */
export async function overview() {
  const [counts, groups, activities, branches, risk, belowAverage, topAttenders, flags] = await Promise.all([
    query<{ entity: string; total: number }>(
      `SELECT 'students' AS entity, COUNT(*) AS total FROM Student
       UNION ALL SELECT 'mentors',  COUNT(*) FROM Mentor
       UNION ALL SELECT 'activities', COUNT(*) FROM Activity
       UNION ALL SELECT 'groups',   COUNT(*) FROM BootstrapGroup
       UNION ALL SELECT 'sessions', COUNT(*) FROM Schedule
       UNION ALL SELECT 'feedback', COUNT(*) FROM Feedback
       UNION ALL SELECT 'auditEntries', COUNT(*) FROM attendance_log`,
    ),
    listGroups(),
    listActivities(),
    // GROUP BY + HAVING: branches with at least two students
    query<{ branch: string; students: number; avg_semester: number }>(
      `SELECT branch, COUNT(*) AS students, ROUND(AVG(semester), 2) AS avg_semester
       FROM   Student WHERE branch IS NOT NULL
       GROUP  BY branch HAVING COUNT(*) >= 2
       ORDER  BY students DESC, branch`,
    ),
    query<{ risk: string; students: number }>(
      `SELECT risk, COUNT(*) AS students FROM vw_student_attendance GROUP BY risk
       ORDER BY FIELD(risk, 'HIGH', 'MEDIUM', 'LOW')`,
    ),
    // Scalar subquery: students below the programme average
    query<{ s_id: number; s_usn: string; s_name: string; colour_group: string; attendance_pct: number; risk: string }>(
      `SELECT s_id, s_usn, s_name, colour_group, attendance_pct, risk
       FROM   vw_student_attendance
       WHERE  attendance_pct < (SELECT AVG(attendance_pct) FROM vw_student_attendance)
       ORDER  BY attendance_pct, s_name LIMIT 15`,
    ),
    query<{ s_usn: string; s_name: string; colour_group: string; attendance_pct: number }>(
      `SELECT s_usn, s_name, colour_group, attendance_pct FROM vw_student_attendance
       ORDER BY attendance_pct DESC, s_name LIMIT 5`,
    ),
    // EXISTS / NOT EXISTS counts
    query<{ late_once: number; no_feedback: number; never_absent: number }>(
      `SELECT
         (SELECT COUNT(*) FROM Student s WHERE EXISTS
            (SELECT 1 FROM Participates p WHERE p.s_id = s.s_id AND p.status = 'late'))      AS late_once,
         (SELECT COUNT(*) FROM Student s WHERE NOT EXISTS
            (SELECT 1 FROM Feedback f WHERE f.s_id = s.s_id))                                AS no_feedback,
         (SELECT COUNT(*) FROM Student s WHERE NOT EXISTS
            (SELECT 1 FROM Participates p WHERE p.s_id = s.s_id AND p.status = 'absent'))    AS never_absent`,
    ),
  ]);

  const totals = Object.fromEntries(counts.map((c) => [c.entity, c.total])) as Record<string, number>;
  const overall = await query<{ pct: number }>(
    `SELECT ROUND(100 * SUM(status IN ('present','late')) / NULLIF(COUNT(*), 0), 2) AS pct FROM Participates`,
  );

  return {
    totals,
    overallAttendancePct: overall[0]?.pct ?? 0,
    groups: groups as GroupStats[],
    activities: activities as ActivityStats[],
    branches,
    risk,
    belowAverage,
    topAttenders,
    flags: flags[0],
  };
}

export type Overview = Awaited<ReturnType<typeof overview>>;
