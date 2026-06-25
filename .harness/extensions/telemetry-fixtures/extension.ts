import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';
// Single-source the privacy-critical scrub from core telemetry (not vendored).
import { scrubText } from '../../../harness/cli/src/services/telemetry/fixture-scrub.js';
import {
  buildMeta,
  claudeProjectDir,
  defaultInstanceId,
  deriveCaptureConfig,
  instanceDir,
  isSurface,
  rawFilename,
  scratchRoot,
  sessionFiles,
  SURFACES,
} from './capture-logic.js';

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
    { flags: '--note <text>', description: 'one-line provenance note for meta.json' },
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

    // ── claude capture path (T005) ────────────────────────────────────────────
    const fsw = ctx.fsWrite;
    const projectDir = claudeProjectDir(config.homeDir, config.repoRoot);
    if (!ctx.fs.exists(projectDir)) {
      return ctx.unconfigured(
        `No claude sessions found for this repo at ${projectDir}. Run a claude session in this repo first.`,
      );
    }

    // Session selection: explicit --session → current CLAUDE_CODE_SESSION_ID → sole session.
    const explicit = ctx.options.session as string | undefined;
    const current = ctx.env.get('CLAUDE_CODE_SESSION_ID');
    const sessions = sessionFiles(ctx.fs.readdir(projectDir));
    let sessionFile: string | null = null;
    if (explicit && sessions.includes(`${explicit}.jsonl`)) sessionFile = `${explicit}.jsonl`;
    else if (current && sessions.includes(`${current}.jsonl`)) sessionFile = `${current}.jsonl`;
    else if (sessions.length === 1) sessionFile = sessions[0] ?? null;
    if (!sessionFile) {
      return ctx.unconfigured(
        `Could not pick a claude session (${sessions.length} found). Pass --session <id> explicitly.`,
      );
    }

    const sourcePath = `${projectDir}/${sessionFile}`;
    const raw = ctx.fs.readText(sourcePath);
    if (raw == null) {
      return ctx.error('E_READ', `Could not read the session transcript at ${sourcePath}.`, {
        next_action: 'Confirm the file exists and is readable, then re-run.',
      });
    }

    // SCRUB before anything is written anywhere outside the gitignored raw stage.
    const scrubbed = scrubText(raw, config);
    const instance = (ctx.options.instance as string | undefined) ?? defaultInstanceId(ctx.clock.nowIso());
    const note =
      (ctx.options.note as string | undefined) ?? `real ${surface} session captured from this machine`;
    const meta = buildMeta(surface, ctx.clock.nowIso(), 'claude-code', note);
    const rawName = rawFilename(surface);

    // Stage: the UNSCRUBBED original lives ONLY in gitignored scratch/ (P12); the
    // scrubbed candidate sits beside it for review/diff.
    const stageDir = `${scratchRoot(config.repoRoot)}/${surface}/${instance}`;
    fsw.mkdirp(stageDir);
    fsw.writeText(`${stageDir}/raw.unscrubbed.${rawName.split('.').slice(1).join('.')}`, raw);
    fsw.writeText(`${stageDir}/${rawName}`, scrubbed);
    fsw.writeText(`${stageDir}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`);

    const dryRun = ctx.options.dryRun === true;
    if (dryRun) {
      return ctx.ok(
        { surface, instance, staged: stageDir, promoted: false },
        {
          next_action:
            `Review ${stageDir}/${rawName} for anything sensitive, then re-run WITHOUT --dry-run to promote.`,
        },
      );
    }

    // Promote the SCRUBBED candidate + meta to the corpus (uncommitted — the human
    // review + git commit in T006 is the real publication gate).
    const corpusDir = instanceDir(config.repoRoot, surface, instance);
    fsw.mkdirp(corpusDir);
    fsw.writeText(`${corpusDir}/${rawName}`, scrubbed);
    fsw.writeText(`${corpusDir}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`);

    return ctx.ok(
      { surface, instance, corpusDir, rawFile: `${corpusDir}/${rawName}`, promoted: true },
      {
        next_action:
          `MANUAL REVIEW REQUIRED before commit: read ${corpusDir}/${rawName} end-to-end for anything ` +
          `sensitive (it lands in a public repo, permanently). Only then \`git add\` + commit it.`,
      },
    );
  },
};

export default captureFixtures;
