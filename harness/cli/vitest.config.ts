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
     * A stopwatch is not an assertion (plan 077 · tk-0101 · #108).
     *
     * vitest's 5s default was reporting ~30% of a downstream consumer's Windows
     * failures — 46 of 151 FAIL lines read `Test timed out in 5000ms` — and it
     * MANUFACTURED failures: five files that pass on `main` went red on the s077
     * branch purely because that run was 32% slower on the same box with nothing
     * else changed. While that stands, no other measurement of this suite is
     * trustworthy, on any platform.
     *
     * GLOBAL, not win32-only, deliberately. The property that blows the budget is
     * "this suite spawns processes constantly" — real git, loopback daemons, real
     * hooks — not "this suite is on Windows". The same contention bites a loaded
     * Linux dev box and a shared CI runner (#109 measures exactly that), so a
     * win32-only raise would leave the flake in place here while encoding
     * "Windows is the weird one", which is the wrong diagnosis attached to the
     * right symptom. It is also a FLOOR: three files previously set their own
     * 20s via `vi.setConfig`, which would now be a downgrade, so they defer to
     * this value instead.
     *
     * What it costs: a genuinely hung test takes 30s to fail rather than 5s. That
     * is the correct trade — a hang still fails, whereas a too-tight budget fails
     * cases whose assertions were never in doubt and hides the ones that were.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
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
