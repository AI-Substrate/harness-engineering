import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';

/**
 * `harness checks` — the mandated quality gate for THIS repo (the harness's home).
 *
 * The single command an agent runs before considering work "done", and the gate a
 * team gates commits/push on. It COMPOSES the repo's existing deterministic checks
 * (rather than re-implementing them) into one honest envelope, so the gate has one
 * definition that grows as the team adds checks:
 *
 *   - tests        — `npx vitest run` in harness/cli      (hard gate: error on fail)
 *   - arch-check   — `harness arch-check`                 (warn-launch: degraded)
 *   - skills-check — `harness skills-check`               (hard gate: error on violation)
 *   - markdown-lint— `harness markdown-lint`              (warn-launch: degraded)
 *   - windows-check— `harness windows-check`              (warn-launch: degraded)
 *
 * Aggregation (honest, never fakes green): any sub-gate `error` => checks error/exit 1;
 * else any `degraded`/`unconfigured` => checks degraded/exit 0 (the repo's warn-launch
 * posture — visible, non-blocking); all clean => ok/exit 0.
 *
 * Guardrails (cf. arch-check): no `node:*` imports; all I/O via `ctx.exec`/`ctx.fs`;
 * never throws; every non-ok result carries a `next_action`. Read-only: it runs the
 * checks, it does not auto-fix (unlike `just fft`, which mutates).
 */

const CLI_DIR = 'harness/cli';

type GateStatus = 'ok' | 'degraded' | 'error' | 'unconfigured';
interface GateResult {
  name: string;
  status: GateStatus;
  exit: number;
  note: string;
}

/** Run one harness sub-verb via the repo bin and read its envelope status. */
async function runVerbGate(
  ctx: Parameters<HarnessVerb['run']>[0],
  verb: string,
): Promise<GateResult> {
  const r = await ctx.exec('node', [`${CLI_DIR}/bin/harness.js`, verb, '--json'], { cwd: ctx.cwd });
  try {
    const j = JSON.parse(r.stdout) as { status?: GateStatus; next_action?: string };
    const status = (j.status ?? (r.ok ? 'ok' : 'error')) as GateStatus;
    return { name: verb, status, exit: r.code, note: status === 'ok' ? '' : (j.next_action ?? '') };
  } catch {
    // No parseable envelope — fall back to the exit code (honest, never green-by-default).
    return {
      name: verb,
      status: r.ok ? 'ok' : 'error',
      exit: r.code,
      note: r.ok ? '' : r.stderr.trimEnd().split('\n').slice(-4).join(' '),
    };
  }
}

const checks: HarnessVerb = {
  name: 'checks',
  summary:
    'The mandated quality gate: composes vitest + arch-check + skills-check + markdown-lint + windows-check into one honest envelope. Run it before work is "done".',
  description:
    'Runs the repo\u2019s deterministic checks read-only (no auto-fix) and aggregates: tests (`npx vitest run`) and ' +
    'skills-check are hard gates (error => exit 1); arch-check, markdown-lint, windows-check are warn-launch ' +
    '(findings => degraded/exit 0). Any hard-gate error => checks error/exit 1; otherwise any degraded/unconfigured ' +
    'gate => checks degraded/exit 0; all clean => ok/exit 0. `harness boot` composes this. Extend the gate by adding ' +
    'a line here as the team grows. See `harness instructions checks`.',
  async run(ctx) {
    try {
      if (!ctx.fs.exists(`${ctx.cwd}/${CLI_DIR}/vitest.config.ts`)) {
        return ctx.unconfigured(
          `No ${CLI_DIR}/vitest.config.ts at ${ctx.cwd} \u2014 run \`harness checks\` from the repo root.`,
        );
      }

      const gates: GateResult[] = [];

      // Hard gate 1 \u2014 the unit-test suite (behaviour proof).
      const started = Date.now();
      const test = await ctx.exec('npx', ['vitest', 'run'], { cwd: `${ctx.cwd}/${CLI_DIR}` });
      gates.push({
        name: 'tests',
        status: test.ok ? 'ok' : 'error',
        exit: test.code,
        note: test.ok ? '' : 'The vitest suite failed \u2014 run `just test` to see the full report.',
      });

      // Composed harness sub-verbs.
      gates.push(await runVerbGate(ctx, 'arch-check'));
      gates.push(await runVerbGate(ctx, 'skills-check'));
      gates.push(await runVerbGate(ctx, 'markdown-lint'));
      gates.push(await runVerbGate(ctx, 'windows-check'));

      const durationMs = Date.now() - started;
      const summary = gates.map((g) => `${g.name}:${g.status}`).join(' ');
      const failed = gates.filter((g) => g.status === 'error');
      const soft = gates.filter((g) => g.status === 'degraded' || g.status === 'unconfigured');
      const data = { durationMs, summary, gates };

      if (failed.length > 0) {
        return ctx.error(
          'E_CHECKS_FAILED',
          `Quality gate failed: ${failed.map((g) => g.name).join(', ')} did not pass.`,
          {
            details: data,
            next_action: `Fix: ${failed
              .map((g) => `[${g.name}] ${g.note}`)
              .join(' \u2014 ')} Then re-run \`harness checks\`.`,
          },
        );
      }
      if (soft.length > 0) {
        return ctx.degraded(
          data,
          `Warn-launch findings (non-blocking): ${soft
            .map((g) => `[${g.name}] ${g.note}`)
            .join(' \u2014 ')} Run each verb directly for detail; promote to a hard gate once clean.`,
        );
      }
      return ctx.ok(data, { next_action: 'All gates green \u2014 work is safe to call done.' });
    } catch (e) {
      return ctx.error('E_CHECKS_UNEXPECTED', 'checks failed unexpectedly', {
        details: e instanceof Error ? e.message : String(e),
        next_action: 'Run the gates directly (`just test`, `harness arch-check`, \u2026) to localise, then re-run `harness checks`.',
      });
    }
  },
};

export default checks;
