import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    include: ['.harness/extensions/flow-eval/**/*.test.ts'],
    passWithNoTests: false,
    testTimeout: 30000,
  },
});
