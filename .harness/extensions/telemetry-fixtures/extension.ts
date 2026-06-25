import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';
import { deriveCaptureConfig, isSurface, SURFACES } from './capture-logic.js';

/**
 * `harness capture-fixtures` — capture real harness session logs into the
 * scrubbed test-fixture corpus (plan 037). REFERENCE/dogfood tool: it lives in
 * `.harness/extensions/` so it is available in-repo but never ships to npm.
 *
 * `run()` is the composition root: it uses the core-injected `ctx` ports
 * (`ctx.fs`/`ctx.fsWrite`/`ctx.env` — already Node-backed) and the PURE core
 * scrub service; no `node:*` is imported here. Capture stages to a gitignored
 * `scratch/` first, scrubs, and (after a human "anything bad" review) promotes
 * to `fixtures/real/<surface>/<instance>/` — P12-compliant by construction.
 *
 * T004 scaffolds the shell + dispatch; the claude capture path lands in T005,
 * the remaining surfaces in Phase 2.
 */

const captureFixtures: HarnessVerb = {
  name: 'capture-fixtures',
  summary:
    'Capture real harness session logs into the scrubbed telemetry fixture corpus (claude; more surfaces in Phase 2).',
  description:
    'Reads a real session from a local harness surface, stages it to a gitignored ' +
    'scratch/ dir, scrubs machine paths / identity / secrets (keeping prompts and ' +
    'tool calls verbatim), and — after a manual review — promotes it to ' +
    'fixtures/real/<surface>/<instance>/. Surfaces: ' +
    SURFACES.join(', ') +
    ". Only 'claude' is implemented in Phase 1.",
  options: [
    { flags: '--surface <surface>', description: `one of: ${SURFACES.join(' | ')}` },
    {
      flags: '--instance <id>',
      description: 'instance id for the corpus dir (default: derived from date + session)',
    },
    {
      flags: '--session <id>',
      description: 'explicit claude session id (default: the most recent session for this repo)',
    },
    { flags: '--names <csv>', description: 'comma-separated person names to scrub' },
    {
      flags: '--dry-run',
      description: 'capture + scrub into scratch/ only; do NOT promote to the corpus',
      defaultValue: false,
    },
  ],
  run(ctx) {
    const surface = ctx.options.surface as string | undefined;
    if (!isSurface(surface)) {
      return ctx.error('E_SURFACE', `--surface must be one of: ${SURFACES.join(', ')}`, {
        next_action: `Re-run with e.g. \`harness capture-fixtures --surface claude\`.`,
      });
    }

    const names = ((ctx.options.names as string | undefined) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const config = deriveCaptureConfig({ home: ctx.env.get('HOME'), cwd: ctx.cwd, names });
    if (!config) {
      return ctx.unconfigured(
        'HOME is not set, so the scrub config cannot be derived. Set HOME and re-run from the repo root.',
      );
    }
    if (!ctx.fsWrite) {
      return ctx.unconfigured(
        'This harness core lacks the write-side fs capability (plan 031). Update the harness: `harness update`.',
      );
    }

    if (surface !== 'claude') {
      return ctx.unconfigured(
        `'${surface}' capture lands in Phase 2; only 'claude' is implemented in Phase 1.`,
      );
    }

    // claude capture path — implemented in T005.
    return ctx.unconfigured("claude capture path lands in T005 (skeleton only at T004).");
  },
};

export default captureFixtures;
