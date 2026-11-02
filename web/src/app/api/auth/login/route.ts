import { NextResponse } from "next/server";
import { ApiError, handle, parseBody } from "@/lib/api";
import { clearFailures, isLocked, recordFailure } from "@/lib/auth/rate-limit";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, homeFor, signSession } from "@/lib/auth/session";
import { authenticate } from "@/lib/services/auth";
import { loginSchema } from "@/lib/validation";

export const POST = handle(async (req) => {
  const { email, password } = await parseBody(req, loginSchema);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${ip}|${email}`;
  if (isLocked(key)) throw new ApiError(429, "Too many failed attempts. Try again in 15 minutes.");

  const session = await authenticate(email, password);
  if (!session) {
    recordFailure(key);
    throw new ApiError(401, "Incorrect email or password");
  }
  clearFailures(key);

  const res = NextResponse.json({ user: session, redirectTo: homeFor(session.role) });
  res.cookies.set(SESSION_COOKIE, await signSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
});
