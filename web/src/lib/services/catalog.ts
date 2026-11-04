import { ApiError } from "../api";
import { callProc, execute, query, queryOne, transaction } from "../mysql";
import type { ActivityStats, GroupStats, MentorRow } from "../types";
import { hashPassword } from "./auth";

// ---------------------------------------------------------------- groups

export function listGroups() {
  return query<GroupStats>("SELECT * FROM vw_group_stats ORDER BY g_id");
}

export async function renameGroup(id: number, name: string) {
  const { affectedRows } = await execute("UPDATE bootstrap_group SET g_name = ? WHERE g_id = ?", [name, id]);
  if (affectedRows === 0) throw new ApiError(404, "Group not found");
}

/** sp_group_report: day-by-day attendance for one colour group. */
export function groupReport(id: number) {
  return callProc<{
    day: number;
    a_name: string;
    room: string | null;
    enrolled: number;
    present: number;
    late_arrivals: number;
    absent: number;
    attendance_pct: number;
    avg_rating: number;
  }>("sp_group_report", [id]);
}

// --------------------------------------------------------------- mentors

export function listMentors() {
  // LEFT JOINs keep mentors who have no activity or no login.
  return query<MentorRow>(
    `SELECT m.m_id, m.m_name, m.dept, m.designation, m.email, m.phone,
            GROUP_CONCAT(a.a_name ORDER BY a.a_name SEPARATOR ', ') AS activities,
            (u.user_id IS NOT NULL) AS has_login
     FROM   Mentor m
     LEFT JOIN Activity a ON a.m_id = m.m_id
     LEFT JOIN AppUser  u ON u.m_id = m.m_id
     GROUP  BY m.m_id, m.m_name, m.dept, m.designation, m.email, m.phone, u.user_id
     ORDER  BY m.m_name`,
  );
}

type NewMentor = { name: string; dept?: string; designation?: string; email: string; phone?: string; password?: string };

/** Mentor row and (optionally) their login, in one application transaction. */
export async function createMentor(input: NewMentor): Promise<number> {
  const hash = input.password ? await hashPassword(input.password) : null;
  return transaction(async (conn) => {
    const [res] = await conn.query(
      "INSERT INTO Mentor (m_name, dept, designation, email, phone) VALUES (?, ?, ?, ?, ?)",
      [input.name, input.dept || null, input.designation || null, input.email, input.phone || null],
    );
    const mId = (res as { insertId: number }).insertId;
    if (hash) {
      await conn.query("INSERT INTO AppUser (username, password_hash, role, m_id) VALUES (?, ?, 'mentor', ?)", [
        input.email,
        hash,
        mId,
      ]);
    }
    return mId;
  });
}

export async function updateMentor(
  id: number,
  patch: Partial<{ name: string; dept: string | null; designation: string | null; email: string; phone: string | null }>,
) {
  const columns: Record<string, string> = {
    name: "m_name",
    dept: "dept",
    designation: "designation",
    email: "email",
    phone: "phone",
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(columns)) {
    const value = patch[key as keyof typeof patch];
    if (value !== undefined) {
      sets.push(`${col} = ?`);
      params.push(value === "" ? null : value);
    }
  }
  const { affectedRows } = await execute(`UPDATE Mentor SET ${sets.join(", ")} WHERE m_id = ?`, [...params, id]);
  if (affectedRows === 0) throw new ApiError(404, "Mentor not found");
}

/** Activity.m_id is ON DELETE SET NULL; the mentor's login cascades away. */
export async function deleteMentor(id: number) {
  const { affectedRows } = await execute("DELETE FROM Mentor WHERE m_id = ?", [id]);
  if (affectedRows === 0) throw new ApiError(404, "Mentor not found");
}

// ------------------------------------------------------------ activities

const ACTIVITY_SELECT = `
  SELECT v.a_id, v.a_name, v.capacity, a.description, a.m_id, v.mentor, v.enrolled, v.attended,
         v.attendance_pct, v.avg_rating, v.responses
  FROM   vw_activity_stats v JOIN Activity a ON a.a_id = v.a_id`;

export function listActivities(mentorId?: number) {
  if (mentorId) return query<ActivityStats>(`${ACTIVITY_SELECT} WHERE a.m_id = ? ORDER BY v.a_id`, [mentorId]);
  return query<ActivityStats>(`${ACTIVITY_SELECT} ORDER BY v.a_id`);
}

export async function getActivity(id: number) {
  const row = await queryOne<ActivityStats>(`${ACTIVITY_SELECT} WHERE v.a_id = ?`, [id]);
  if (!row) throw new ApiError(404, "Activity not found");
  return row;
}

/** Full-text search over activity name + description (ft_activity_text). */
export function searchActivities(terms: string) {
  return query<{ a_id: number; a_name: string; description: string | null; relevance: number }>(
    `SELECT a_id, a_name, description, MATCH(a_name, description) AGAINST(?) AS relevance
     FROM   Activity WHERE MATCH(a_name, description) AGAINST(?)
     ORDER  BY relevance DESC`,
    [terms, terms],
  );
}

export async function updateActivity(
  id: number,
  patch: Partial<{ name: string; capacity: number; description: string | null; mentorId: number | null }>,
) {
  const columns: Record<string, string> = { name: "a_name", capacity: "capacity", description: "description", mentorId: "m_id" };
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(columns)) {
    const value = patch[key as keyof typeof patch];
    if (value !== undefined) {
      sets.push(`${col} = ?`);
      params.push(value === "" ? null : value);
    }
  }
  const { affectedRows } = await execute(`UPDATE Activity SET ${sets.join(", ")} WHERE a_id = ?`, [...params, id]);
  if (affectedRows === 0) throw new ApiError(404, "Activity not found");
}

/** Throws 403 unless the mentor runs this activity. */
export async function assertMentorOwnsActivity(mentorId: number, activityId: number) {
  const row = await queryOne("SELECT 1 FROM Activity WHERE a_id = ? AND m_id = ?", [activityId, mentorId]);
  if (!row) throw new ApiError(403, "You are not the mentor of that activity");
}
