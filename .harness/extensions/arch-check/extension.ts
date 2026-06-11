import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';
import { type DepcruiseRule, mapToDecision, parseDepcruiseJson } from './mapping.js';

/**
 * `harness arch-check` — deterministic architectural back pressure (plan 016).
 *
 * Runs dependency-cruiser over `harness/cli/src` against the committed root
 * rules (`.dependency-cruiser.cjs` — the single source of truth shared with raw
 * depcruise runs and CI) and maps the result into an honest envelope per the
 * spec's § Envelope & Exit Contract. The violations→envelope decision lives in
 * the pure `mapping.ts` (unit-tested over real fixtures); this shell only does
 * preflight, exec, and parse plumbing.
 *
 * Guardrails honoured: no `node:*` imports; all I/O via `ctx.exec`/`ctx.fs`;
 * never throws; every non-ok result carries a `next_action`.
 */

const CONFIG = '.dependency-cruiser.cjs';
// Gotcha #1: ALWAYS the local bin. Bare `npx depcruise` silently scans
// 0 modules in directory mode — a fake-green sensor. Never use it.
const BIN = './node_modules/.bin/depcruise';
const TARGET = 'harness/cli/src';

const archCheck: HarnessVerb = {
  name: 'arch-check',
  summary:
    'Prove the hexagonal architecture: run dependency-cruiser against the committed root rules and report an honest envelope.',
  description:
    `Runs ./node_modules/.bin/depcruise --config ${CONFIG} --output-type json ${TARGET} ` +
    'and maps the result per the envelope contract: 0 violations => ok/exit 0; ' +
    'error-severity violations => error/exit 1; warn-only violations => degraded/exit 0 ' +
    '(the launch posture — every committed rule ships at warn until deliberately promoted); ' +
    'missing tool or config => unconfigured/exit 2; depcruise crash or unparseable ' +
    'output => error/exit 1. Each violation carries its rule’s plain-English comment, ' +
    'so the fix is explained at the point of failure. See `harness instructions arch-check`.',
  async run(ctx) {
    try {
      // Preflight (Finding 06): ctx.cwd is the invocation cwd — extension
      // discovery itself scans <cwd>/.harness/extensions, so this verb
      // effectively runs from the repo root; from anywhere else neither the
      // bin nor the config resolves, and the honest answer is "not set up
      // here", not a crash.
      if (!ctx.fs.exists(`${ctx.cwd}/node_modules/.bin/depcruise`)) {
        return ctx.unconfigured(
          'dependency-cruiser is not installed in this working tree. Install it: ' +
            '`npm install -D dependency-cruiser` — and run `harness arch-check` from the repo root.',
        );
      }
      if (!ctx.fs.exists(`${ctx.cwd}/${CONFIG}`)) {
        return ctx.unconfigured(
          `${CONFIG} is missing at ${ctx.cwd}. Its absence means setup is incomplete, not broken: ` +
            'restore the committed config (git checkout -- .dependency-cruiser.cjs) — ' +
            'and run `harness arch-check` from the repo root.',
        );
      }

      const r = await ctx.exec(BIN, ['--config', CONFIG, '--output-type', 'json', TARGET]);

      // Gotcha #3 (measured 2026-06-10): depcruise 17.4.3 exits 0 from
      // `--output-type json` even with error-severity violations — parse
      // stdout, never trust the exit code.
      const parsed = parseDepcruiseJson(r.stdout);
      if (!parsed.ok) {
        return ctx.error(
          'E_DEPCRUISE_OUTPUT',
          'dependency-cruiser crashed or emitted unparseable output',
          {
            details: {
              exitCode: r.code,
              parseDetail: parsed.detail,
              stderr: r.stderr.slice(0, 2000),
            },
            next_action:
              'Inspect error.details (stderr / parse detail). Reproduce with the raw command: ' +
              `${BIN} --config ${CONFIG} --output-type json ${TARGET}`,
          },
        );
      }

      const rules = ((parsed.parsed as { summary?: { ruleSetUsed?: { forbidden?: DepcruiseRule[] } } })
        .summary?.ruleSetUsed?.forbidden ?? []) as DepcruiseRule[];
      const decision = mapToDecision(parsed.parsed, rules);

      if (decision.status === 'error' && decision.error) {
        // Literal VerbResult instead of ctx.error: the contract's error factory
        // has no data slot, but the spec pins data.violations as present in
        // every state where depcruise ran (CI's jq path depends on it).
        return {
          status: 'error',
          data: decision.data,
          error: decision.error,
          next_action: decision.next_action,
        };
      }
      if (decision.status === 'degraded' && decision.next_action) {
        return ctx.degraded(decision.data, decision.next_action);
      }
      return ctx.ok(decision.data);
    } catch (e) {
      // "Never throws" backstop — any unexpected failure is still an honest envelope.
      return ctx.error(
        'E_ARCH_CHECK_UNEXPECTED',
        'arch-check failed unexpectedly',
        {
          details: e instanceof Error ? e.message : String(e),
          next_action:
            'Re-run with the raw command to localise: ' +
            `${BIN} --config ${CONFIG} --output-type json ${TARGET}`,
        },
      );
    }
  },
};

export default archCheck;
