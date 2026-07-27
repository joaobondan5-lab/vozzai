import { defineConfig } from 'vitest/config';

// Só os testes do app desktop. O servidor tem a própria suíte (server/npm test),
// que precisa de Postgres local e roda separada.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
