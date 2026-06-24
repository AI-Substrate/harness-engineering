import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

/**
 * `harness boot` — the composed readiness proof for THIS repo (the harness's own home).
 *
 * Boot is a *composed* command: it readies the system, then composes the mandated
 * quality gate (`harness checks`). For this repo:
 *
 *   Stage 1 (ready) — there is no long-running service to start (the product is a
 *     CLI/library), so readiness reduces to "the gate is runnable from here". Boot
 *     records that honestly rather than faking a health poll.
 *   Stage 2 (gate)  — compose `harness checks` (vitest + arch/skills/markdown/windows
 *     checks) and fold its verdict in. The gate owns the tests, so boot does NOT run
 *     vitest itself — one definition, no double run. If no `checks` extension exists,
 *     boot degrades DETERMINISTICALLY with a warning pointing at `harness new checks`.
 *
 * Guardrails (cf. arch-check): no `node:*` imports; all I/O via `ctx.exec`/`ctx.fs`;
 * never throws; every non-ok result carries a `next_action`.
 */

const CLI_DIR = 'harness/cli';
const CHECKS_EXT = '.harness/extensions/checks';

const boot: HarnessVerb = {
  name: 'boot',
  summary:
    'Boot this repo to a proven-healthy state: ready the system (no services to start here) and compose `harness checks` (the mandated quality gate).',
  description:
    'Stage 1 readies the system \u2014 this repo is a CLI/library with no long-running service, so readiness is the gate ' +
    'being runnable from the repo root (no fake health poll). Stage 2 composes `harness checks` (vitest + the static ' +
    'gates) and folds the verdict in \u2014 boot does NOT re-run the tests itself. Verdicts: checks green => ok/exit 0; ' +
    'checks hard-fail => error/exit 1; checks warn-launch findings => degraded/exit 0; no checks extension => degraded ' +
    'with a deterministic pointer at `harness new checks`. See `harness instructions boot`.',
  async run(ctx) {
    try {
      // Stage 1 \u2014 readiness preflight. Meaningful only from the repo root.
      if (!ctx.fs.exists(`${ctx.cwd}/${CLI_DIR}/vitest.config.ts`)) {
        return ctx.unconfigured(
          `No ${CLI_DIR}/vitest.config.ts at ${ctx.cwd} \u2014 run \`harness boot\` from the repo root.`,
        );
      }

      // Stage 2 \u2014 compose the mandated quality gate.
      if (!ctx.fs.exists(`${ctx.cwd}/${CHECKS_EXT}`)) {
        return ctx.degraded(
          { boot: 'healthy', ready: 'no services to start (CLI/library)', checks: 'absent' },
          'No `checks` extension exists yet \u2014 create one (`harness new checks --wrap "<lint+test+typecheck>"`) ' +
            'or move this repo\u2019s existing quality checks (vitest, arch-check, skills-check, markdown-lint, windows-check) ' +
            'into a `checks` extension so `harness boot` and agents can gate on it. Boot has no gate to compose.',
        );
      }

      const started = Date.now();
      const checks = await ctx.exec('node', [`${CLI_DIR}/bin/harness.js`, 'checks', '--json'], {
        cwd: ctx.cwd,
      });
      const bootMs = Date.now() - started;

      let gateStatus = checks.ok ? 'ok' : 'error';
      let gateNote = '';
      try {
        const j = JSON.parse(checks.stdout) as { status?: string; next_action?: string };
        gateStatus = j.status ?? gateStatus;
        gateNote = j.next_action ?? '';
      } catch {
        gateNote = checks.stderr.trimEnd().split('\n').slice(-4).join(' ');
      }

      const data = {
        boot: 'healthy',
        bootMs,
        ready: 'no services to start (CLI/library)',
        checks: gateStatus,
      };

      if (gateStatus === 'error') {
        return ctx.error('E_BOOT_CHECKS', 'Boot readied the system, but `harness checks` (the quality gate) failed.', {
          details: { ...data, gateNote },
          next_action: `${gateNote} \u2014 run \`harness checks\` directly to iterate, then re-run \`harness boot\`.`,
        });
      }
      if (gateStatus === 'degraded' || gateStatus === 'unconfigured') {
        return ctx.degraded(
          data,
          `System is ready; the quality gate has warn-launch findings: ${gateNote} They don\u2019t block work \u2014 run \`harness checks\` for detail.`,
        );
      }
      return ctx.ok(data, {
        next_action:
          'System is ready and the quality gate is green \u2014 start work. Re-run `harness boot` at the next session start.',
      });
    } catch (e) {
      // "Never throws" backstop \u2014 any unexpected failure is still an honest envelope.
      return ctx.error('E_BOOT_UNEXPECTED', 'boot failed unexpectedly', {
        details: e instanceof Error ? e.message : String(e),
        next_action: 'Run the gate directly with `harness checks` (or `just test`) to localise, then re-run `harness boot`.',
      });
    }
  },
};

export default boot;
