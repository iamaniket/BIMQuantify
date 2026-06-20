import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Supplies the credential env vars that config.ts now requires (their dev
    // defaults were removed so production fails closed). Must run before any test
    // file imports a module that calls getConfig() at load time (e.g. log.ts).
    setupFiles: ['./test/setup.ts'],
  },
});
