// MySQL integration tests: schema objects, constraints, triggers, functions,
// procedures and transactions. Run against a database built from the SQL
// scripts (npm run test:db). Changes are rolled back or cleaned up.
import type { PoolConnection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execute, pool, query, queryOne, withConnection } from "@/lib/mysql";
import { createMentor } from "@/lib/services/catalog";
import { applyAttendance, searchFeedback } from "@/lib/services/operations";
import { registerStudent, studentDashboard, transferStudent } from "@/lib/services/students";

type DbErr = { errno?: number; sqlMessage?: string };

/** Runs fn inside a transaction that is always rolled back. */
function inRollback<T>(fn: (c: PoolConnection) => Promise<T>, appUser?: string) {
  return withConnection(
    async (c) => {
      await c.beginTransaction();
      try {
        return await fn(c);
      } finally {
        await c.rollback();
      }
    },
    { appUser },
  );
}

async function expectDbError(p: Promise<unknown>, errno: number, message?: RegExp) {
  try {
    await p;
  } catch (err) {
    const e = err as DbErr;
    expect(e.errno).toBe(errno);
    if (message) expect(e.sqlMessage).toMatch(message);
    return;
  }
  throw new Error(`expected MySQL error ${errno}`);
}

let attended: { s_id: number; a_id: number; g_id: number };
let absent: { s_id: number; a_id: number };

beforeAll(async () => {
  attended = (await queryOne<{ s_id: number; a_id: number; g_id: number }>(
    `SELECT p.s_id, p.a_id, s.g_id FROM Participates p JOIN Student s ON s.s_id = p.s_id
     WHERE p.status IN ('present','late') ORDER BY p.p_id LIMIT 1`,
  ))!;
  absent = (await queryOne<{ s_id: number; a_id: number }>(
    "SELECT s_id, a_id FROM Participates WHERE status = 'absent' ORDER BY p_id LIMIT 1",
  ))!;
});

afterAll(async () => {
  await pool().end();
});

describe("schema", () => {
  it("has every table, view, routine and trigger", async () => {
    const counts = await query<{ kind: string; names: string }>(
      `SELECT 'table' AS kind, GROUP_CONCAT(table_name ORDER BY table_name) AS names FROM information_schema.tables
         WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
       UNION ALL SELECT 'view', GROUP_CONCAT(table_name ORDER BY table_name) FROM information_schema.views WHERE table_schema = DATABASE()
       UNION ALL SELECT 'trigger', GROUP_CONCAT(trigger_name ORDER BY trigger_name) FROM information_schema.triggers WHERE trigger_schema = DATABASE()
       UNION ALL SELECT 'routine', GROUP_CONCAT(routine_name ORDER BY routine_name) FROM information_schema.routines WHERE routine_schema = DATABASE()`,
    );
    const by = Object.fromEntries(counts.map((c) => [c.kind, c.names.toLowerCase().split(",")]));
    expect(by.table).toEqual(
      expect.arrayContaining(["activity", "appuser", "attendance_log", "bootstrap_group", "feedback", "mentor", "participates", "schedule", "student"]),
    );
    expect(by.view).toEqual(
      expect.arrayContaining(["vw_timetable", "vw_student_attendance", "vw_activity_stats", "vw_attendance_audit", "vw_student_schedule", "vw_group_stats"]),
    );
    expect(by.trigger).toHaveLength(12);
    expect(by.routine).toEqual(expect.arrayContaining(["fn_attendance_pct", "fn_risk_level", "sp_register_student", "sp_transfer_student"]));
  });

  it("keeps the rotation a 5 x 5 Latin square", async () => {
    const rows = await query<{ day: number; g_id: number; a_id: number }>("SELECT `day`, g_id, a_id FROM Schedule");
    expect(rows).toHaveLength(25);
    for (const r of rows) expect(r.a_id).toBe(((r.g_id - 1 + r.day - 1) % 5) + 1);
    const pairs = new Set(rows.map((r) => `${r.g_id}-${r.a_id}`));
    expect(pairs.size).toBe(25); // every group meets every activity exactly once
  });

  it("uses the composite index for group + branch lookups", async () => {
    const plan = await query<{ key: string | null }>("EXPLAIN SELECT * FROM Student WHERE g_id = 2 AND branch = 'Electronics'");
    expect(plan[0].key).toBe("ix_student_group_branch");
  });
});

describe("functions and views", () => {
  it("fn_session_minutes and fn_scheduled_day", async () => {
    const [r] = await query<{ mins: number; day: number; none: number | null }>(
      `SELECT fn_session_minutes('2026-10-05 09:10:00', '2026-10-05 16:30:00') AS mins,
              fn_scheduled_day(3, 5) AS day, fn_session_minutes(NULL, NOW()) AS none`,
    );
    expect(r.mins).toBe(440);
    expect(r.day).toBe(3); // ((3-1 + d-1) mod 5) + 1 = 5  =>  d = 3
    expect(r.none).toBeNull();
  });

  it("fn_attendance_pct and fn_risk_level agree with the raw rows", async () => {
    const rows = await query<{ s_id: number; pct: number; risk: string; manual: number }>(
      `SELECT s.s_id, fn_attendance_pct(s.s_id) AS pct, fn_risk_level(s.s_id) AS risk,
              ROUND(100 * SUM(p.status IN ('present','late')) / COUNT(*), 2) AS manual
       FROM Student s JOIN Participates p ON p.s_id = s.s_id GROUP BY s.s_id`,
    );
    for (const r of rows) {
      expect(r.pct).toBeCloseTo(r.manual, 2);
      expect(r.risk).toBe(r.pct >= 80 ? "LOW" : r.pct >= 60 ? "MEDIUM" : "HIGH");
    }
  });

  it("vw_student_schedule gives each student five sessions", async () => {
    const rows = await query<{ s_id: number; n: number }>("SELECT s_id, COUNT(*) AS n FROM vw_student_schedule GROUP BY s_id");
    expect(rows.every((r) => r.n === 5)).toBe(true);
  });

  it("ranks a student inside their group with window functions", async () => {
    const d = await studentDashboard(attended.s_id);
    expect(d.groupRank!.rank_in_group).toBeGreaterThanOrEqual(1);
    expect(d.groupRank!.rank_in_group).toBeLessThanOrEqual(d.groupRank!.group_size);
    expect(d.schedule).toHaveLength(5);
  });
});

describe("CHECK constraints", () => {
  it("rejects out-of-range values", () =>
    inRollback(async (c) => {
      await expectDbError(c.query("UPDATE Feedback SET rating = 6 LIMIT 1"), 3819, /chk_fb_rating/);
      await expectDbError(c.query("UPDATE Student SET semester = 9 LIMIT 1"), 3819, /chk_student_semester/);
      await expectDbError(c.query("UPDATE Activity SET capacity = 0 WHERE a_id = 1"), 3819, /chk_activity_capacity/);
      await expectDbError(c.query("UPDATE Activity SET capacity = 600 WHERE a_id = 1"), 3819, /chk_capacity_max/);
      await expectDbError(c.query("UPDATE Schedule SET end_time = '08:00:00' WHERE schedule_id = 1"), 3819, /chk_schedule_times/);
      await expectDbError(
        c.query("UPDATE Participates SET status = 'absent' WHERE s_id = ? AND a_id = ?", [attended.s_id, attended.a_id]),
        3819,
        /chk_part_absent/,
      );
      await expectDbError(c.query("UPDATE Mentor SET phone = '123' LIMIT 1"), 3819, /chk_phone_len/);
    }));

  it("refuses plaintext passwords and mismatched account links", () =>
    inRollback(async (c) => {
      await expectDbError(c.query("INSERT INTO AppUser (username, password_hash, role) VALUES ('x@y.z', 'plain', 'admin')"), 3819);
      const hash = "$2b$10$e5TGef/WEEtC9/q.pg2YEezhLBPL8D38OZj3rgTBwPQsXucW69jF6";
      await expectDbError(
        c.query("INSERT INTO AppUser (username, password_hash, role, s_id) VALUES ('x@y.z', ?, 'mentor', 1)", [hash]),
        1644,
        /mentor account/,
      );
      await expectDbError(
        c.query("INSERT INTO AppUser (username, password_hash, role, m_id) VALUES ('x@y.z', ?, 'admin', 1)", [hash]),
        1644,
        /admin account/,
      );
    }));
});

describe("triggers", () => {
  it("trg_part_set_status derives late/present from the clock and trg_part_audit logs it", () =>
    inRollback(async (c) => {
      const [[slot]] = (await c.query("SELECT start_time FROM Schedule WHERE g_id = ? AND a_id = ?", [attended.g_id, attended.a_id])) as [
        Array<{ start_time: string }>,
        unknown,
      ];
      const set = (offsetMin: number) =>
        c.query(
          `UPDATE Participates SET check_in_time = TIMESTAMP('2026-10-05', ADDTIME(?, SEC_TO_TIME(? * 60))), status = 'present'
           WHERE s_id = ? AND a_id = ?`,
          [slot.start_time, offsetMin, attended.s_id, attended.a_id],
        );
      const status = async () =>
        ((await c.query("SELECT status FROM Participates WHERE s_id = ? AND a_id = ?", [attended.s_id, attended.a_id])) as [
          Array<{ status: string }>,
          unknown,
        ])[0][0].status;

      await set(25);
      expect(await status()).toBe("late");
      await set(5);
      expect(await status()).toBe("present");

      const [[log]] = (await c.query(
        "SELECT old_status, new_status, changed_by FROM attendance_log WHERE s_id = ? AND a_id = ? ORDER BY log_id DESC LIMIT 1",
        [attended.s_id, attended.a_id],
      )) as [Array<{ old_status: string; new_status: string; changed_by: string }>, unknown];
      expect(log).toEqual({ old_status: "late", new_status: "present", changed_by: "tester@univ.edu" });
    }, "tester@univ.edu"));

  it("trg_part_validate enforces per-group capacity", () =>
    inRollback(async (c) => {
      await c.query("UPDATE Activity SET capacity = 1 WHERE a_id = ?", [attended.a_id]);
      await expectDbError(
        c.query("INSERT INTO Participates (s_id, a_id) VALUES (?, ?)", [attended.s_id, attended.a_id]),
        1644,
        /capacity/,
      );
    }));

  it("trg_feedback_validate rejects absent students", () =>
    inRollback(async (c) => {
      await c.query("DELETE FROM Feedback WHERE s_id = ? AND a_id = ?", [absent.s_id, absent.a_id]);
      await expectDbError(
        c.query("INSERT INTO Feedback (s_id, a_id, rating) VALUES (?, ?, 4)", [absent.s_id, absent.a_id]),
        1644,
        /attended/,
      );
    }));

  it("trg_student_protect blocks deleting a student with attendance", () =>
    inRollback(async (c) => {
      await expectDbError(c.query("DELETE FROM Student WHERE s_id = ?", [attended.s_id]), 1644, /recorded attendance/);
    }));

  it("room clash triggers cover INSERT and UPDATE", () =>
    inRollback(async (c) => {
      const [[a, b]] = (await c.query("SELECT schedule_id, room FROM Schedule WHERE `day` = 2 ORDER BY g_id LIMIT 2")) as [
        Array<{ schedule_id: number; room: string }>,
        unknown,
      ];
      await expectDbError(c.query("UPDATE Schedule SET room = ? WHERE schedule_id = ?", [b.room, a.schedule_id]), 1644, /room/);
      await expectDbError(
        c.query("INSERT INTO Schedule (`day`, start_time, end_time, room, a_id, g_id) VALUES (2, '09:00', '10:00', ?, 1, 1)", [b.room]),
        1644,
        /room/,
      );
    }));

  it("trg_student_email_sync keeps the login in step", () =>
    inRollback(async (c) => {
      await c.query("UPDATE Student SET email = 'moved@univ.edu' WHERE s_id = ?", [attended.s_id]);
      const [[u]] = (await c.query("SELECT username FROM AppUser WHERE s_id = ?", [attended.s_id])) as [Array<{ username: string }>, unknown];
      expect(u.username).toBe("moved@univ.edu");
    }));
});

describe("procedures and transactions", () => {
  const usn = `9TS${String(Date.now()).slice(-7)}`;
  const email = `${usn.toLowerCase()}@test.univ.edu`;

  it("sp_register_student creates the student, five participation rows and a login atomically", async () => {
    const id = await registerStudent({
      usn,
      name: "Integration Test",
      email,
      branch: "Testing",
      semester: 1,
      groupId: 1,
      password: "Welcome123",
    });
    try {
      const [p] = await query<{ n: number }>("SELECT COUNT(*) AS n FROM Participates WHERE s_id = ? AND status = 'absent'", [id]);
      expect(p.n).toBe(5);
      const u = await queryOne<{ role: string }>("SELECT role FROM AppUser WHERE s_id = ?", [id]);
      expect(u?.role).toBe("student");

      // sp_transfer_student moves the student and rebuilds participation.
      expect(await transferStudent(id, 3)).toMatch(/moved from group 1 to 3/);
      const s = await queryOne<{ g_id: number }>("SELECT g_id FROM Student WHERE s_id = ?", [id]);
      expect(s?.g_id).toBe(3);
      await expectDbError(transferStudent(id, 3), 1644, /already in that group/);
    } finally {
      await execute("DELETE FROM Student WHERE s_id = ?", [id]); // no attendance, so allowed
    }
  });

  it("sp_register_student rolls back everything on a duplicate", async () => {
    const before = await query<{ s: number; u: number }>("SELECT (SELECT COUNT(*) FROM Student) AS s, (SELECT COUNT(*) FROM AppUser) AS u");
    // A mentor's email is free in Student but taken in AppUser, so the third
    // insert fails and must undo the Student and Participates inserts.
    const mentor = await queryOne<{ username: string }>("SELECT username FROM AppUser WHERE role = 'mentor' LIMIT 1");
    await expectDbError(
      registerStudent({ usn, name: "Dup Test", email: mentor!.username, branch: "T", semester: 1, groupId: 1, password: "Welcome123" }),
      1062,
      /appuser\.username/i,
    );
    expect(await queryOne("SELECT s_id FROM Student WHERE s_usn = ?", [usn])).toBeNull();
    const after = await query<{ s: number; u: number }>("SELECT (SELECT COUNT(*) FROM Student) AS s, (SELECT COUNT(*) FROM AppUser) AS u");
    expect(after).toEqual(before);
  });

  it("an application transaction rolls the mentor back when the login insert fails", async () => {
    const before = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM Mentor");
    await expectDbError(
      createMentor({ name: "Rollback Mentor", email: "admin@univ.edu", password: "Mentor1234" }),
      1062,
    );
    const after = await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM Mentor");
    expect(after?.n).toBe(before?.n);
  });

  it("sp_submit_feedback upserts one rating per student and activity", () =>
    inRollback(async (c) => {
      await c.query("CALL sp_submit_feedback(?, ?, 2, 'first')", [attended.s_id, attended.a_id]);
      await c.query("CALL sp_submit_feedback(?, ?, 5, 'changed my mind')", [attended.s_id, attended.a_id]);
      const [rows] = (await c.query("SELECT rating, comments FROM Feedback WHERE s_id = ? AND a_id = ?", [attended.s_id, attended.a_id])) as [
        Array<{ rating: number; comments: string }>,
        unknown,
      ];
      expect(rows).toEqual([{ rating: 5, comments: "changed my mind" }]);
    }));

  it("sp_mark_absentees excuses every remaining absentee (cursor)", () =>
    inRollback(async (c) => {
      const [res] = (await c.query("CALL sp_mark_absentees(?)", [absent.a_id])) as [Array<Array<{ students_excused: number }>>, unknown];
      expect(res[0][0].students_excused).toBeGreaterThan(0);
      const [[left]] = (await c.query("SELECT COUNT(*) AS n FROM Participates WHERE a_id = ? AND status = 'absent'", [absent.a_id])) as [
        Array<{ n: number }>,
        unknown,
      ];
      expect(left.n).toBe(0);
    }));

  it("sp_generate_rotation refuses while attendance exists", async () => {
    await expectDbError(query("CALL sp_generate_rotation('09:00:00', '16:30:00')"), 1644, /attendance rows exist/);
  });

  it("applyAttendance records the acting user in the audit log", async () => {
    const before = await queryOne<{ status: string; check_in_time: string | null; check_out_time: string | null }>(
      "SELECT status, check_in_time, check_out_time FROM Participates WHERE s_id = ? AND a_id = ?",
      [absent.s_id, absent.a_id],
    );
    const lastLog = (await queryOne<{ id: number }>("SELECT COALESCE(MAX(log_id), 0) AS id FROM attendance_log"))!.id;
    try {
      const rec = await applyAttendance("auditor@univ.edu", absent.s_id, absent.a_id, "excuse");
      expect(rec.status).toBe("excused");
      const log = await queryOne<{ changed_by: string }>(
        "SELECT changed_by FROM attendance_log WHERE s_id = ? AND a_id = ? ORDER BY log_id DESC LIMIT 1",
        [absent.s_id, absent.a_id],
      );
      expect(log?.changed_by).toBe("auditor@univ.edu");
    } finally {
      await execute("UPDATE Participates SET status = ?, check_in_time = ?, check_out_time = ? WHERE s_id = ? AND a_id = ?", [
        before!.status,
        before!.check_in_time,
        before!.check_out_time,
        absent.s_id,
        absent.a_id,
      ]);
      // The restoring UPDATE is audited too; drop every row this test produced.
      await execute("DELETE FROM attendance_log WHERE log_id > ? AND s_id = ?", [lastLog, absent.s_id]);
    }
  });
});

describe("full-text search", () => {
  it("ranks natural-language matches by relevance", async () => {
    const rows = await searchFeedback({ q: "crowded equipment lab", mode: "natural" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].comments).toMatch(/crowded/i);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].relevance!).toBeGreaterThanOrEqual(rows[i].relevance!);
  });

  it("supports boolean operators", async () => {
    const rows = await searchFeedback({ q: "+mentor -rushed", mode: "boolean" });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.comments).toMatch(/mentor/i);
      expect(r.comments).not.toMatch(/rushed/i);
    }
  });
});
