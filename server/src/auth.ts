import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db';

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

export function createUser(email: string, password: string): User {
  const normalized = email.trim().toLowerCase();
  const stmt = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
  const info = stmt.run(normalized, hashPassword(password));
  return { id: Number(info.lastInsertRowid), email: normalized, plan: 'free' };
}

export function findUserByEmail(email: string): (User & { password_hash: string }) | null {
  const row = db
    .prepare('SELECT id, email, plan, password_hash FROM users WHERE email = ?')
    .get(email.trim().toLowerCase()) as (User & { password_hash: string }) | undefined;
  return row ?? null;
}

export function login(email: string, password: string): string | null {
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) return null;
  return createSession(user.id);
}

/** Token opaco guardado no banco — mais simples de revogar que um JWT. */
export function createSession(userId: number): string {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

export function userForToken(token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT users.id, users.email, users.plan
         FROM sessions JOIN users ON users.id = sessions.user_id
        WHERE sessions.token = ?`,
    )
    .get(token) as User | undefined;
  return row ?? null;
}
