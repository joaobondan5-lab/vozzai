import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { pool } from './db';

export interface User {
  id: number;
  email: string;
  plan: string;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export async function createUser(email: string, password: string): Promise<User> {
  const normalized = email.trim().toLowerCase();
  const result = await pool.query<{ id: number }>(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
    [normalized, hashPassword(password)],
  );
  return { id: result.rows[0].id, email: normalized, plan: 'free' };
}

export async function findUserByEmail(
  email: string,
): Promise<(User & { password_hash: string }) | null> {
  const result = await pool.query<User & { password_hash: string }>(
    'SELECT id, email, plan, password_hash FROM users WHERE email = $1',
    [email.trim().toLowerCase()],
  );
  return result.rows[0] ?? null;
}

export async function login(email: string, password: string): Promise<string | null> {
  const user = await findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return createSession(user.id);
}

/** Token opaco guardado no banco — mais simples de revogar que um JWT. */
export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
  return token;
}

export async function userForToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const result = await pool.query<User>(
    `SELECT users.id, users.email, users.plan
       FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = $1`,
    [token],
  );
  return result.rows[0] ?? null;
}
