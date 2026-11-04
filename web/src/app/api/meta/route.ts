import { handle, json } from "@/lib/api";
import { requireUser } from "@/lib/auth/guard";
import { query } from "@/lib/mysql";
import { listBranches } from "@/lib/services/students";

// Lookup lists for forms and filters.
export const GET = handle(async (req) => {
  await requireUser(req);
  const [groups, activities, mentors, branches] = await Promise.all([
    query<{ g_id: number; g_name: string }>("SELECT g_id, g_name FROM bootstrap_group ORDER BY g_id"),
    query<{ a_id: number; a_name: string; m_id: number | null }>("SELECT a_id, a_name, m_id FROM Activity ORDER BY a_id"),
    query<{ m_id: number; m_name: string }>("SELECT m_id, m_name FROM Mentor ORDER BY m_name"),
    listBranches(),
  ]);
  return json({ groups, activities, mentors, branches });
});
