// End-to-end API tests over HTTP against a running app:
//   npm run build && npm start      (or npm run dev)
//   APP_URL=http://localhost:3000 npm run test:e2e
// Covers authentication, role-based access, validation, database rule
// errors and a workflow that spans MySQL and Neo4j. Test data is removed
// afterwards through the MySQL connection configured in .env.local.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execute, pool, queryOne } from "@/lib/mysql";
import { closeNeo4j } from "@/lib/neo4j";

const BASE = process.env.APP_URL ?? "http://localhost:3000";

type Res = { status: number; body: Record<string, unknown>; headers: Headers };

async function call(path: string, opts: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> } = {}): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    redirect: "manual",
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* pages return HTML */
  }
  return { status: res.status, body, headers: res.headers };
}

async function login(email: string, password: string) {
  const res = await call("/api/auth/login", { method: "POST", body: { email, password } });
  expect(res.status).toBe(200);
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=lax/i);
  return cookie.split(";")[0];
}

const until = async (check: () => Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

let admin = "";
let mentor = "";
let student = "";
let studentId = 0;
let mentorActivity = 0;

beforeAll(async () => {
  admin = await login("admin@univ.edu", "Admin@123");
  mentor = await login("priya.iyer@univ.edu", "Mentor@123");
  student = await login("aarav.sharma@univ.edu", "Student@123");
  studentId = ((await call("/api/auth/me", { cookie: student })).body.user as { sId: number }).sId;
  mentorActivity = ((await call("/api/activities?mine=1", { cookie: mentor })).body.activities as Array<{ a_id: number }>)[0].a_id;
});

afterAll(async () => {
  await closeNeo4j();
  await pool().end();
});

describe("authentication", () => {
  it("health is public and reports both databases", async () => {
    const r = await call("/api/health");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ mysql: true, neo4j: true });
  });

  it("rejects missing or bad credentials", async () => {
    expect((await call("/api/students")).status).toBe(401);
    expect((await call("/api/auth/login", { method: "POST", body: { email: "admin@univ.edu", password: "wrong" } })).status).toBe(401);
    expect((await call("/api/auth/login", { method: "POST", body: { email: `nobody${Date.now()}@univ.edu`, password: "x" } })).status).toBe(401);
    expect((await call("/api/auth/login", { method: "POST", body: { email: "not-an-email" } })).status).toBe(400);
    expect((await call("/api/students", { cookie: "bootstrap_session=forged.token.value" })).status).toBe(401);
  });

  it("locks an email out after five failed attempts", async () => {
    const email = `guess${Date.now()}@univ.edu`;
    for (let i = 0; i < 5; i++) {
      expect((await call("/api/auth/login", { method: "POST", body: { email, password: `try${i}` } })).status).toBe(401);
    }
    const locked = await call("/api/auth/login", { method: "POST", body: { email, password: "try5" } });
    expect(locked.status).toBe(429);
  });

  it("redirects signed-out page requests to /login", async () => {
    const r = await call("/admin");
    expect([302, 307]).toContain(r.status);
    expect(r.headers.get("location")).toMatch(/\/login\?next=%2Fadmin/);
  });

  it("does not return password hashes", async () => {
    const r = await call("/api/auth/me", { cookie: admin });
    expect(JSON.stringify(r.body)).not.toMatch(/\$2[aby]\$/);
  });
});

describe("role-based access", () => {
  it.each([
    ["student", "/api/students", 403],
    ["student", "/api/stats/overview", 403],
    ["student", "/api/attendance/audit", 403],
    ["mentor", "/api/stats/overview", 403],
    ["mentor", "/api/mentors", 403],
    ["admin", "/api/stats/overview", 200],
    ["mentor", "/api/feedback", 200],
    ["student", "/api/me/dashboard", 200],
  ])("%s GET %s -> %i", async (role, path, status) => {
    const cookie = role === "admin" ? admin : role === "mentor" ? mentor : student;
    expect((await call(path, { cookie })).status).toBe(status);
  });

  it("keeps students to their own data", async () => {
    const other = studentId === 1 ? 2 : 1;
    expect((await call(`/api/students/${other}`, { cookie: student })).status).toBe(403);
    expect((await call(`/api/graph/recommendations?studentId=${other}`, { cookie: student })).status).toBe(403);
    expect((await call(`/api/students/${studentId}`, { cookie: student })).status).toBe(200);
  });

  it("keeps mentors to their own activities", async () => {
    const other = mentorActivity === 1 ? 2 : 1;
    expect((await call(`/api/activities/${other}/roster`, { cookie: mentor })).status).toBe(403);
    const r = await call("/api/attendance", { method: "POST", cookie: mentor, body: { studentId, activityId: other, action: "excuse" } });
    expect(r.status).toBe(403);
    const fb = (await call("/api/feedback", { cookie: mentor })).body.feedback as Array<{ a_id: number }>;
    expect(fb.every((f) => f.a_id === mentorActivity)).toBe(true);
  });

  it("redirects a student away from admin pages", async () => {
    const r = await call("/admin", { cookie: student });
    expect(r.headers.get("location")).toMatch(/\/student$/);
  });

  it("rejects cross-site writes", async () => {
    const r = await call("/api/graph/sync", { method: "POST", cookie: admin, headers: { origin: "http://evil.example" } });
    expect(r.status).toBe(403);
  });
});

describe("validation and database rules", () => {
  it("validates input before touching the database", async () => {
    expect((await call("/api/me/feedback", { method: "POST", cookie: student, body: { activityId: 1, rating: 9 } })).status).toBe(400);
    expect((await call("/api/students/abc", { cookie: admin })).status).toBe(400);
    expect((await call("/api/activities/5", { method: "PATCH", cookie: admin, body: { capacity: 900 } })).status).toBe(400);
    const bad = await call("/api/students", { method: "POST", cookie: admin, body: "not json" as unknown });
    expect(bad.status).toBe(400);
  });

  it("surfaces trigger and procedure rules as 409", async () => {
    const del = await call(`/api/students/${studentId}`, { method: "DELETE", cookie: admin });
    expect(del.status).toBe(409);
    expect(del.body.error).toMatch(/recorded attendance/);

    const regen = await call("/api/schedule/generate", { method: "POST", cookie: admin, body: { startTime: "09:00", endTime: "16:30" } });
    expect(regen.status).toBe(409);

    const slots = (await call("/api/schedule", { cookie: admin })).body.slots as Array<{ schedule_id: number; day: number; room: string }>;
    const [a, b] = slots.filter((s) => s.day === 3);
    const clash = await call(`/api/schedule/${a.schedule_id}`, { method: "PATCH", cookie: admin, body: { room: b.room } });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/room is already booked/);

    const absentRow = await queryOne<{ a_id: number }>("SELECT a_id FROM Participates WHERE s_id = ? AND status IN ('absent','excused') LIMIT 1", [studentId]);
    if (absentRow) {
      const fb = await call("/api/me/feedback", { method: "POST", cookie: student, body: { activityId: absentRow.a_id, rating: 4 } });
      expect(fb.status).toBe(409);
    }
  });
});

describe("workflows", () => {
  it("admin enrols a student who can then sign in, and removes them again", async () => {
    const usn = `9E2E${String(Date.now()).slice(-6)}`;
    const email = `${usn.toLowerCase()}@test.univ.edu`;
    const created = await call("/api/students", {
      method: "POST",
      cookie: admin,
      body: { usn, name: "End To End", email, branch: "Testing", semester: 2, groupId: 2, password: "Welcome123" },
    });
    expect(created.status).toBe(201);
    const id = created.body.s_id as number;
    try {
      expect((await call("/api/students", { method: "POST", cookie: admin, body: { usn, name: "Dup", email: `x${email}`, branch: "Testing", semester: 1, groupId: 1, password: "Welcome123" } })).status).toBe(409);
      const cookie = await login(email, "Welcome123");
      const dash = await call("/api/me/dashboard", { cookie });
      expect((dash.body.schedule as unknown[]).length).toBe(5);
      const moved = await call(`/api/students/${id}/transfer`, { method: "POST", cookie: admin, body: { groupId: 4 } });
      expect(moved.body.message).toMatch(/moved from group 2 to 4/);
    } finally {
      expect((await call(`/api/students/${id}`, { method: "DELETE", cookie: admin })).status).toBe(200);
    }
    expect((await call("/api/auth/login", { method: "POST", body: { email, password: "Welcome123" } })).status).toBe(401);
  });

  it("mentor attendance changes are audited under the mentor's name", async () => {
    const row = await queryOne<{ s_id: number; status: string; check_in_time: string | null; check_out_time: string | null }>(
      "SELECT s_id, status, check_in_time, check_out_time FROM Participates WHERE a_id = ? AND status = 'present' LIMIT 1",
      [mentorActivity],
    );
    const lastLog = (await queryOne<{ id: number }>("SELECT COALESCE(MAX(log_id), 0) AS id FROM attendance_log"))!.id;
    try {
      // A check-in after the recorded 16:30 check-out violates chk_part_times.
      const late = await call("/api/attendance", {
        method: "POST",
        cookie: mentor,
        body: { studentId: row!.s_id, activityId: mentorActivity, action: "set_check_in", time: "23:59" },
      });
      expect(late.status).toBe(400);
      expect(late.body.error).toMatch(/Check-out cannot be before check-in/);

      const r = await call("/api/attendance", {
        method: "POST",
        cookie: mentor,
        body: { studentId: row!.s_id, activityId: mentorActivity, action: "set_check_in", time: "09:40" },
      });
      expect(r.status).toBe(200);
      expect((r.body.record as { status: string }).status).toBe("late"); // derived by trg_part_set_status
      const audit = await call("/api/attendance/audit?limit=5", { cookie: admin });
      expect((audit.body.entries as Array<{ changed_by: string }>)[0].changed_by).toBe("priya.iyer@univ.edu");
    } finally {
      await execute("UPDATE Participates SET status = ?, check_in_time = ?, check_out_time = ? WHERE s_id = ? AND a_id = ?", [
        row!.status,
        row!.check_in_time,
        row!.check_out_time,
        row!.s_id,
        mentorActivity,
      ]);
      await execute("DELETE FROM attendance_log WHERE log_id > ? AND s_id = ?", [lastLog, row!.s_id]);
    }
  });

  it("a 5-star rating in MySQL becomes a graph interest that drives recommendations", async () => {
    const dash = (await call("/api/me/dashboard", { cookie: student })).body as {
      schedule: Array<{ a_id: number; status: string; rating: number | null; comments: string | null }>;
    };
    const interests = (await call("/api/graph/interests", { cookie: student })).body.interests as Array<{ a_id: number; fromRating: boolean }>;
    const target = dash.schedule.find(
      (s) => (s.status === "present" || s.status === "late") && !interests.find((i) => i.a_id === s.a_id)?.fromRating,
    );
    if (!target) return; // every attended activity is already rated 4+
    const original = await queryOne<{ rating: number; comments: string | null }>(
      "SELECT rating, comments FROM Feedback WHERE s_id = ? AND a_id = ?",
      [studentId, target.a_id],
    );
    try {
      const r = await call("/api/me/feedback", { method: "POST", cookie: student, body: { activityId: target.a_id, rating: 5, comments: "e2e" } });
      expect(r.status).toBe(201);
      // The graph is refreshed after the response (Next.js after()).
      const reached = await until(async () => {
        const now = (await call("/api/graph/interests", { cookie: student })).body.interests as Array<{ a_id: number; fromRating: boolean }>;
        return !!now.find((i) => i.a_id === target.a_id)?.fromRating;
      });
      expect(reached).toBe(true);
      const recs = (await call("/api/graph/recommendations", { cookie: student })).body.activities as Array<{ a_id: number }>;
      expect(recs.some((a) => a.a_id === target.a_id)).toBe(false);
    } finally {
      if (original) await execute("UPDATE Feedback SET rating = ?, comments = ? WHERE s_id = ? AND a_id = ?", [original.rating, original.comments, studentId, target.a_id]);
      else await execute("DELETE FROM Feedback WHERE s_id = ? AND a_id = ?", [studentId, target.a_id]);
      await call("/api/graph/sync", { method: "POST", cookie: admin });
    }
  });

  it("signing out clears the session cookie", async () => {
    const r = await call("/api/auth/logout", { method: "POST", cookie: student });
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/bootstrap_session=;.*Max-Age=0/i);
  });
});
