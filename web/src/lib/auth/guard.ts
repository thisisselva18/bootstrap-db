import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ApiError } from "../api";
import { SESSION_COOKIE, verifySession, type Role, type Session } from "./session";

/** For route handlers: 401 without a valid session, 403 for the wrong role. */
export async function requireUser(req: NextRequest, ...roles: Role[]): Promise<Session> {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) throw new ApiError(401, "Please sign in");
  if (roles.length > 0 && !roles.includes(session.role)) {
    throw new ApiError(403, "You do not have permission to do that");
  }
  return session;
}

/** For server components (layouts/pages). */
export async function currentSession(): Promise<Session | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/**
 * Resolves which student a request is about. Students are always pinned to
 * their own record; staff may name any student.
 */
export function resolveStudentId(session: Session, requested?: number): number {
  if (session.role === "student") {
    if (!session.sId) throw new ApiError(403, "This account is not linked to a student");
    if (requested && requested !== session.sId) throw new ApiError(403, "Students can only view their own data");
    return session.sId;
  }
  if (!requested) throw new ApiError(400, "studentId is required");
  return requested;
}
