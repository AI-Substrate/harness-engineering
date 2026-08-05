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
import {
  appendAnnotation,
  buildSupersedeAnnotation,
  contentHash,
  readLedger,
  supersededRunIds,
  type TelemetrySummary,
} from './ledger.js';
import { compareModels, renderLedgerList } from './ledger-view.js';
import type { ResolveContext, SessionEvidence } from './resolvers.js';
import { isPlaceholderToken } from './resolvers.js';
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
 * Parse the repeatable `--resolve <id>=<command>` flag into an `id → command` map
 * (task 4.6, SUGG-003). Each entry is split on the FIRST `=` (a command may itself
 * contain `=`); a blank id or command is ignored. commander may hand a single string
 * or an array (variadic) — both are normalized. Never throws.
 */
function resolveMap_opt(ctx: VerbContext): Record<string, string> {
  const v = ctx.options.resolve;
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  const out: Record<string, string> = {};
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    const id = entry.slice(0, eq).trim();
    const command = entry.slice(eq + 1).trim();
    if (id.length > 0 && command.length > 0) out[id] = command;
  }
  return out;
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

/** The stable per-session suffix a run-id ends with (all runs of one pij session share it). */
function sessionSuffix(session: string): string {
  return session.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'run';
}

/** Build a deterministic run-id from the clock + session (no Math.random). */
function makeRunId(nowIso: string, session: string): string {
  const stamp = nowIso.replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-');
  return `${stamp}-${sessionSuffix(session)}`;
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

/** A full 40-char git oid. */
const FULL_OID = /^[0-9a-f]{40}$/;
/** Any hex string long enough to be a meaningful abbreviated oid (git's floor is 4; 7 is the common short form). */
const HEX_OID = /^[0-9a-f]{4,40}$/;

/**
 * Resolve a ref to its FULL 40-char oid inside the worktree, or `null` when it does
 * not resolve there (a branch that doesn't exist in this checkout, a typo, no git).
 * `^{commit}` peels annotated tags so a tag and the commit it points at compare equal.
 */
async function resolveOid(ctx: VerbContext, worktree: string, ref: string): Promise<string | null> {
  const r = await ctx.exec('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: worktree });
  if (!r.ok) return null;
  const oid = r.stdout.trim().toLowerCase();
  return FULL_OID.test(oid) ? oid : null;
}

/**
 * FX003 · D3 — does the worktree's HEAD disagree with the declared `base_ref`?
 *
 * Three states, because there are three facts (the ruling: a literal `HEAD` is not a
 * pinned base, it is the ABSENCE of one — say so rather than falling silent):
 *
 *  - `null` — no finding. Either they are the same commit, or HEAD could not be read
 *    at all (an honest "couldn't detect" never becomes a drift accusation).
 *  - an UNPINNED note — `base.ref` is the literal `HEAD` (what `scaffold` writes by
 *    default), so the scenario pins nothing and the run is not reproducible. This is
 *    a real finding, not a permanent pass: comparing HEAD to itself could never warn.
 *  - a DRIFT warning — two genuinely different commits.
 *
 * The comparison itself resolves BOTH sides to full oids, so an abbreviated sha and
 * the full sha OF THE SAME COMMIT no longer read as drift (the pre-fix bug: a raw
 * string `!==` of `--short` HEAD against a 40-char `base.ref`). When the declared ref
 * will not resolve in this worktree, fall back to a hex-prefix comparison so the
 * abbreviation case is still handled without git.
 */
async function baseRefFinding(
  ctx: VerbContext,
  worktree: string,
  baseRef: string,
): Promise<string | null> {
  const head = await detectWorktreeHead(ctx, worktree);
  if (head === null) return null;

  const declared = baseRef.trim();
  if (declared === 'HEAD') {
    return (
      `base_ref is the literal 'HEAD' — this scenario pins NO base commit, so the run is not reproducible ` +
      `and the recorded seed_tuple.base_ref cannot identify what was scored (worktree HEAD is ${head}). ` +
      `Pin it: set base.ref in scenario.json to a sha, or pass --base-ref <sha>`
    );
  }

  const headOid = await resolveOid(ctx, worktree, 'HEAD');
  const baseOid = await resolveOid(ctx, worktree, declared);
  if (headOid !== null && baseOid !== null) {
    return headOid === baseOid
      ? null
      : `worktree HEAD ${head} (${headOid}) ≠ base_ref ${declared} (${baseOid}) — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong`;
  }

  // The declared ref does not resolve here (or git could not answer). Compare the raw
  // strings PREFIX-tolerantly: an abbreviation of the same commit must not warn, and
  // git guarantees a unique-prefix abbreviation, so a shared prefix is the honest test.
  const h = head.toLowerCase();
  const b = declared.toLowerCase();
  if (HEX_OID.test(h) && HEX_OID.test(b) && (h.startsWith(b) || b.startsWith(h))) return null;
  if (h === b) return null;
  return `worktree HEAD ${head} ≠ base_ref ${declared} — the scored worktree was not cut from the declared base_ref; the recorded seed_tuple.base_ref may be wrong`;
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

  // F-A / FX003 · D3: when a worktree is explicitly given, compare its HEAD to the
  // effective base_ref and surface a VISIBLE finding (envelope + report.md) — drift,
  // or an unpinned base — never a crash, never a silent pass. Both sides resolve to
  // full oids first, so an abbreviated sha of the SAME commit is not drift.
  const worktreeOpt = strOpt(ctx, 'worktree');
  const warnings: string[] = [];
  if (worktreeOpt) {
    const finding = await baseRefFinding(ctx, worktreeOpt, baseRef);
    if (finding !== null) warnings.push(finding);
  }
  const baseRefWarning = warnings.length > 0 ? warnings[0] : null;

  // 4.6 (SUGG-003): per-run assertion resolution. `--resolve <id>=<cmd>` overrides a
  // `command-succeeds` cmd WITHOUT mutating the committed bundle; the scenario's
  // `placeholder_policy` decides how an UNRESOLVED placeholder behaves (default 'raw').
  const resolutions = resolveMap_opt(ctx);
  const placeholderPolicy = loaded.scenario.config.placeholder_policy ?? 'raw';
  // Surface a visible note for every command-succeeds placeholder left unresolved
  // under the 'unknown' policy (its row will resolve `unknown`, never a silent pass).
  if (placeholderPolicy === 'unknown') {
    for (const asrt of loaded.scenario.assertions) {
      if (asrt.type !== 'command-succeeds') continue;
      if (asrt.id in resolutions) continue;
      const cmd = typeof asrt.params.cmd === 'string' ? asrt.params.cmd : '';
      if (cmd.length > 0 && isPlaceholderToken(cmd)) {
        warnings.push(
          `unresolved placeholder ${cmd} for ${asrt.id} — pass --resolve ${asrt.id}='<command>' (it resolved unknown, not run)`,
        );
      }
    }
  }

  const rc: ResolveContext = {
    evidence,
    worktree,
    fs: ctx.fs,
    exec: (command, args, opts) => ctx.exec(command, args, opts),
    resolutions,
    placeholderPolicy,
  };
  const scored = await scoreScenario(loaded.scenario.assertions, rc, loaded.scenario.config.judge);
  const finishedAt = ctx.clock.nowIso();
  const runId = makeRunId(startedAt, session);
  const provenance = {
    judge: buildJudgeProvenance(loaded.scenario.config.judge, subjectModel),
    ...(Object.keys(resolutions).length > 0 && { resolutions }),
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
  // 4.6 (SUGG-004): cheap re-score detection — a prior ledger record whose run_id
  // shares THIS session's suffix is very likely the same session re-scored, so hint
  // at `supersede`. All runs of one pij session share the `-<suffix>` run-id tail.
  let priorSessionRuns: string[] = [];
  if (written.ledger !== undefined) {
    const tail = `-${sessionSuffix(session)}`;
    priorSessionRuns = readLedger(ctx.cwd, slug, ctx.fs)
      .records.filter((r) => r.run_id !== runId && r.run_id.endsWith(tail))
      .map((r) => r.run_id);
  }
  const baseNext =
    scored.judged.length > 0
      ? `Fill the ${scored.judged.length} judged field(s) in ${written.files.json}, then run \`harness flow-eval render --scenario ${slug} --run ${runId}\` to re-render report.md.`
      : `Read the report at ${written.files.md}.`;
  const supersedeHint =
    priorSessionRuns.length > 0
      ? ` NOTE: ${priorSessionRuns.length} prior run(s) of this session are recorded (${priorSessionRuns.join(', ')}); if this re-score corrects one, run \`harness flow-eval supersede --scenario ${slug} --run <old-run-id> --by ${runId}\`.`
      : '';
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
      ...(priorSessionRuns.length > 0 && { prior_session_runs: priorSessionRuns }),
    },
    {
      evidence: [
        { label: 'flow-eval report (json)', path: written.files.json },
        { label: 'flow-eval report (md)', path: written.files.md },
        ...(written.ledger !== undefined
          ? [{ label: 'flow-eval ledger', path: written.ledger }]
          : []),
      ],
      next_action: baseNext + supersedeHint,
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
  const { records, skipped, annotations } = readLedger(ctx.cwd, slug, ctx.fs);
  const superseded = supersededRunIds(annotations);
  const compare = compareModels_opt(ctx);

  if (compare.length > 0) {
    const cmp = compareModels(slug, records, compare, superseded);
    if (!cmp.ok) {
      return ctx.error('E_COMPARE', cmp.error, {
        next_action:
          'Compare needs ≥2 --compare <model> groups sharing one scenario_hash + base_ref. Inspect the ledger with `harness flow-eval ledger --scenario ' +
          `${slug}\`.`,
      });
    }
    return ctx.ok(
      { ...cmp.data, scenario: slug, skipped, board: cmp.board },
      { next_action: `Model-vs-model board for ${compare.join(' vs ')} (see \`board\`). ✱ = Wilson-separated / McNemar-significant. Superseded runs are excluded.` },
    );
  }

  const list = renderLedgerList(slug, records, superseded);
  return ctx.ok(
    { ...list.data, skipped, board: list.board },
    {
      next_action:
        records.length === 0
          ? `No runs recorded for ${slug} yet — run \`harness flow-eval score --scenario ${slug} --session <pij-id>\`.`
          : `${records.length} run(s); ${list.data.flipped_lanes.length} flipped lane(s)${list.data.superseded_runs.length > 0 ? `; ${list.data.superseded_runs.length} superseded` : ''}. Read \`board\` for the history.`,
    },
  );
}

/**
 * `flow-eval supersede` — mark a stale run superseded by a corrected re-score
 * (task 4.6, SUGG-004). APPENDS one annotation line (`{kind:"supersede", …}`) to
 * the scenario ledger; existing RunRecord lines stay byte-stable (append-only is
 * sacred). `ledger` then flags the superseded run and `--compare` excludes it, but
 * the stale line itself is never rewritten or deleted.
 */
function runSupersede(ctx: VerbContext): VerbResult {
  const slug = strOpt(ctx, 'scenario');
  const oldRun = strOpt(ctx, 'run');
  const byRun = strOpt(ctx, 'by');
  if (!slug || !oldRun || !byRun) {
    return ctx.error('E_ARGS', 'all of --scenario <slug>, --run <old-run-id> and --by <new-run-id> are required', {
      next_action: 'Re-run: harness flow-eval supersede --scenario <slug> --run <old-run-id> --by <new-run-id>',
    });
  }
  // A run cannot supersede itself: that would tombstone it (excluded from --compare)
  // with no corrected replacement, violating the stale-by-corrected contract. Reject
  // BEFORE any append so the ledger stays byte-identical.
  if (oldRun === byRun) {
    return ctx.error('E_ARGS', `a run cannot supersede itself (--run and --by are both '${oldRun}')`, {
      next_action: `Score the corrected run first, then \`harness flow-eval supersede --scenario ${slug} --run ${oldRun} --by <new-run-id>\`.`,
    });
  }
  if (!ctx.fsWrite) {
    return ctx.error('E_NO_FSWRITE', 'this core build does not provide ctx.fsWrite', {
      next_action: 'Upgrade the engineering-harness core to write the ledger annotation.',
    });
  }
  const { records } = readLedger(ctx.cwd, slug, ctx.fs);
  const has = (id: string): boolean => records.some((r) => r.run_id === id);
  if (!has(oldRun)) {
    return ctx.error('E_NOT_FOUND', `no run '${oldRun}' in the ${slug} ledger`, {
      next_action: `List the runs with \`harness flow-eval ledger --scenario ${slug}\` and re-check the --run id.`,
    });
  }
  if (!has(byRun)) {
    return ctx.error('E_NOT_FOUND', `no run '${byRun}' in the ${slug} ledger (the --by re-score must already be recorded)`, {
      next_action: `Score the corrected run first, then \`harness flow-eval supersede --scenario ${slug} --run ${oldRun} --by <new-run-id>\`.`,
    });
  }
  const annotation = buildSupersedeAnnotation({ run_id: oldRun, superseded_by: byRun, ts: ctx.clock.nowIso() });
  const io = {
    readText: (p: string): string | null => ctx.fs.readText(p),
    writeText: (p: string, c: string): void => ctx.fsWrite?.writeText(p, c),
    mkdirp: (p: string): void => ctx.fsWrite?.mkdirp(p),
  };
  const appended = appendAnnotation(annotation, ctx.cwd, slug, io);
  if (!appended.ok) {
    return ctx.error('E_LEDGER', appended.error, {
      next_action: 'Check write permissions on the scenario ledger directory.',
    });
  }
  return ctx.ok(
    { scenario: slug, superseded: oldRun, superseded_by: byRun, ledger: appended.path },
    {
      evidence: [{ label: 'flow-eval ledger', path: appended.path }],
      next_action: `Recorded: run ${oldRun} is superseded by ${byRun}. The stale line still stands (append-only); \`harness flow-eval ledger --scenario ${slug}\` now flags it and \`--compare\` excludes it.`,
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
    // D4 (plan 051): every measured scenario carries WHY it exists + how it should
    // feel — machine-adjacent but human-worded. Optional in the loader; scaffold
    // seeds it so new scenarios are never mute about their intent.
    intent: {
      reason: `TODO: why we measure ${slug} — what claim it proves (e.g. fleet beats solo on cost-per-quality for a bounded task).`,
      vibe: 'TODO: how this run should FEEL (e.g. a real team — orchestrator plans + verifies, workers build — not one model narrating three hats).',
    },
    // 4.6: NEW scenarios default to honest unknowns — an unresolved placeholder
    // command resolves `unknown` (with a note) instead of executing the literal
    // token. Resolve it per-run with `--resolve <id>=<command>` (never edit this file).
    placeholder_policy: 'unknown',
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
        type: 'command-succeeds',
        source: 'fs',
        required: true,
        params: { cmd: 'SUBJECT_VALIDATOR' },
        describe:
          "the subject's own validator passes — resolve per-run with `--resolve A3='<command>'` (placeholder_policy: unknown ⇒ an unresolved token scores unknown, never a raw exec)",
      },
      {
        id: 'A4',
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
    'Flow-conformance evaluator: `score` a finished pij session, `render` its report from filled judged fields, read the run `ledger` (+ `--compare`), `supersede` a stale run, or `scaffold` a scenario. Never drives pij.',
  description:
    'Actions:\n' +
    '  score     --scenario <slug> --session <pij-id> [--worktree <path>] [--resolve <id>=<cmd>...]   collect evidence + resolve + write report + append the ledger\n' +
    '  render    --scenario <slug> --run <run-id>                          regenerate report.md from the CURRENT report.json (filled judged fields)\n' +
    '  ledger    --scenario <slug> [--compare <model> --compare <model>]    read runs over time (per-lane flips) or a model-vs-model board\n' +
    '  supersede --scenario <slug> --run <old-run-id> --by <new-run-id>    mark a stale run superseded by a re-score (append-only annotation)\n' +
    '  scaffold  --slug <slug>                                             write a ready-to-edit scenario skeleton\n\n' +
    'score loads live-testing/scenarios/<slug>/, fetches the session telemetry ONCE via `harness telemetry get --json`, ' +
    'resolves every assertion to pass/fail/unknown, scores it (unknowns excluded; a required capability/safety fail caps the verdict to FAIL), ' +
    'writes report.{json,md} to .harness/live-testing/<slug>/<run-id>/, and appends one RunRecord to .harness/live-testing/<slug>/ledger.jsonl. ' +
    '`--subject-*` / `--base-ref` override the recorded subject/base_ref (report + ledger + seed_tuple stay lock-step); a worktree HEAD that disagrees with base_ref surfaces a visible warning. ' +
    '`--resolve <id>=<cmd>` resolves a placeholder command-succeeds assertion per-run WITHOUT editing live-testing/scenarios/ (recorded in the report + RunRecord provenance); under a scenario `placeholder_policy: "unknown"` an UNRESOLVED placeholder scores unknown, never a raw exec. ' +
    'render regenerates report.md from the on-disk report.json after the orchestrator fills judged verdicts — idempotent, no telemetry, no ledger write (the ledger is append-only). ' +
    'ledger reads that ledger back: the default lists runs + per-lane verdict history with flips + superseded runs marked; --compare groups by model and renders ' +
    'pass^k + Wilson CIs per axis + McNemar per binary lane + cost columns (refusing a comparison across a mismatched scenario_hash/base_ref; superseded runs excluded). ' +
    'supersede appends a `{kind:"supersede"}` annotation line so a corrected re-score marks the stale record without mutating any prior line. ' +
    'The orchestrator drives pij/the-flow in the shell; this verb only READS the resulting evidence + worktree.',
  args: [{ name: '[action]', description: 'score | render | ledger | supersede | scaffold' }],
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
      flags: '--resolve <pairs...>',
      description: "(score) Per-run resolution of a placeholder command-succeeds assertion: --resolve <id>=<command> (repeatable). Overrides the bundle cmd WITHOUT editing live-testing/scenarios/; recorded in report.json + the RunRecord provenance",
    },
    {
      flags: '--run <run-id>',
      description: '(render|supersede) The run-id under .harness/live-testing/<slug>/ — render regenerates its report.md; supersede marks it superseded',
    },
    {
      flags: '--by <new-run-id>',
      description: '(supersede) The corrected re-score run-id that supersedes --run (must already be recorded in the ledger)',
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
    if (action === 'supersede') return runSupersede(ctx);
    if (action === 'scaffold') return runScaffold(ctx);
    return ctx.error('E_ACTION', `unknown action '${action || '(none)'}' — expected 'score', 'render', 'ledger', 'supersede', or 'scaffold'`, {
      next_action:
        'Run `harness flow-eval score --scenario <slug> --session <pij-id>`, `harness flow-eval render --scenario <slug> --run <run-id>`, `harness flow-eval ledger --scenario <slug> [--compare <model> --compare <model>]`, `harness flow-eval supersede --scenario <slug> --run <old-run-id> --by <new-run-id>`, or `harness flow-eval scaffold --slug <slug>`.',
    });
  },
};

export default flowEval;
