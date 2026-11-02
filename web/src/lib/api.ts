import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { GraphUnavailableError } from "./neo4j";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Friendly text for the named CHECK constraints in the schema.
const CHECK_MESSAGES: Record<string, string> = {
  chk_activity_capacity: "Capacity must be greater than zero",
  chk_capacity_max: "Capacity cannot exceed 500",
  chk_schedule_day: "Day must be between 1 and 5",
  chk_schedule_times: "End time must be after start time",
  chk_part_times: "Check-out cannot be before check-in",
  chk_part_absent: "An absent record cannot carry check-in or check-out times",
  chk_fb_rating: "Rating must be between 1 and 5",
  chk_student_semester: "Semester must be between 1 and 8",
  chk_phone_len: "Phone number must have at least 10 characters",
  chk_appuser_hash: "Password must be stored as a bcrypt hash",
  chk_appuser_username: "Username must be an email address",
};

const UNIQUE_MESSAGES: Record<string, string> = {
  "student.s_usn": "A student with that USN already exists",
  "student.email": "A student with that email already exists",
  "mentor.email": "A mentor with that email already exists",
  "activity.a_name": "An activity with that name already exists",
  "bootstrapgroup.g_name": "A group with that name already exists",
  "appuser.username": "An account with that email already exists",
  "feedback.s_id": "Feedback for that activity already exists",
};

type MysqlError = { errno?: number; sqlState?: string; sqlMessage?: string; code?: string };

/** Maps a MySQL error to an HTTP status + safe message, or null if not a DB rule. */
export function mapDbError(err: unknown): { status: number; message: string } | null {
  const e = err as MysqlError;
  if (typeof e?.errno !== "number" || !e.sqlMessage) return null;
  const msg = e.sqlMessage;
  switch (e.errno) {
    case 1644: // SIGNAL SQLSTATE '45000' from a trigger or procedure: a business rule
      return { status: 409, message: msg };
    case 1062: {
      const key = /for key '([^']+)'/.exec(msg)?.[1]?.toLowerCase() ?? "";
      return { status: 409, message: UNIQUE_MESSAGES[key] ?? "That record already exists" };
    }
    case 3819: {
      const name = /constraint '([^']+)'/.exec(msg)?.[1] ?? "";
      return { status: 400, message: CHECK_MESSAGES[name] ?? `Constraint ${name} violated` };
    }
    case 1451:
      return { status: 409, message: "That record is still referenced by other records" };
    case 1452:
      return { status: 400, message: "A referenced record does not exist" };
    case 1406:
      return { status: 400, message: "A value is too long for its field" };
    case 1264:
      return { status: 400, message: "A number is out of range" };
    case 1048:
      return { status: 400, message: "A required value is missing" };
    case 1366:
    case 1292:
      return { status: 400, message: "A value has the wrong format" };
    default:
      return null;
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return json({ error: err.message, details: err.details }, err.status);
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const first = details[0];
    const message = first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : "Invalid input";
    return json({ error: message, details }, 400);
  }
  if (err instanceof GraphUnavailableError) {
    return json({ error: err.message }, 503);
  }
  const db = mapDbError(err);
  if (db) return json({ error: db.message }, db.status);

  // Unknown failure: log it on the server, never leak internals to the client.
  console.error("[api] unhandled error", err);
  const code = (err as MysqlError)?.code;
  if (code === "ECONNREFUSED" || code === "ER_ACCESS_DENIED_ERROR" || code === "ER_BAD_DB_ERROR") {
    return json({ error: "The relational database (MySQL) is not reachable right now" }, 503);
  }
  return json({ error: "Something went wrong on the server" }, 500);
}

/** Wraps a route handler so every thrown error becomes a JSON response. */
export function handle<C = unknown>(fn: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
  return schema.parse(body);
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  const obj: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    if (v !== "") obj[k] = v;
  });
  return schema.parse(obj);
}

/** Parses a numeric route parameter such as [id]. */
export function idParam(value: string, label = "id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(400, `Invalid ${label}`);
  return n;
}
