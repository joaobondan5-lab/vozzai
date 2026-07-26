import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os testes de integração compartilham um único Postgres local e o rate
    // limiter em memória — rodar arquivos em paralelo criaria corrida.
    fileParallelism: false,
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20_000,
  },
});
