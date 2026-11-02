import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { ZodError, z } from "zod";
import { ApiError, errorResponse, mapDbError } from "@/lib/api";
import { resolveStudentId } from "@/lib/auth/guard";
import { clearFailures, isLocked, recordFailure } from "@/lib/auth/rate-limit";
import { homeFor, signSession, verifySession, type Session } from "@/lib/auth/session";
import { GraphUnavailableError } from "@/lib/neo4j";
import { PEER_WEIGHTS, peerScore } from "@/lib/services/graph";

describe("mapDbError", () => {
  it("turns a trigger SIGNAL into 409 with its message", () => {
    expect(mapDbError({ errno: 1644, sqlMessage: "Cannot delete a student with recorded attendance" })).toEqual({
      status: 409,
      message: "Cannot delete a student with recorded attendance",
    });
  });

  it("names the duplicated key", () => {
    const r = mapDbError({ errno: 1062, sqlMessage: "Duplicate entry '1BM26CS001' for key 'student.s_usn'" });
    expect(r).toEqual({ status: 409, message: "A student with that USN already exists" });
  });

  it("explains CHECK violations", () => {
    const r = mapDbError({ errno: 3819, sqlMessage: "Check constraint 'chk_fb_rating' is violated." });
    expect(r).toEqual({ status: 400, message: "Rating must be between 1 and 5" });
  });

  it("maps foreign key errors", () => {
    expect(mapDbError({ errno: 1452, sqlMessage: "fk" })?.status).toBe(400);
    expect(mapDbError({ errno: 1451, sqlMessage: "fk" })?.status).toBe(409);
  });

  it("ignores non-database errors", () => {
    expect(mapDbError(new Error("boom"))).toBeNull();
  });
});

describe("errorResponse", () => {
  it("uses the status of an ApiError", async () => {
    const res = errorResponse(new ApiError(403, "nope"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "nope" });
  });

  it("reports zod issues as 400", async () => {
    let err: unknown;
    try {
      z.object({ rating: z.number().max(5) }).parse({ rating: 9 });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ZodError);
    const res = errorResponse(err);
    expect(res.status).toBe(400);
    expect((await res.json()).details[0].path).toBe("rating");
  });

  it("reports an unreachable graph as 503", () => {
    expect(errorResponse(new GraphUnavailableError()).status).toBe(503);
  });

  it("hides internal errors", async () => {
    const original = console.error;
    console.error = () => {};
    const res = errorResponse(new Error("secret stack detail"));
    console.error = original;
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

const student: Session = { uid: 7, role: "student", name: "A", email: "a@univ.edu", sId: 12, mId: null };

describe("sessions", () => {
  it("round-trips a signed session", async () => {
    const token = await signSession(student);
    expect(await verifySession(token)).toEqual(student);
  });

  it("rejects tampered, foreign and missing tokens", async () => {
    const token = await signSession(student);
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), role: "admin" })).toString("base64url");
    expect(await verifySession(`${h}.${forged}.${s}`)).toBeNull();

    const foreign = await new SignJWT({ role: "admin" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("campus-bootstrap")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-completely-different-secret-of-32-chars!"));
    expect(await verifySession(foreign)).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("garbage")).toBeNull();
  });

  it("sends each role to its dashboard", () => {
    expect(homeFor("admin")).toBe("/admin");
    expect(homeFor("mentor")).toBe("/mentor");
    expect(homeFor("student")).toBe("/student");
  });
});

describe("resolveStudentId", () => {
  it("pins students to their own record", () => {
    expect(resolveStudentId(student)).toBe(12);
    expect(resolveStudentId(student, 12)).toBe(12);
    expect(() => resolveStudentId(student, 13)).toThrow(/own data/);
  });

  it("lets staff choose but requires a choice", () => {
    const admin: Session = { ...student, role: "admin", sId: null };
    expect(resolveStudentId(admin, 5)).toBe(5);
    expect(() => resolveStudentId(admin)).toThrow(/required/);
  });
});

describe("login rate limit", () => {
  it("locks after five failures and clears on success", () => {
    const key = `test|${Math.random()}`;
    for (let i = 0; i < 4; i++) recordFailure(key);
    expect(isLocked(key)).toBe(false);
    recordFailure(key);
    expect(isLocked(key)).toBe(true);
    clearFailures(key);
    expect(isLocked(key)).toBe(false);
  });
});

describe("peerScore", () => {
  const base = { jaccard: 0, mutuals: 0, crossBranch: false, crossGroup: false, prefer: "any" as const };

  it("weights sum to 1 at the maximum", () => {
    const max = peerScore({ jaccard: 1, mutuals: 10, crossBranch: true, crossGroup: true, prefer: "cross-branch" });
    expect(max).toBeCloseTo(PEER_WEIGHTS.jaccard + PEER_WEIGHTS.mutual + PEER_WEIGHTS.branch + PEER_WEIGHTS.group);
    expect(max).toBeCloseTo(1);
  });

  it("caps mutual connections", () => {
    expect(peerScore({ ...base, mutuals: 3 })).toBe(peerScore({ ...base, mutuals: 30 }));
  });

  it("follows the branch preference", () => {
    const cross = { ...base, jaccard: 0.5, crossBranch: true };
    const same = { ...base, jaccard: 0.5, crossBranch: false };
    expect(peerScore({ ...cross, prefer: "cross-branch" })).toBeGreaterThan(peerScore({ ...same, prefer: "cross-branch" }));
    expect(peerScore({ ...same, prefer: "same-branch" })).toBeGreaterThan(peerScore({ ...cross, prefer: "same-branch" }));
    expect(peerScore({ ...same, prefer: "any" })).toBe(peerScore({ ...cross, prefer: "any" }));
  });
});
