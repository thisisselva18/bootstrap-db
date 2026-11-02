import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { env } from "./env";

// One pool per process. In development Next.js reloads modules on every
// change, so the pool is parked on globalThis to avoid leaking connections.
const globalForMysql = globalThis as unknown as { __bootstrapPool?: Pool };

export function pool(): Pool {
  if (!globalForMysql.__bootstrapPool) {
    const e = env();
    globalForMysql.__bootstrapPool = mysql.createPool({
      host: e.MYSQL_HOST,
      port: e.MYSQL_PORT,
      user: e.MYSQL_USER,
      password: e.MYSQL_PASSWORD,
      database: e.MYSQL_DATABASE,
      connectionLimit: 10,
      waitForConnections: true,
      // DATETIME/TIME come back as plain strings: no timezone shifting.
      dateStrings: true,
      // DECIMAL and SUM() results come back as numbers, not strings.
      decimalNumbers: true,
      namedPlaceholders: false,
      multipleStatements: false,
    });
  }
  return globalForMysql.__bootstrapPool;
}

export type Row = Record<string, unknown>;
export type Params = ReadonlyArray<unknown>;

/** Parameterized query; every value goes through a `?` placeholder. */
export async function query<T = Row>(sql: string, params: Params = []): Promise<T[]> {
  const [rows] = await pool().query<RowDataPacket[]>(sql, params as unknown[]);
  return rows as unknown as T[];
}

export async function queryOne<T = Row>(sql: string, params: Params = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** INSERT/UPDATE/DELETE; returns affected rows and the generated id. */
export async function execute(sql: string, params: Params = []) {
  const [result] = await pool().query(sql, params as unknown[]);
  const r = result as mysql.ResultSetHeader;
  return { affectedRows: r.affectedRows, insertId: r.insertId };
}

type ConnOptions = { appUser?: string };

/**
 * Runs `fn` on one dedicated connection. When `appUser` is given it is put
 * in the @app_user session variable, which trg_part_audit writes into
 * AttendanceLog.changed_by, and cleared again before the connection goes
 * back to the pool.
 */
export async function withConnection<T>(
  fn: (conn: PoolConnection) => Promise<T>,
  opts: ConnOptions = {},
): Promise<T> {
  const conn = await pool().getConnection();
  try {
    if (opts.appUser) await conn.query("SET @app_user = ?", [opts.appUser]);
    return await fn(conn);
  } finally {
    if (opts.appUser) await conn.query("SET @app_user = NULL").catch(() => {});
    conn.release();
  }
}

/** Application-level transaction: COMMIT on success, ROLLBACK on any error. */
export async function transaction<T>(
  fn: (conn: PoolConnection) => Promise<T>,
  opts: ConnOptions = {},
): Promise<T> {
  return withConnection(async (conn) => {
    await conn.beginTransaction();
    try {
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  }, opts);
}

/**
 * CALL a stored procedure and return its first result set (procedures that
 * end in a SELECT). mysql2 returns [resultSet..., okPacket] for CALL.
 */
export async function callProc<T = Row>(
  name: string,
  params: Params = [],
  conn?: PoolConnection,
): Promise<T[]> {
  if (!/^sp_[a-z_]+$/.test(name)) throw new Error(`Invalid procedure name ${name}`);
  const placeholders = params.map(() => "?").join(", ");
  const runner = conn ?? pool();
  const [result] = await runner.query(`CALL ${name}(${placeholders})`, params as unknown[]);
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return [];
}

export async function pingMysql(): Promise<boolean> {
  try {
    await pool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
