import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

export type Role = "admin" | "mentor" | "student";

export type Session = {
  uid: number;
  role: Role;
  name: string;
  email: string;
  sId: number | null; // linked Student.s_id for role=student
  mId: number | null; // linked Mentor.m_id for role=mentor
};

export const SESSION_COOKIE = "bootstrap_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const ROLES: readonly Role[] = ["admin", "mentor", "student"];

function key() {
  return new TextEncoder().encode(env().AUTH_SECRET);
}

/** Signs a session as a short-lived HS256 JWT. */
export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ role: s.role, name: s.name, email: s.email, sId: s.sId, mId: s.mId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(s.uid))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setIssuer("campus-bootstrap")
    .sign(key());
}

/** Returns the session, or null for a missing, expired or tampered token. */
export async function verifySession(token: string | undefined | null): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: "campus-bootstrap", algorithms: ["HS256"] });
    const role = payload.role as Role;
    if (!ROLES.includes(role)) return null;
    return {
      uid: Number(payload.sub),
      role,
      name: String(payload.name ?? ""),
      email: String(payload.email ?? ""),
      sId: typeof payload.sId === "number" ? payload.sId : null,
      mId: typeof payload.mId === "number" ? payload.mId : null,
    };
  } catch {
    return null;
  }
}

export function homeFor(role: Role): string {
  return role === "admin" ? "/admin" : role === "mentor" ? "/mentor" : "/student";
}
