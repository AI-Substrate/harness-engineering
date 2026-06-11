import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The second glob collects extension-colocated tests (plan 016 — exemplar
    // extensions travel with their tests). Root-relative: this config lives at
    // harness/cli/, the repo root is TWO levels up.
    include: ['test/**/*.test.ts', '../../.harness/extensions/**/*.test.ts'],
    // Report-only coverage this slice — no thresholds (plan R5); a young codebase
    // shouldn't be gated on coverage. Phase 3 CI surfaces the summary.
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/services/docs/docs-content.ts'],
    },
  },
});
