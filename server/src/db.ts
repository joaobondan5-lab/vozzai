import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL não configurada. Aponte para um Postgres (o Railway fornece uma automaticamente ao adicionar o plugin Postgres).',
  );
}

export const pool = new Pool({ connectionString, max: 10 });

// Um erro num cliente ocioso não deve derrubar o processo inteiro.
pool.on('error', (err) => {
  console.error('[vozza] erro inesperado no pool do Postgres:', err);
});

export async function initSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plan          TEXT NOT NULL DEFAULT 'free',
      mp_customer   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Uma linha por ditado, para cobrar/limitar por uso real.
    CREATE TABLE IF NOT EXISTS usage (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      seconds     REAL NOT NULL,
      words       INTEGER NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS usage_user_date ON usage(user_id, created_at);
  `);
}
