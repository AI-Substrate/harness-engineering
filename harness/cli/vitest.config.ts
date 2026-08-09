import { configDefaults, defineConfig } from 'vitest/config';

/**
 * The SLOW set — the inner loop's cost, named explicitly.
 *
 * These files are a small fraction of the suite's tests but the large majority
 * of its wall time and process spawns. Nearly all of that is real `git`
 * invocations and fixture repositories, which is cheap on macOS `fork`/`exec`
 * and expensive on Windows `CreateProcess` — so this list is ordered by
 * measured cost, and the trailing comment on each line is its MEASURED median,
 * not an estimate. Re-measure before editing.
 *
 * THE AGGREGATE SHARES ARE DELIBERATELY LOOSE. They were counted on main when
 * this list held 12 entries (5% of tests, ~81% of wall time, 1,363 of 1,617
 * spawns), before #108 deleted the two harness-capture hook tests that lived at
 * `test/integration/{pre,post}-commit-hook.test.ts`. Subtracting their measured
 * 155 and 12 spawns would yield a total that reads as counted and never was, so
 * the shares stay qualitative until someone re-runs the measurement.
 *
 * WHY A LIST AND NOT A `*.slow.test.ts` FILENAME CONVENTION: all 10 of these
 * files are named in 39 tracked documents (plan execution logs, retro records,
 * a live plan-073 review, and one archived dd `address` field). Renaming them
 * would stand up a glob that auto-scales, but would strand every one of those
 * traceability references — where a path is an identity, a move yields a wrong
 * answer rather than an error. The list costs one edit when a test turns slow;
 * `test/architecture/fast-scope-guard.test.ts` is what tells you that edit is due.
 */
export const SLOW_TESTS = [
  'test/adapters/git/exec-remote-telemetry-git.int.test.ts', // 25.5s · 712 spawns
  'test/services/hooks/provocation.int.test.ts', //             8.7s · real git, 32 isolated repos
  'test/sensors/tui/pty-input.test.ts', //                     10.4s · skipped on win32
  'test/adapters/git/cat-file-batch.int.test.ts', //            6.9s · 117 spawns
  'test/adapters/git/exec-git-write.int.test.ts', //            6.0s · 119 spawns
  'test/services/flow/archive-move.test.ts', //                 3.8s ·  29 spawns
  'test/app.test.ts', //                                        3.3s ·  99 spawns
  'test/services/flow/flow-renderer.test.ts', //                3.1s ·   3 spawns
  'test/integration/dd-flow-gate.int.test.ts', //               3.0s ·  17 spawns
  'test/services/telemetry/git-read.test.ts', //                1.9s ·  46 spawns
  'test/integration/update-banner.test.ts', //                  1.6s ·  45 spawns
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
    `\n  tests: FAST scope — ${SLOW_TESTS.length} slow file(s) SKIPPED (most of the runtime, few of the tests).\n` +
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
