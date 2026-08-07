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
    /**
     * Trace2 is disabled for the WHOLE test run, and that is the point.
     *
     * Once git-ai's hooks are installed on a machine it writes a GLOBAL
     * `trace2.eventTarget`, so its daemon observes every git command on the box
     * and writes `refs/notes/ai` into whatever repository just committed —
     * including this suite's throwaway fixtures, whose ref-purity assertions then
     * fail over a ref nothing in the harness created (plan 073).
     *
     * It lives HERE rather than in each fixture because the recurring defect was
     * never one fixture: it was that hermeticity had to be opted into, so the
     * next fixture anyone wrote was exposed again. Declared once, every test —
     * and every adapter a test drives — inherits it without knowing it exists.
     * `test/support/hermetic-git.ts` carries the same three keys for fixtures
     * that additionally need global-config isolation; a control test keeps the
     * two from drifting.
     */
    env: {
      GIT_TRACE2: '0',
      GIT_TRACE2_EVENT: '0',
      GIT_TRACE2_PERF: '0',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/services/docs/docs-content.ts'],
    },
  },
});
