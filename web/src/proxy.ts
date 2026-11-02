import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, homeFor, verifySession, type Role } from "@/lib/auth/session";

// First line of defence: redirects signed-out users to /login, keeps each
// role inside its own dashboard and rejects cross-site API writes. Every
// route handler checks the session and role again on its own.

const PUBLIC_API = new Set(["/api/auth/login", "/api/auth/logout", "/api/health"]);

const PAGE_ROLES: Array<[prefix: string, roles: Role[]]> = [
  ["/admin", ["admin"]],
  ["/mentor", ["mentor"]],
  ["/student", ["student"]],
];

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers / server tools
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
      return NextResponse.json({ error: "Cross-site request rejected" }, { status: 403 });
    }
    if (!PUBLIC_API.has(pathname) && !session) {
      return NextResponse.json({ error: "Please sign in" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname === "/login") {
    return session ? NextResponse.redirect(new URL(homeFor(session.role), req.url)) : NextResponse.next();
  }

  if (!session) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname === "/") {
    return NextResponse.redirect(new URL(homeFor(session.role), req.url));
  }

  for (const [prefix, roles] of PAGE_ROLES) {
    if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && !roles.includes(session.role)) {
      return NextResponse.redirect(new URL(homeFor(session.role), req.url));
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
