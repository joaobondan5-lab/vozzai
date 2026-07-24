import { DatabaseSync } from 'node:sqlite';
import * as path from 'path';

// SQLite embutido no Node (sem dependência nativa). Para escalar, o mesmo
// esquema roda em Postgres — só troca a camada de acesso.
const file = process.env.VOZZA_DB || path.join(process.cwd(), 'vozza.db');
export const db = new DatabaseSync(file);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    plan          TEXT NOT NULL DEFAULT 'free',
    mp_customer   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Uma linha por ditado, para cobrar/limitar por uso real.
  CREATE TABLE IF NOT EXISTS usage (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    seconds     REAL NOT NULL,
    words       INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS usage_user_date ON usage(user_id, created_at);
`);
