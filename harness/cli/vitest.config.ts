import { configDefaults, defineConfig } from 'vitest/config';

/**
 * The SLOW set — the inner loop's cost, named explicitly.
 *
 * These 12 files are 5% of the suite's tests but ~81% of its wall time and
 * 1,363 of its 1,617 process spawns. Nearly all of that is real `git`
 * invocations and fixture repositories, which is cheap on macOS `fork`/`exec`
 * and expensive on Windows `CreateProcess` — so this list is ordered by
 * measured cost, and the trailing comment on each line is its MEASURED median,
 * not an estimate. Re-measure before editing.
 *
 * WHY A LIST AND NOT A `*.slow.test.ts` FILENAME CONVENTION: 11 of these 12
 * files are named in ~60 tracked documents (plan execution logs, retro records,
 * a live plan-073 review, and one archived dd `address` field). Renaming them
 * would stand up a glob that auto-scales, but would strand every one of those
 * traceability references — where a path is an identity, a move yields a wrong
 * answer rather than an error. The list costs one edit when a test turns slow;
 * `test/architecture/fast-scope-guard.test.ts` is what tells you that edit is due.
 */
export const SLOW_TESTS = [
  'test/adapters/git/exec-remote-telemetry-git.int.test.ts', // 25.5s · 712 spawns
  'test/integration/pre-commit-hook.test.ts', //               18.2s · 155 spawns
  'test/sensors/tui/pty-input.test.ts', //                     10.4s · skipped on win32
  'test/adapters/git/cat-file-batch.int.test.ts', //            6.9s · 117 spawns
  'test/adapters/git/exec-git-write.int.test.ts', //            6.0s · 119 spawns
  'test/services/flow/archive-move.test.ts', //                 3.8s ·  29 spawns
  'test/app.test.ts', //                                        3.3s ·  99 spawns
  'test/services/flow/flow-renderer.test.ts', //                3.1s ·   3 spawns
  'test/integration/dd-flow-gate.int.test.ts', //               3.0s ·  17 spawns
  'test/services/telemetry/git-read.test.ts', //                1.9s ·  46 spawns
  'test/integration/update-banner.test.ts', //                  1.6s ·  45 spawns
  'test/integration/post-commit-hook.test.ts', //               1.6s ·  12 spawns
];

/**
 * Test scope, and WHY it is an env var rather than a vitest `projects` +
 * `--project` pair: `harness checks` spawns `npx vitest run --coverage` from
 * inside the checks extension, and CI runs that same composite. An env var is
 * the one control point every invocation path inherits — `just test`, a bare
 * `npx vitest run`, and the gate — so the default cannot be true in one place
 * and false in another. `projects` would require every caller to remember a
 * flag, which is precisely how a fast default becomes an accidental one.
 *
 *   fast (default) — skip SLOW_TESTS. The inner loop.
 *   all            — everything. What CI sets; what a gate must mean.
 *   slow           — only SLOW_TESTS (`just test-heavy`).
 */
const SCOPE = process.env.HARNESS_TEST_SCOPE ?? 'fast';
if (!['fast', 'all', 'slow'].includes(SCOPE)) {
  throw new Error(
    `HARNESS_TEST_SCOPE must be one of fast|all|slow (got "${SCOPE}"). ` +
      'An unrecognised scope would silently fall back to a smaller suite, so this fails loudly instead.',
  );
}

const DEFAULT_INCLUDE = ['test/**/*.test.ts', '../../.harness/extensions/**/*.test.ts'];

/**
 * The DENOMINATOR BANNER. A default that quietly runs less than yesterday is the
 * failure mode this whole split risks introducing, so a reduced scope always
 * says so — not only when verbose, and not only on failure. stderr, so it
 * survives being piped and cannot be mistaken for test output.
 */
if (SCOPE === 'fast') {
  process.stderr.write(
    `\n  tests: FAST scope — ${SLOW_TESTS.length} slow file(s) SKIPPED (~81% of runtime, 5% of tests).\n` +
      '         Set HARNESS_TEST_SCOPE=all to include them. CI always runs all.\n\n',
  );
}

export default defineConfig({
  test: {
    // The second glob collects extension-colocated tests (plan 016 — exemplar
    // extensions travel with their tests). Root-relative: this config lives at
    // harness/cli/, the repo root is TWO levels up.
    include: SCOPE === 'slow' ? SLOW_TESTS : DEFAULT_INCLUDE,
    ...(SCOPE === 'fast' ? { exclude: [...configDefaults.exclude, ...SLOW_TESTS] } : {}),
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
