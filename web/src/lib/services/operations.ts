import { ApiError } from "../api";
import { callProc, execute, query, withConnection } from "../mysql";
import type { AuditRow, FeedbackRow, RosterRow, TimetableSlot } from "../types";

// ------------------------------------------------------------- schedule

export function timetable() {
  return query<TimetableSlot>(
    `SELECT sc.schedule_id, sc.\`day\`, g.g_id, g.g_name, a.a_id, a.a_name, sc.room,
            sc.start_time, sc.end_time, m.m_name AS mentor
     FROM   Schedule sc
     JOIN   bootstrap_group g ON g.g_id = sc.g_id
     JOIN   Activity       a ON a.a_id = sc.a_id
     LEFT JOIN Mentor      m ON m.m_id = a.m_id
     ORDER  BY sc.\`day\`, g.g_id`,
  );
}

/** trg_schedule_room_clash_upd and chk_schedule_times guard this update. */
export async function updateSlot(id: number, patch: { room?: string | null; startTime?: string; endTime?: string }) {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.room !== undefined) {
    sets.push("room = ?");
    params.push(patch.room || null);
  }
  if (patch.startTime) {
    sets.push("start_time = ?");
    params.push(patch.startTime);
  }
  if (patch.endTime) {
    sets.push("end_time = ?");
    params.push(patch.endTime);
  }
  const { affectedRows } = await execute(`UPDATE Schedule SET ${sets.join(", ")} WHERE schedule_id = ?`, [
    ...params,
    id,
  ]);
  if (affectedRows === 0) throw new ApiError(404, "Schedule slot not found");
}

/** sp_generate_rotation refuses while attendance rows exist. */
export async function generateRotation(start: string, end: string) {
  const rows = await callProc<{ result: string }>("sp_generate_rotation", [start, end]);
  return rows[0]?.result ?? "Rotation generated";
}

// ----------------------------------------------------------- attendance

/** Students due at an activity (via their group's rotation) and their status. */
export function roster(activityId: number, groupId?: number) {
  return query<RosterRow>(
    `SELECT p.p_id, s.s_id, s.s_usn, s.s_name, s.branch, g.g_id, g.g_name, sc.\`day\`,
            p.status, p.check_in_time, p.check_out_time,
            fn_session_minutes(p.check_in_time, p.check_out_time) AS minutes
     FROM   Schedule sc
     JOIN   bootstrap_group g ON g.g_id = sc.g_id
     JOIN   Student        s ON s.g_id = sc.g_id
     JOIN   Participates   p ON p.s_id = s.s_id AND p.a_id = sc.a_id
     WHERE  sc.a_id = ? ${groupId ? "AND sc.g_id = ?" : ""}
     ORDER  BY sc.\`day\`, s.s_usn`,
    groupId ? [activityId, groupId] : [activityId],
  );
}

export type AttendanceAction = "check_in" | "check_out" | "set_check_in" | "excuse" | "mark_absent";

/**
 * Applies one attendance change. Status for check-ins is never taken from
 * the caller: trg_part_set_status derives present/late from the clock and
 * trg_part_audit logs the change under the signed-in user's name.
 */
export async function applyAttendance(
  actor: string,
  studentId: number,
  activityId: number,
  action: AttendanceAction,
  time?: string,
) {
  return withConnection(
    async (conn) => {
      const run = async (sql: string, params: unknown[]) => {
        const [res] = await conn.query(sql, params);
        if ((res as { affectedRows: number }).affectedRows === 0) {
          throw new ApiError(404, "No participation record for that student and activity");
        }
      };
      switch (action) {
        case "check_in":
          await conn.query("CALL sp_check_in(?, ?)", [studentId, activityId]);
          break;
        case "check_out":
          await conn.query("CALL sp_check_out(?, ?)", [studentId, activityId]);
          break;
        case "set_check_in":
          // Keep the original date if there is one, otherwise use today.
          await run(
            `UPDATE Participates
             SET    check_in_time = TIMESTAMP(DATE(COALESCE(check_in_time, NOW())), ?),
                    check_out_time = NULL,
                    status = 'present'
             WHERE  s_id = ? AND a_id = ?`,
            [time, studentId, activityId],
          );
          break;
        case "excuse":
          await run(
            `UPDATE Participates SET status = 'excused', check_in_time = NULL, check_out_time = NULL
             WHERE s_id = ? AND a_id = ?`,
            [studentId, activityId],
          );
          break;
        case "mark_absent":
          await run(
            `UPDATE Participates SET status = 'absent', check_in_time = NULL, check_out_time = NULL
             WHERE s_id = ? AND a_id = ?`,
            [studentId, activityId],
          );
          break;
      }
      const [rows] = await conn.query(
        `SELECT status, check_in_time, check_out_time FROM Participates WHERE s_id = ? AND a_id = ?`,
        [studentId, activityId],
      );
      return (rows as Array<{ status: string; check_in_time: string | null; check_out_time: string | null }>)[0];
    },
    { appUser: actor },
  );
}

/** sp_mark_absentees: cursor that excuses everyone still absent. */
export async function excuseAbsentees(actor: string, activityId: number) {
  return withConnection(
    async (conn) => {
      const [result] = await conn.query("CALL sp_mark_absentees(?)", [activityId]);
      const first = (result as unknown[])[0] as Array<{ students_excused: number }>;
      return first?.[0]?.students_excused ?? 0;
    },
    { appUser: actor },
  );
}

export function auditLog(f: { q?: string; activityId?: number; limit: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    where.push("(l.s_name LIKE ? OR l.s_usn LIKE ? OR l.changed_by LIKE ?)");
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  if (f.activityId) {
    where.push("a.a_id = ?");
    params.push(f.activityId);
  }
  return query<AuditRow>(
    `SELECT l.log_id, l.changed_at, l.s_usn, l.s_name, l.activity, l.old_status, l.new_status, l.changed_by
     FROM   vw_attendance_audit l JOIN Activity a ON a.a_name = l.activity
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER  BY l.changed_at DESC, l.log_id DESC
     LIMIT  ?`,
    [...params, f.limit],
  );
}

// ------------------------------------------------------------- feedback

export type FeedbackFilters = {
  q?: string;
  mode: "natural" | "boolean";
  activityId?: number;
  minRating?: number;
  maxRating?: number;
  mentorId?: number; // restricts a mentor to their own activities
};

/**
 * Feedback list. With search terms it uses the FULLTEXT index
 * ft_feedback_comments in natural-language or boolean mode and ranks by
 * relevance.
 */
export function searchFeedback(f: FeedbackFilters) {
  const where: string[] = [];
  const params: unknown[] = [];
  let relevance = "NULL";
  const mode = f.mode === "boolean" ? "IN BOOLEAN MODE" : "IN NATURAL LANGUAGE MODE";
  if (f.q) {
    relevance = `MATCH(f.comments) AGAINST(? ${mode})`;
    where.push(`MATCH(f.comments) AGAINST(? ${mode})`);
  }
  if (f.activityId) {
    where.push("f.a_id = ?");
    params.push(f.activityId);
  }
  if (f.minRating) {
    where.push("f.rating >= ?");
    params.push(f.minRating);
  }
  if (f.maxRating) {
    where.push("f.rating <= ?");
    params.push(f.maxRating);
  }
  if (f.mentorId) {
    where.push("a.m_id = ?");
    params.push(f.mentorId);
  }
  const head = f.q ? [f.q, f.q] : [];
  return query<FeedbackRow>(
    `SELECT f.f_id, s.s_id, s.s_usn, s.s_name, a.a_id, a.a_name, f.rating, f.comments, f.\`time\`,
            ${relevance} AS relevance
     FROM   Feedback f
     JOIN   Student  s ON s.s_id = f.s_id
     JOIN   Activity a ON a.a_id = f.a_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER  BY ${f.q ? "relevance DESC" : "f.`time` DESC"}, f.f_id DESC
     LIMIT  200`,
    [...head, ...params],
  );
}

/** Rating distribution per activity (GROUP BY on two columns). */
export function ratingDistribution(mentorId?: number) {
  return query<{ a_id: number; a_name: string; rating: number; votes: number }>(
    `SELECT a.a_id, a.a_name, f.rating, COUNT(*) AS votes
     FROM   Feedback f JOIN Activity a ON a.a_id = f.a_id
     ${mentorId ? "WHERE a.m_id = ?" : ""}
     GROUP  BY a.a_id, a.a_name, f.rating
     ORDER  BY a.a_id, f.rating`,
    mentorId ? [mentorId] : [],
  );
}
