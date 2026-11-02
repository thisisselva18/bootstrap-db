import bcrypt from "bcryptjs";
import { execute, queryOne } from "../mysql";
import { ApiError } from "../api";
import type { Role, Session } from "../auth/session";

const BCRYPT_ROUNDS = 10;

// Compared against when the email is unknown, so a miss costs the same time
// as a wrong password and response timing does not reveal valid accounts.
const DUMMY_HASH = "$2b$10$l/73vnAT83sw/yiVXnIV/.R53SrK8rttXfqBg9UzQU/fV1HhqD/wC";

type AccountRow = {
  user_id: number;
  username: string;
  password_hash: string;
  role: Role;
  s_id: number | null;
  m_id: number | null;
  is_active: number;
  display_name: string | null;
};

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function findAccount(email: string) {
  return queryOne<AccountRow>(
    `SELECT u.user_id, u.username, u.password_hash, u.role, u.s_id, u.m_id, u.is_active,
            COALESCE(s.s_name, m.m_name, 'Administrator') AS display_name
     FROM   AppUser u
     LEFT JOIN Student s ON s.s_id = u.s_id
     LEFT JOIN Mentor  m ON m.m_id = u.m_id
     WHERE  u.username = ?`,
    [email],
  );
}

/** Returns a session for valid credentials, otherwise null. */
export async function authenticate(email: string, password: string): Promise<Session | null> {
  const account = await findAccount(email);
  const ok = await bcrypt.compare(password, account?.password_hash ?? DUMMY_HASH);
  if (!account || !ok || !account.is_active) return null;

  await execute("UPDATE AppUser SET last_login = NOW() WHERE user_id = ?", [account.user_id]);
  return {
    uid: account.user_id,
    role: account.role,
    name: account.display_name ?? account.username,
    email: account.username,
    sId: account.s_id,
    mId: account.m_id,
  };
}

export async function changePassword(uid: number, current: string, next: string) {
  const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM AppUser WHERE user_id = ?", [uid]);
  if (!row || !(await bcrypt.compare(current, row.password_hash))) {
    throw new ApiError(400, "Current password is incorrect");
  }
  await execute("UPDATE AppUser SET password_hash = ? WHERE user_id = ?", [await hashPassword(next), uid]);
}
