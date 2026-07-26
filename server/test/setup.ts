import { Client } from 'pg';

/**
 * Roda antes de cada arquivo de teste, antes de qualquer import de src/.
 *
 * O banco é SEMPRE o vozza_test local — nunca o DATABASE_URL do ambiente,
 * para ser impossível um teste tocar em produção por engano.
 */
const TEST_DB_URL = 'postgresql://postgres@/vozza_test?host=/tmp&port=5433';
const ADMIN_DB_URL = 'postgresql://postgres@/postgres?host=/tmp&port=5433';

process.env.DATABASE_URL = TEST_DB_URL;
process.env.ADMIN_TOKEN = 'token-de-teste-nao-usar-em-producao';

// O teste de billing só roda com credencial de sandbox. Qualquer outra coisa
// (inclusive um token de produção herdado do shell) é descartada.
if (process.env.MP_ACCESS_TOKEN && !process.env.MP_ACCESS_TOKEN.startsWith('TEST-')) {
  delete process.env.MP_ACCESS_TOKEN;
}

const client = new Client({ connectionString: ADMIN_DB_URL });
await client.connect();
try {
  await client.query('CREATE DATABASE vozza_test');
} catch (err) {
  const code = (err as { code?: string }).code;
  if (code !== '42P04') throw err; // 42P04 = já existe
} finally {
  await client.end();
}
