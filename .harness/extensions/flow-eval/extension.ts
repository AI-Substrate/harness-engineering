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
import { renderMarkdownFromReportJson, writeReport } from './report.js';
import { contentHash, readLedger, type TelemetrySummary } from './ledger.js';
import { compareModels, renderLedgerList } from './ledger-view.js';
import type { ResolveContext, SessionEvidence } from './resolvers.js';
import { buildJudgeProvenance, join, loadScenario } from './scenario.js';
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

/**
 * F-A: detect the subject worktree's short HEAD via `git rev-parse --short HEAD`
 * (run against the WORKTREE cwd). Returns the trimmed sha, or `null` on ANY
 * failure or empty output — an honest "couldn't detect", never a throw and never
 * a false drift claim. Only called when `--worktree` was explicitly given.
 */
async function detectWorktreeHead(ctx: VerbContext, worktree: string): Promise<string | null> {
  const r = await ctx.exec('git', ['rev-parse', '--short', 'HEAD'], { cwd: worktree });
  if (!r.ok) return null;
  const head = r.stdout.trim();
  return head.length > 0 ? head : null;
}

/**
 * Parse the `telemetry session save` envelope's `totals` into a denormalized
 * {@link TelemetrySummary}. Returns `null` when ANY of the four cost fields is
 * missing or non-finite — an honest "no summary" (a reader counts + excludes the
 * run), NEVER a zero-filled fabrication (F4 / 2.5).
 */
function parseTelemetrySummary(totals: unknown): TelemetrySummary | null {
  if (typeof totals !== 'object' || totals === null) return null;
  const t = totals as Record<string, unknown>;
  const tok = t.tokens as Record<string, unknown> | undefined;
  const cache = t.cache as Record<string, unknown> | undefined;
  const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const active = fin(t.active_time_s);
  const inTok = fin(tok?.input);
  const outTok = fin(tok?.output);
  const cRead = fin(cache?.read);
  const cCreate = fin(cache?.create);
  const turns = fin(t.turns);
  if (active === null || inTok === null || outTok === null || cRead === null || cCreate === null || turns === null) {
    return null;
  }
  return { active_time_s: active, tokens: { input: inTok, output: outTok }, cache: { read: cRead, create: cCreate }, turns };
}

/**
 * Snapshot the session's cost/export via the READ-ONLY `telemetry session save`
 * verb (F4). This is ONE extra exec AFTER scoring — it is `save`, NOT `get`, so
 * the evidence-fetch-once contract is untouched. Returns the written export path
 * + a {@link TelemetrySummary} parsed from the envelope `totals`, or `null` on
 * ANY failure (verb missing/errored, non-ok or absent envelope, unparsable
 * totals) — honest degradation, never a throw, never fabricated zeros.
 */
async function saveTelemetrySummary(
  ctx: VerbContext,
  harnessSessionId: string,
  outPath: string,
): Promise<{ session_export: string; telemetry_summary: TelemetrySummary } | null> {
  const r = await ctx.exec('harness', [
    'telemetry',
    'session',
    'save',
    harnessSessionId,
    '--out',
    outPath,
    '--no-html',
    '--json',
  ]);
  if (!r.ok) return null;
  try {
    const env = JSON.parse(r.stdout) as { status?: string; data?: { out?: unknown; totals?: unknown } };
    if (env.status !== 'ok' || typeof env.data !== 'object' || env.data === null) return null;
    const out = typeof env.data.out === 'string' && env.data.out.length > 0 ? env.data.out : outPath;
    const summary = parseTelemetrySummary(env.data.totals);
    return summary === null ? null : { session_export: out, telemetry_summary: summary };
  } catch {
    return null;
  }
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

  // F-A: the HONEST subject + base_ref. `--subject-*` / `--base-ref` overrides win
  // over `scenario.json#subject` / `base.ref`; they cascade to the report header,
  // the RunRecord.subject/base_ref, AND the seed_tuple (buildRunRecord derives the
  // seed from these same values, so they stay lock-step).
  const subjectHarness = strOpt(ctx, 'subjectHarness') ?? loaded.scenario.config.subject.harness;
  const subjectModel = strOpt(ctx, 'subjectModel') ?? loaded.scenario.config.subject.model;
  const subjectEffort = strOpt(ctx, 'subjectEffort') ?? loaded.scenario.config.subject.effort;
  const baseRef = strOpt(ctx, 'baseRef') ?? loaded.scenario.config.base.ref;

  // F-A: when a worktree is explicitly given, detect its HEAD and surface a VISIBLE
  // warning (envelope + report.md) when it disagrees with the effective base_ref —
  // never a crash, never a silent pass. A failed/empty detection ⇒ no warning.
  const worktreeOpt = strOpt(ctx, 'worktree');
  const warnings: string[] = [];
  if (worktreeOpt) {
    const head = await detectWorktreeHead(ctx, worktreeOpt);
    if (head !== null && head !== baseRef) {
      warnings.push(
        `worktree HEAD ${head} ≠ base_ref ${baseRef} — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong`,
      );
    }
  }
  const baseRefWarning = warnings.length > 0 ? warnings[0] : null;

  const rc: ResolveContext = {
    evidence,
    worktree,
    fs: ctx.fs,
    exec: (command, args, opts) => ctx.exec(command, args, opts),
  };
  const scored = await scoreScenario(loaded.scenario.assertions, rc, loaded.scenario.config.judge);
  const finishedAt = ctx.clock.nowIso();
  const runId = makeRunId(startedAt, session);
  const provenance = {
    judge: buildJudgeProvenance(loaded.scenario.config.judge, subjectModel),
  };

  // Seed-tuple hashes: the `--compare` match key (scenario_hash + base_ref) + a
  // packet-drift key (prompt_hash). Hashed from the raw bundle bytes — a null
  // read hashes as empty (an honest, stable "absent"), never a throw.
  const dir = loaded.scenario.dir;
  const scenarioRaw = ctx.fs.readText(join(dir, 'scenario.json')) ?? '';
  const assertionsRaw = ctx.fs.readText(join(dir, loaded.scenario.config.assertions)) ?? '';
  const subjectPromptRaw = ctx.fs.readText(join(dir, loaded.scenario.config.prompts.subject)) ?? '';
  const scenarioHash = contentHash(scenarioRaw, assertionsRaw);
  const promptHash = contentHash(subjectPromptRaw);
  const orchestratorId = ctx.env.get('PIJ_SESSION_ID');

  // F4: snapshot the session's cost/export IF the telemetry evidence gave us the
  // HARNESS session id (`--session` is a pij id; `telemetry session save` is keyed
  // by the harness id — the reviewer's blocker). ONE extra READ-ONLY exec AFTER
  // scoring; ANY failure ⇒ honest nulls (cost stays absent, never zero-filled).
  let sessionExport: string | null = null;
  let telemetrySummary: TelemetrySummary | null = null;
  const harnessSessionId = evidence?.harness_session_id ?? null;
  if (harnessSessionId && ctx.fsWrite) {
    const exportPath = join(ctx.cwd, '.harness', 'live-testing', slug, runId, 'session-export.json');
    const saved = await saveTelemetrySummary(ctx, harnessSessionId, exportPath);
    if (saved) {
      sessionExport = saved.session_export;
      telemetrySummary = saved.telemetry_summary;
    }
  }

  // The read-then-write surface the ledger append needs: `ctx.fsWrite` has no
  // append + no read, so pair its writers with `ctx.fs.readText` (task 2.2).
  const reportIo = ctx.fsWrite
    ? {
        readText: (p: string): string | null => ctx.fs.readText(p),
        writeText: (p: string, c: string): void => ctx.fsWrite?.writeText(p, c),
        mkdirp: (p: string): void => ctx.fsWrite?.mkdirp(p),
      }
    : undefined;

  const written = writeReport(
    {
      scenario: slug,
      run_id: runId,
      subject: {
        harness: subjectHarness,
        model: subjectModel,
        pij_session_id: session,
        ...(subjectEffort !== undefined && {
          effort: subjectEffort,
        }),
      },
      base_ref: baseRef,
      ...(baseRefWarning !== null && { base_ref_warning: baseRefWarning }),
      started_at: startedAt,
      finished_at: finishedAt,
      scored,
      provenance,
      ledger: {
        seed: {
          scenario_hash: scenarioHash,
          prompt_hash: promptHash,
          ...(orchestratorId !== undefined && orchestratorId.length > 0 && {
            orchestrator_id: orchestratorId,
          }),
        },
        telemetry_available: evidence !== null,
        // F13 wall-span from the telemetry evidence; honest `null` when absent.
        duration_s: evidence?.duration_s ?? null,
        // F4: real cost provenance when the session's harness id was known + the
        // `telemetry session save` snapshot succeeded; honest `null` otherwise
        // (a missing summary is counted + excluded by the reader, NEVER zeroed).
        session_export: sessionExport,
        telemetry_summary: telemetrySummary,
        provenance,
      },
    },
    ctx.cwd,
    reportIo,
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
      ...(written.ledger !== undefined && { ledger: written.ledger }),
      ...(warnings.length > 0 && { warnings }),
    },
    {
      evidence: [
        { label: 'flow-eval report (json)', path: written.files.json },
        { label: 'flow-eval report (md)', path: written.files.md },
        ...(written.ledger !== undefined
          ? [{ label: 'flow-eval ledger', path: written.ledger }]
          : []),
      ],
      next_action:
        scored.judged.length > 0
          ? `Fill the ${scored.judged.length} judged field(s) in ${written.files.json}, then run \`harness flow-eval render --scenario ${slug} --run ${runId}\` to re-render report.md.`
          : `Read the report at ${written.files.md}.`,
    },
  );
}

/**
 * `flow-eval render` — F-C: regenerate `report.md` from the CURRENT `report.json`
 * (including any judged verdicts/rationale/by the orchestrator filled AFTER the
 * original `score`). Idempotent; NO telemetry fetch; NO ledger write (the ledger
 * is append-only — a filled judged verdict never retro-mutates a ledger line).
 */
function runRender(ctx: VerbContext): VerbResult {
  const slug = strOpt(ctx, 'scenario');
  const runId = strOpt(ctx, 'run');
  if (!slug || !runId) {
    return ctx.error('E_ARGS', 'both --scenario <slug> and --run <run-id> are required', {
      next_action: 'Re-run: harness flow-eval render --scenario <slug> --run <run-id>',
    });
  }
  if (!ctx.fsWrite) {
    return ctx.error('E_NO_FSWRITE', 'this core build does not provide ctx.fsWrite', {
      next_action: 'Upgrade the engineering-harness core to render reports.',
    });
  }
  const dir = join(ctx.cwd, '.harness', 'live-testing', slug, runId);
  const jsonPath = join(dir, 'report.json');
  const mdPath = join(dir, 'report.md');
  const raw = ctx.fs.readText(jsonPath);
  if (raw === null) {
    return ctx.error('E_NOT_FOUND', `no report.json at ${jsonPath}`, {
      next_action: `Run \`harness flow-eval score --scenario ${slug} --session <pij-id>\` first, or check the --run id.`,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ctx.error('E_REPORT', `report.json at ${jsonPath} is not valid JSON`, {
      next_action: 'Repair or regenerate the report.json (re-run `score`).',
    });
  }
  const rendered = renderMarkdownFromReportJson(parsed);
  if (!rendered.ok) {
    return ctx.error('E_REPORT', rendered.error, {
      next_action: 'The report.json is missing fields the renderer needs; re-run `score`.',
    });
  }
  try {
    ctx.fsWrite.writeText(mdPath, rendered.md);
  } catch (err) {
    return ctx.error('E_WRITE', `failed to write report.md: ${err instanceof Error ? err.message : String(err)}`, {
      next_action: 'Check write permissions on the run directory.',
    });
  }
  return ctx.ok(
    {
      scenario: slug,
      run_id: runId,
      files: { json: jsonPath, md: mdPath },
      judged_total: rendered.judged_total,
      judged_filled: rendered.judged_filled,
    },
    {
      evidence: [{ label: 'flow-eval report (md)', path: mdPath }],
      next_action: `Re-rendered report.md from report.json (${rendered.judged_filled}/${rendered.judged_total} judged filled). The ledger is append-only — judged verdicts do NOT retro-mutate ledger lines.`,
    },
  );
}

/** Normalize the repeatable `--compare` flag to a string[] (commander may hand a string or array). */
function compareModels_opt(ctx: VerbContext): string[] {
  const v = ctx.options.compare;
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
  if (typeof v === 'string' && v.trim().length > 0) return [v.trim()];
  return [];
}

/**
 * `flow-eval ledger` — the READ verb over the scenario ledger (tasks 2.4/2.5). No
 * `--compare` ⇒ the longitudinal list (runs over time + per-lane flips); one or
 * more `--compare <model>` ⇒ the model-vs-model board (refuses a mismatched
 * scenario_hash/base_ref). Pure read: never fetches telemetry, never drives pij.
 */
function runLedger(ctx: VerbContext): VerbResult {
  const slug = strOpt(ctx, 'scenario');
  if (!slug) {
    return ctx.error('E_ARGS', '--scenario <slug> is required', {
      next_action: 'Re-run: harness flow-eval ledger --scenario <slug> [--compare <model> --compare <model>]',
    });
  }
  const { records, skipped } = readLedger(ctx.cwd, slug, ctx.fs);
  const compare = compareModels_opt(ctx);

  if (compare.length > 0) {
    const cmp = compareModels(slug, records, compare);
    if (!cmp.ok) {
      return ctx.error('E_COMPARE', cmp.error, {
        next_action:
          'Compare needs ≥2 --compare <model> groups sharing one scenario_hash + base_ref. Inspect the ledger with `harness flow-eval ledger --scenario ' +
          `${slug}\`.`,
      });
    }
    return ctx.ok(
      { scenario: slug, ...cmp.data, skipped, board: cmp.board },
      { next_action: `Model-vs-model board for ${compare.join(' vs ')} (see \`board\`). ✱ = Wilson-separated / McNemar-significant.` },
    );
  }

  const list = renderLedgerList(slug, records);
  return ctx.ok(
    { ...list.data, skipped, board: list.board },
    {
      next_action:
        records.length === 0
          ? `No runs recorded for ${slug} yet — run \`harness flow-eval score --scenario ${slug} --session <pij-id>\`.`
          : `${records.length} run(s); ${list.data.flipped_lanes.length} flipped lane(s). Read \`board\` for the history.`,
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
    judge: {
      model: 'gpt-5.5',
      model_version: 'gpt-5.5-2026-07-01',
      criteria: ['plan-coherence', 'report-contract-coverage', 'explanation-matches-telemetry'],
      different_family_than_subject: true,
      artifact_only: true,
      identity_stripped: true,
      temperature: 0,
      version_pinned: true,
      anti_verbosity: 'Do not reward length, rhetorical polish, or confidence without artifact evidence.',
    },
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
        params: {},
        describe: 'artifact-only judge review over the configured sub-criteria',
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
      `# Orchestrator prompt — ${slug}\n\nTODO: how the orchestrator drives the-flow over pij for this scenario.\n\n## Judge scaffold\n\nUse only verified artifacts (report.json/report.md, deterministic result rows, session-export.json, and worktree artifacts). Do not feed subject prose, transcript text, identity hints, or self-report into the judge.\n\nScore each configured criterion after concise evidence notes, then choose pass | fail | unknown. The canonical good-flow anchor slot is intentionally present but deferred until the human-gold calibration set lands.\n`,
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
    'Flow-conformance evaluator: `score` a finished pij session, `render` its report from filled judged fields, read the run `ledger` (+ `--compare`), or `scaffold` a scenario. Never drives pij.',
  description:
    'Actions:\n' +
    '  score    --scenario <slug> --session <pij-id> [--worktree <path>]   collect evidence + resolve + write report + append the ledger\n' +
    '  render   --scenario <slug> --run <run-id>                          regenerate report.md from the CURRENT report.json (filled judged fields)\n' +
    '  ledger   --scenario <slug> [--compare <model> --compare <model>]    read runs over time (per-lane flips) or a model-vs-model board\n' +
    '  scaffold --slug <slug>                                             write a ready-to-edit scenario skeleton\n\n' +
    'score loads live-testing/scenarios/<slug>/, fetches the session telemetry ONCE via `harness telemetry get --json`, ' +
    'resolves every assertion to pass/fail/unknown, scores it (unknowns excluded; a required capability/safety fail caps the verdict to FAIL), ' +
    'writes report.{json,md} to .harness/live-testing/<slug>/<run-id>/, and appends one RunRecord to .harness/live-testing/<slug>/ledger.jsonl. ' +
    '`--subject-*` / `--base-ref` override the recorded subject/base_ref (report + ledger + seed_tuple stay lock-step); a worktree HEAD that disagrees with base_ref surfaces a visible warning. ' +
    'render regenerates report.md from the on-disk report.json after the orchestrator fills judged verdicts — idempotent, no telemetry, no ledger write (the ledger is append-only). ' +
    'ledger reads that ledger back: the default lists runs + per-lane verdict history with flips marked; --compare groups by model and renders ' +
    'pass^k + Wilson CIs per axis + McNemar per binary lane + cost columns (refusing a comparison across a mismatched scenario_hash/base_ref). ' +
    'The orchestrator drives pij/the-flow in the shell; this verb only READS the resulting evidence + worktree.',
  args: [{ name: '[action]', description: 'score | render | ledger | scaffold' }],
  options: [
    { flags: '--scenario <slug>', description: '(score|ledger) Scenario slug under live-testing/scenarios/' },
    { flags: '--session <pij-id>', description: '(score) The pij session id whose telemetry to score' },
    {
      flags: '--worktree <path>',
      description: "(score) The subject's worktree root (fs lane + telemetry locator); defaults to cwd",
    },
    {
      flags: '--subject-harness <harness>',
      description: '(score) Override the subject harness recorded in the report/ledger/seed_tuple (else scenario.json#subject.harness)',
    },
    {
      flags: '--subject-model <model>',
      description: '(score) Override the subject model recorded in the report/ledger/seed_tuple (else scenario.json#subject.model)',
    },
    {
      flags: '--subject-effort <effort>',
      description: '(score) Override the subject effort recorded in the report/ledger/seed_tuple (else scenario.json#subject.effort)',
    },
    {
      flags: '--base-ref <ref>',
      description: '(score) Override the base ref recorded in the report/ledger/seed_tuple, and compared against the worktree HEAD (else scenario.json#base.ref)',
    },
    {
      flags: '--run <run-id>',
      description: '(render) The run-id under .harness/live-testing/<slug>/ whose report.md to regenerate from report.json',
    },
    {
      flags: '--compare <models...>',
      description: '(ledger) A model to include in a model-vs-model board (repeatable; ≥2 to compare)',
    },
    { flags: '--slug <slug>', description: '(scaffold) The scenario slug to scaffold' },
  ],
  run(ctx: VerbContext): VerbResult | Promise<VerbResult> {
    const action = (ctx.args.action ?? '').trim();
    if (action === 'score') return runScore(ctx);
    if (action === 'render') return runRender(ctx);
    if (action === 'ledger') return runLedger(ctx);
    if (action === 'scaffold') return runScaffold(ctx);
    return ctx.error('E_ACTION', `unknown action '${action || '(none)'}' — expected 'score', 'render', 'ledger', or 'scaffold'`, {
      next_action:
        'Run `harness flow-eval score --scenario <slug> --session <pij-id>`, `harness flow-eval render --scenario <slug> --run <run-id>`, `harness flow-eval ledger --scenario <slug> [--compare <model> --compare <model>]`, or `harness flow-eval scaffold --slug <slug>`.',
    });
  },
};

export default flowEval;
