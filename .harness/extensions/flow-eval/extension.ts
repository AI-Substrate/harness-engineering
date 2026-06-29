/**
 * `flow-eval` — the flow-conformance evaluator (plan 041 Phase 2, T006).
 *
 * A generic, config-driven engine: load a scenario bundle, resolve each
 * assertion by `type` to a three-valued verdict, score it, write the report.
 * Scenarios are pure data (Phase 3); the engine never changes per scenario.
 *
 * ONE command (`harness flow-eval <action>`) with two actions, and `score` is
 * the only ACTION verb (the contract registers one top-level command per verb,
 * so the sub-actions are a positional the verb dispatches on):
 *  - `flow-eval score --scenario <slug> --session <pij-id> [--worktree <path>]`
 *      load → fetch the session's telemetry ONCE (via the Phase-1 CLI verb
 *      `harness telemetry get --json`, NOT a CLI-internal import) → resolve every
 *      assertion (telemetry / fs / composite) → score → write the report.
 *  - `flow-eval scaffold --slug <s>` writes a ready-to-edit scenario skeleton.
 *
 * NEVER DRIVES PIJ (critic-F1): `score` consumes an already-finished session's
 * evidence + a worktree; the orchestrator drives pij + the-flow in the shell.
 * The only `harness` call is the read-only `telemetry get`; the only other exec
 * calls are scenario-authored `command-succeeds` checks against the worktree.
 *
 * Extension discipline: imports ONLY the published `contract` types; all I/O via
 * `ctx.exec` / `ctx.fs` / `ctx.fsWrite`; node-free; never throws (the kernel
 * finalizes the returned `VerbResult`).
 */

import type {
  HarnessVerb,
  VerbContext,
  VerbResult,
} from '@ai-substrate/engineering-harness/contract';
import { writeReport } from './report.js';
import type { ResolveContext, SessionEvidence } from './resolvers.js';
import { join, loadScenario } from './scenario.js';
import { scoreScenario } from './scorer.js';

/** Where committed scenario bundles live, relative to the repo cwd. */
function scenariosRoot(cwd: string): string {
  return join(cwd, 'live-testing', 'scenarios');
}

/** Coerce a string option (commander camelCases flags); blank → undefined. */
function strOpt(ctx: VerbContext, key: string): string | undefined {
  const v = ctx.options[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Fetch the session's telemetry evidence ONCE via the Phase-1 verb. Parses the
 * envelope; an error envelope, a non-ok status, or any parse failure resolves to
 * `null` — telemetry assertions then resolve `unknown`, never `fail` (the
 * determinism boundary). Never throws.
 */
async function fetchEvidence(
  ctx: VerbContext,
  session: string,
  worktree: string | undefined,
): Promise<SessionEvidence | null> {
  const args = ['telemetry', 'get', session, '--json'];
  if (worktree) args.push('--worktree', worktree);
  const r = await ctx.exec('harness', args);
  if (!r.ok) return null;
  try {
    const env = JSON.parse(r.stdout) as { status?: string; data?: unknown };
    if (env.status !== 'ok' || typeof env.data !== 'object' || env.data === null) return null;
    return env.data as SessionEvidence;
  } catch {
    return null;
  }
}

/** Build a deterministic run-id from the clock + session (no Math.random). */
function makeRunId(nowIso: string, session: string): string {
  const stamp = nowIso.replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-');
  const suffix = session.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'run';
  return `${stamp}-${suffix}`;
}

/** `flow-eval score` — the only action verb (collect evidence → resolve → report). */
async function runScore(ctx: VerbContext): Promise<VerbResult> {
  const slug = strOpt(ctx, 'scenario');
  const session = strOpt(ctx, 'session');
  if (!slug || !session) {
    return ctx.error('E_ARGS', 'both --scenario <slug> and --session <pij-id> are required', {
      next_action: 'Re-run: harness flow-eval score --scenario <slug> --session <pij-id> [--worktree <path>]',
    });
  }

  const loaded = loadScenario(slug, ctx.fs, scenariosRoot(ctx.cwd));
  if (!loaded.ok) {
    return ctx.error('E_SCENARIO', loaded.error, {
      next_action: `Fix the scenario bundle under ${join(scenariosRoot(ctx.cwd), slug)} (see \`harness flow-eval scaffold --slug ${slug}\`).`,
    });
  }

  const worktree = strOpt(ctx, 'worktree') ?? ctx.cwd;
  const startedAt = ctx.clock.nowIso();
  const evidence = await fetchEvidence(ctx, session, strOpt(ctx, 'worktree'));

  const rc: ResolveContext = {
    evidence,
    worktree,
    fs: ctx.fs,
    exec: (command, args, opts) => ctx.exec(command, args, opts),
  };
  const scored = await scoreScenario(loaded.scenario.assertions, rc);
  const finishedAt = ctx.clock.nowIso();
  const runId = makeRunId(startedAt, session);

  const written = writeReport(
    {
      scenario: slug,
      run_id: runId,
      subject: {
        harness: loaded.scenario.config.subject.harness,
        model: loaded.scenario.config.subject.model,
        pij_session_id: session,
        ...(loaded.scenario.config.subject.effort !== undefined && {
          effort: loaded.scenario.config.subject.effort,
        }),
      },
      base_ref: loaded.scenario.config.base.ref,
      started_at: startedAt,
      finished_at: finishedAt,
      scored,
    },
    ctx.cwd,
    ctx.fsWrite,
  );
  if (!written.ok) {
    return ctx.error('E_REPORT', written.error, {
      next_action: 'Upgrade the engineering-harness core (this verb needs the ctx.fsWrite capability).',
    });
  }

  const d = scored.deterministic;
  return ctx.ok(
    {
      scenario: slug,
      run_id: runId,
      verdict: scored.verdict,
      score: d.score,
      passed: d.passed,
      failed: d.failed,
      unknown: d.unknown,
      total: d.total,
      required_failed: d.required_failed,
      judged_pending: scored.judged.length,
      telemetry: { available: evidence !== null, segments: evidence?.segments ?? 0 },
      report_dir: written.dir,
      files: written.files,
    },
    {
      evidence: [
        { label: 'flow-eval report (json)', path: written.files.json },
        { label: 'flow-eval report (md)', path: written.files.md },
      ],
      next_action:
        scored.judged.length > 0
          ? `Fill the ${scored.judged.length} judged field(s) in ${written.files.json}, then read the report.`
          : `Read the report at ${written.files.md}.`,
    },
  );
}

/** Minimal, VALID scenario skeleton (loads clean; one assertion per lane). */
function scaffoldScenarioJson(slug: string): string {
  const obj = {
    slug,
    title: `TODO: title for ${slug}`,
    task: 'TODO: the one-paragraph task the subject is given.',
    base: { repo: '.', ref: 'HEAD' },
    subject: { harness: 'claude', model: 'opus', effort: 'high' },
    flow: {
      mode: 'simple',
      stages: ['explore', 'plan', 'validate', 'compact', 'implement', 'review', 'fix', 'validate'],
    },
    prompts: { orchestrator: 'prompts/orchestrator.md', subject: 'prompts/subject.md' },
    assertions: 'assertions.json',
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

function scaffoldAssertionsJson(slug: string): string {
  const obj = {
    scenario: slug,
    assertions: [
      {
        id: 'A1',
        type: 'skill-called',
        source: 'telemetry',
        required: true,
        params: { skill: 'the-flow', min: 1 },
        describe: 'drove the SDD journey via /the-flow',
      },
      {
        id: 'A2',
        type: 'file-created',
        source: 'fs',
        required: true,
        params: { glob: '.harness/extensions/*/extension.ts' },
        describe: 'created the deliverable',
      },
      {
        id: 'A3',
        type: 'judged',
        source: 'judged',
        params: { field: 'quality', prompt: 'TODO: the quality question for the orchestrator.' },
        describe: 'overall quality call',
      },
    ],
  };
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/** `flow-eval scaffold` — write a ready-to-edit scenario skeleton (never overwrites). */
function runScaffold(ctx: VerbContext): VerbResult {
  const slug = strOpt(ctx, 'slug');
  if (!slug) {
    return ctx.error('E_ARGS', '--slug <slug> is required', {
      next_action: 'Re-run: harness flow-eval scaffold --slug <slug>',
    });
  }
  if (!ctx.fsWrite) {
    return ctx.error('E_NO_FSWRITE', 'this core build does not provide ctx.fsWrite', {
      next_action: 'Upgrade the engineering-harness core to scaffold scenarios.',
    });
  }
  const dir = join(scenariosRoot(ctx.cwd), slug);
  const scenarioPath = join(dir, 'scenario.json');
  if (ctx.fs.exists(scenarioPath)) {
    return ctx.error('E_EXISTS', `scenario already exists: ${scenarioPath}`, {
      next_action: 'Pick a new --slug or edit the existing scenario in place.',
    });
  }
  const promptsDir = join(dir, 'prompts');
  try {
    ctx.fsWrite.mkdirp(promptsDir);
    ctx.fsWrite.writeText(scenarioPath, scaffoldScenarioJson(slug));
    ctx.fsWrite.writeText(join(dir, 'assertions.json'), scaffoldAssertionsJson(slug));
    ctx.fsWrite.writeText(
      join(promptsDir, 'orchestrator.md'),
      `# Orchestrator prompt — ${slug}\n\nTODO: how the orchestrator drives the-flow over pij for this scenario.\n`,
    );
    ctx.fsWrite.writeText(
      join(promptsDir, 'subject.md'),
      `# Subject prompt — ${slug}\n\nTODO: the BLIND packet — eval framing + report contract ONLY.\n`,
    );
  } catch (err) {
    return ctx.error('E_WRITE', `failed to scaffold: ${err instanceof Error ? err.message : String(err)}`, {
      next_action: 'Check write permissions on live-testing/scenarios/.',
    });
  }
  return ctx.ok(
    {
      slug,
      dir,
      files: ['scenario.json', 'assertions.json', 'prompts/orchestrator.md', 'prompts/subject.md'],
    },
    { next_action: `Edit the bundle under ${dir}, then run \`harness flow-eval score --scenario ${slug} --session <pij-id>\`.` },
  );
}

/**
 * The single registered verb. `harness flow-eval <action>` dispatches on the
 * positional action (`score` | `scaffold`) — the contract registers one
 * top-level command per verb, so the two actions live under one `flow-eval`
 * command (matching `harness flow-eval --help`).
 */
const flowEval: HarnessVerb = {
  name: 'flow-eval',
  summary:
    'Flow-conformance evaluator: `score` a finished pij session against a scenario, or `scaffold` a new scenario. Never drives pij.',
  description:
    'Actions:\n' +
    '  score    --scenario <slug> --session <pij-id> [--worktree <path>]   collect evidence + resolve + write report (the only action verb)\n' +
    '  scaffold --slug <slug>                                             write a ready-to-edit scenario skeleton\n\n' +
    'score loads live-testing/scenarios/<slug>/, fetches the session telemetry ONCE via `harness telemetry get --json`, ' +
    'resolves every assertion to pass/fail/unknown, scores it (unknowns excluded; a required fail caps the verdict to FAIL), ' +
    'and writes report.{json,md} to .harness/live-testing/<slug>/<run-id>/. The orchestrator drives pij/the-flow in the shell; ' +
    'this verb only READS the resulting evidence + worktree.',
  args: [{ name: '[action]', description: 'score | scaffold' }],
  options: [
    { flags: '--scenario <slug>', description: '(score) Scenario slug under live-testing/scenarios/' },
    { flags: '--session <pij-id>', description: '(score) The pij session id whose telemetry to score' },
    {
      flags: '--worktree <path>',
      description: "(score) The subject's worktree root (fs lane + telemetry locator); defaults to cwd",
    },
    { flags: '--slug <slug>', description: '(scaffold) The scenario slug to scaffold' },
  ],
  run(ctx: VerbContext): VerbResult | Promise<VerbResult> {
    const action = (ctx.args.action ?? '').trim();
    if (action === 'score') return runScore(ctx);
    if (action === 'scaffold') return runScaffold(ctx);
    return ctx.error('E_ACTION', `unknown action '${action || '(none)'}' — expected 'score' or 'scaffold'`, {
      next_action:
        'Run `harness flow-eval score --scenario <slug> --session <pij-id> [--worktree <path>]` or `harness flow-eval scaffold --slug <slug>`.',
    });
  },
};

export default flowEval;
