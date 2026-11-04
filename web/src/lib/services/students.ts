import { ApiError } from "../api";
import { callProc, execute, query, queryOne, withConnection } from "../mysql";
import type { ScheduleItem, StudentDashboard, StudentRow } from "../types";
import { hashPassword } from "./auth";

const STUDENT_COLUMNS = `v.s_id, v.s_usn, v.s_name, s.email, v.branch, s.semester, s.g_id, v.colour_group,
       v.sessions, v.present, v.late_arrivals, v.absent, v.excused, v.attendance_pct, v.risk`;

export type StudentFilters = {
  q?: string;
  groupId?: number;
  branch?: string;
  semester?: number;
  risk?: "LOW" | "MEDIUM" | "HIGH";
  sort: "name" | "usn" | "attendance" | "group";
};

const SORTS: Record<StudentFilters["sort"], string> = {
  name: "v.s_name",
  usn: "v.s_usn",
  attendance: "v.attendance_pct DESC, v.s_name",
  group: "v.colour_group, v.s_name",
};

/** Students with their attendance summary (vw_student_attendance). */
export async function listStudents(f: StudentFilters): Promise<StudentRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.q) {
    where.push("(v.s_name LIKE ? OR v.s_usn LIKE ? OR s.email LIKE ?)");
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  if (f.groupId) {
    where.push("s.g_id = ?");
    params.push(f.groupId);
  }
  if (f.branch) {
    where.push("v.branch = ?");
    params.push(f.branch);
  }
  if (f.semester) {
    where.push("s.semester = ?");
    params.push(f.semester);
  }
  if (f.risk) {
    where.push("v.risk = ?");
    params.push(f.risk);
  }
  return query<StudentRow>(
    `SELECT ${STUDENT_COLUMNS}
     FROM   vw_student_attendance v
     JOIN   Student s ON s.s_id = v.s_id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER  BY ${SORTS[f.sort]}`,
    params,
  );
}

export async function getStudent(id: number): Promise<StudentRow> {
  const row = await queryOne<StudentRow>(
    `SELECT ${STUDENT_COLUMNS} FROM vw_student_attendance v JOIN Student s ON s.s_id = v.s_id WHERE v.s_id = ?`,
    [id],
  );
  if (!row) throw new ApiError(404, "Student not found");
  return row;
}

export async function listBranches(): Promise<string[]> {
  const rows = await query<{ branch: string }>(
    "SELECT DISTINCT branch FROM Student WHERE branch IS NOT NULL ORDER BY branch",
  );
  return rows.map((r) => r.branch);
}

type NewStudent = {
  usn: string;
  name: string;
  email: string;
  branch: string;
  semester: number;
  groupId: number;
  password: string;
};

/**
 * Enrols a student with a login through sp_register_student: the Student
 * row, five Participates rows and the AppUser row commit or roll back
 * together. The OUT parameter is read on the same connection.
 */
export async function registerStudent(input: NewStudent): Promise<number> {
  const hash = await hashPassword(input.password);
  return withConnection(async (conn) => {
    await conn.query("CALL sp_register_student(?, ?, ?, ?, ?, ?, ?, @new_s_id)", [
      input.usn,
      input.name,
      input.email,
      input.branch,
      input.semester,
      input.groupId,
      hash,
    ]);
    const [rows] = await conn.query("SELECT @new_s_id AS s_id");
    return Number((rows as Array<{ s_id: number }>)[0].s_id);
  });
}

export async function updateStudent(
  id: number,
  patch: Partial<{ name: string; email: string; branch: string; semester: number }>,
) {
  const columns: Record<string, string> = { name: "s_name", email: "email", branch: "branch", semester: "semester" };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(columns)) {
    const value = patch[key as keyof typeof patch];
    if (value !== undefined) {
      sets.push(`${col} = ?`);
      params.push(value);
    }
  }
  const { affectedRows } = await execute(`UPDATE Student SET ${sets.join(", ")} WHERE s_id = ?`, [...params, id]);
  if (affectedRows === 0) throw new ApiError(404, "Student not found");
}

/** trg_student_protect refuses this when the student has attendance. */
export async function deleteStudent(id: number) {
  const { affectedRows } = await execute("DELETE FROM Student WHERE s_id = ?", [id]);
  if (affectedRows === 0) throw new ApiError(404, "Student not found");
}

/** sp_transfer_student: row lock, savepoint, rebuilds participation rows. */
export async function transferStudent(id: number, groupId: number) {
  const rows = await callProc<{ result: string }>("sp_transfer_student", [id, groupId]);
  return rows[0]?.result ?? "Transferred";
}

export async function studentDashboard(sId: number): Promise<StudentDashboard> {
  const profile = await queryOne<StudentDashboard["profile"]>(
    `SELECT s.s_id, s.s_usn, s.s_name, s.email, s.branch, s.semester, s.g_id, g.g_name, u.last_login
     FROM   Student s
     JOIN   bootstrap_group g ON g.g_id = s.g_id
     LEFT JOIN AppUser u     ON u.s_id = s.s_id
     WHERE  s.s_id = ?`,
    [sId],
  );
  if (!profile) throw new ApiError(404, "Student not found");

  const [stats, schedule, groupRank] = await Promise.all([
    getStudent(sId),
    query<ScheduleItem>(
      `SELECT schedule_id, \`day\`, a_id, activity, room, start_time, end_time, mentor, status,
              check_in_time, check_out_time, minutes, rating, comments
       FROM   vw_student_schedule WHERE s_id = ? ORDER BY \`day\``,
      [sId],
    ),
    // Window functions: position inside the colour group and the group average.
    queryOne<StudentDashboard["groupRank"]>(
      `SELECT rank_in_group, group_size, group_avg_pct FROM (
         SELECT s.s_id,
                RANK()   OVER (PARTITION BY s.g_id ORDER BY v.attendance_pct DESC) AS rank_in_group,
                COUNT(*) OVER (PARTITION BY s.g_id)                                  AS group_size,
                ROUND(AVG(v.attendance_pct) OVER (PARTITION BY s.g_id), 2)           AS group_avg_pct
         FROM   Student s JOIN vw_student_attendance v ON v.s_id = s.s_id
       ) ranked WHERE s_id = ?`,
      [sId],
    ),
  ]);
  return { profile, stats, schedule, groupRank };
}

/** sp_submit_feedback upserts; trg_feedback_validate rejects non-attenders. */
export async function submitFeedback(sId: number, aId: number, rating: number, comments?: string) {
  await callProc("sp_submit_feedback", [sId, aId, rating, comments || null]);
}
