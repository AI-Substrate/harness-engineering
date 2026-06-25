import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';
// DL-001 (plan 037 retro): the extension VerbContext exposes no `db` port, so the
// copilot-vscode/cursor SQLite captures compose the core NodeDb adapter directly at
// this run() composition root. node:sqlite stays sealed INSIDE NodeDb (the sanctioned
// core adapter) — never imported into this extension source, preserving P2.
import { NodeDb } from '../../../harness/cli/src/adapters/db/node-db.js';
import type { EnvPort } from '../../../harness/cli/src/adapters/env/env-port.js';
import {
  copilotVscodeStoreDbPaths,
  resolveCopilotVscodeSessionId,
} from '../../../harness/cli/src/services/telemetry/adapters/copilot-vscode-adapter.js';
// Single-source the privacy-critical scrub + projections from core telemetry (not vendored).
import {
  filterCopilotProcessLog,
  projectCopilotVscodeRows,
  redactCopilotSystemMessage,
} from '../../../harness/cli/src/services/telemetry/fixture-extract.js';
import { scrubText } from '../../../harness/cli/src/services/telemetry/fixture-scrub.js';
import {
  buildMeta,
  claudeProjectDir,
  copilotCliEventsPath,
  copilotCliLogsDir,
  defaultInstanceId,
  deriveCaptureConfig,
  instanceDir,
  isCopilotProcessLog,
  isSurface,
  pickCopilotCliSession,
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
 * scrub + projection services. The SQLite surfaces (copilot-vscode/cursor) also
 * compose the core {@link NodeDb} adapter here (DL-001): `node:sqlite` stays
 * sealed inside NodeDb, so this extension source still imports no `node:*`.
 * Capture stages to a gitignored `scratch/` first, scrubs, and (after a human
 * "anything bad" review) promotes to `fixtures/real/<surface>/<instance>/` —
 * P12-compliant by construction.
 */

const captureFixtures: HarnessVerb = {
  name: 'capture-fixtures',
  summary:
    'Capture real harness session logs into the scrubbed telemetry fixture corpus (claude, copilot-cli, copilot-vscode wired; cursor pending).',
  description:
    'Reads a real session from a local harness surface, stages it to a gitignored ' +
    'scratch/ dir, scrubs machine paths / identity / secrets (keeping prompts and ' +
    'tool calls verbatim), and — after a manual review — promotes it to ' +
    'fixtures/real/<surface>/<instance>/. Surfaces: ' +
    SURFACES.join(', ') +
    ". Wired: 'claude', 'copilot-cli', 'copilot-vscode'. Pending: 'cursor'.",
  options: [
    { flags: '--surface <surface>', description: `one of: ${SURFACES.join(' | ')}` },
    {
      flags: '--instance <id>',
      description: 'instance id for the corpus dir (default: derived from date + session)',
    },
    {
      flags: '--session <id>',
      description:
        'explicit session id (claude: default = sole session for this repo; copilot-cli: required)',
    },
    {
      flags: '--log <path>',
      description:
        'copilot-cli only: the process-*.log to read (skips the dir scan; only this session’s ' +
        'assistant_usage records are kept)',
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

    // ── Resolve the per-surface raw captures (already read; + provenance id) ──
    const resolved = resolveSources(ctx, surface, config);
    if ('result' in resolved) return resolved.result;
    const { files, harnessId } = resolved;

    // SCRUB every capture before anything is written outside gitignored scratch/.
    const fsw = ctx.fsWrite;
    const captured = files.map((f) => ({
      rawName: f.rawName,
      raw: f.raw,
      scrubbed: scrubText(f.raw, config),
    }));

    const instance = (ctx.options.instance as string | undefined) ?? defaultInstanceId(ctx.clock.nowIso());
    const note =
      (ctx.options.note as string | undefined) ?? `real ${surface} session captured from this machine`;
    const meta = buildMeta(surface, ctx.clock.nowIso(), harnessId, note);

    // Stage: the UNSCRUBBED originals live ONLY in gitignored scratch/ (P12); the
    // scrubbed candidates sit beside them for review/diff.
    const stageDir = `${scratchRoot(config.repoRoot)}/${surface}/${instance}`;
    fsw.mkdirp(stageDir);
    for (const f of captured) {
      fsw.writeText(`${stageDir}/raw.unscrubbed.${f.rawName.split('.').slice(1).join('.')}`, f.raw);
      fsw.writeText(`${stageDir}/${f.rawName}`, f.scrubbed);
    }
    fsw.writeText(`${stageDir}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`);

    if (ctx.options.dryRun === true) {
      return ctx.ok(
        { surface, instance, staged: stageDir, files: captured.map((f) => f.rawName), promoted: false },
        {
          next_action: `Review ${stageDir}/ for anything sensitive, then re-run WITHOUT --dry-run to promote.`,
        },
      );
    }

    // Promote the SCRUBBED candidates + meta to the corpus (uncommitted — the human
    // review + git commit is the real publication gate).
    const corpusDir = instanceDir(config.repoRoot, surface, instance);
    fsw.mkdirp(corpusDir);
    for (const f of captured) fsw.writeText(`${corpusDir}/${f.rawName}`, f.scrubbed);
    fsw.writeText(`${corpusDir}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`);

    return ctx.ok(
      { surface, instance, corpusDir, files: captured.map((f) => f.rawName), promoted: true },
      {
        next_action:
          `MANUAL REVIEW REQUIRED before commit: read ${corpusDir}/ end-to-end for anything ` +
          `sensitive (it lands in a public repo, permanently). Only then \`git add\` + commit it.`,
      },
    );
  },
};

type Ctx = Parameters<NonNullable<HarnessVerb['run']>>[0];
type ScrubCfg = NonNullable<ReturnType<typeof deriveCaptureConfig>>;
/** One already-read raw capture: the corpus filename + its (pre-transform) bytes. */
interface CapturedRaw {
  rawName: string;
  raw: string;
}
type Resolved = { files: CapturedRaw[]; harnessId: string } | { result: ReturnType<Ctx['ok']> };

/**
 * Read the raw captures for a surface (+ the provenance harness id), or return an
 * early `VerbResult` when the data isn't present / a surface isn't wired yet. Reads
 * happen here (not in run()) because some captures are TRANSFORMS, not file copies:
 * the copilot-cli process log is filtered to only this session's `assistant_usage`
 * records (never the raw multi-hundred-MB debug log). claude + copilot-cli are wired
 * here; copilot-vscode + cursor (SQLite) land in T006/T009.
 */
function resolveSources(ctx: Ctx, surface: string, config: ScrubCfg): Resolved {
  if (surface === 'claude') return resolveClaude(ctx, config);
  if (surface === 'copilot-cli') return resolveCopilotCli(ctx, config);
  if (surface === 'copilot-vscode') return resolveCopilotVscode(ctx, config);
  return {
    result: ctx.unconfigured(
      `'${surface}' capture lands later in Phase 2 (SQLite surface); not wired yet.`,
    ),
  };
}

/**
 * An {@link EnvPort} over the extension's `ctx.env` (`.get` only) + the resolved
 * `homeDir`. The copilot-vscode/cursor adapter path helpers need `.home()`, which
 * `ctx.env` doesn't expose (DL-001) — this bridges them without a node:* reach.
 */
function envPortFor(ctx: Ctx, config: ScrubCfg): EnvPort {
  return { get: (name) => ctx.env.get(name), home: () => config.homeDir };
}

/**
 * copilot-vscode capture (T006/AC-04). The VS Code Copilot Chat store is SQLite
 * (`globalStorage/github.copilot-chat/session-store.db`), so we compose a core
 * {@link NodeDb} here (DL-001), resolve the session by `--session` or by cwd, read
 * the raw `sessions`+`turns` rows, and project them through
 * {@link projectCopilotVscodeRows} — the privacy boundary that drops every message
 * body, keeping ONLY `turn_index`/`words`/`has_response`/`timestamp`. The promoted
 * `raw.rows.json` therefore never carries chat text (the `cwd` path is rebased by
 * the shared scrub at run()).
 */
function resolveCopilotVscode(ctx: Ctx, config: ScrubCfg): Resolved {
  const db = new NodeDb();
  const env = envPortFor(ctx, config);
  const explicit = ctx.options.session as string | undefined;
  const sid = explicit ?? resolveCopilotVscodeSessionId(db, env, ctx.cwd);
  if (sid === null || sid === undefined || sid.length === 0) {
    return {
      result: ctx.unconfigured(
        'No copilot-vscode session resolved for this cwd. Open a VS Code Copilot Chat ' +
          'session in this repo first, or pass --session <id>.',
      ),
    };
  }

  // First store path that actually has this session wins (macOS/Linux/Windows).
  for (const dbPath of copilotVscodeStoreDbPaths(env)) {
    const sessions = db.query(dbPath, 'SELECT id, cwd, updated_at FROM sessions WHERE id = ?', [
      sid,
    ]);
    if (sessions.length === 0) continue;
    // RAW turns (message text included) — read in-process only; the projection
    // strips the bodies BEFORE anything is staged or written.
    const turns = db.query(
      dbPath,
      'SELECT session_id, turn_index, user_message, assistant_response, timestamp FROM turns WHERE session_id = ? ORDER BY turn_index ASC',
      [sid],
    );
    const projected = projectCopilotVscodeRows(sessions, turns);
    const raw = `${JSON.stringify(projected, null, 2)}\n`;
    return { files: [{ rawName: 'raw.rows.json', raw }], harnessId: 'copilot-vscode' };
  }

  return {
    result: ctx.unconfigured(
      `Resolved copilot-vscode session ${sid} but no store under ` +
        `${copilotVscodeStoreDbPaths(env).join(' | ')} held it. Check the session id.`,
    ),
  };
}

function resolveClaude(ctx: Ctx, config: ScrubCfg): Resolved {
  const projectDir = claudeProjectDir(config.homeDir, config.repoRoot);
  if (!ctx.fs.exists(projectDir)) {
    return {
      result: ctx.unconfigured(
        `No claude sessions found for this repo at ${projectDir}. Run a claude session in this repo first.`,
      ),
    };
  }
  const explicit = ctx.options.session as string | undefined;
  const current = ctx.env.get('CLAUDE_CODE_SESSION_ID');
  const sessions = sessionFiles(ctx.fs.readdir(projectDir));
  let sessionFile: string | null = null;
  if (explicit && sessions.includes(`${explicit}.jsonl`)) sessionFile = `${explicit}.jsonl`;
  else if (current && sessions.includes(`${current}.jsonl`)) sessionFile = `${current}.jsonl`;
  else if (sessions.length === 1) sessionFile = sessions[0] ?? null;
  if (!sessionFile) {
    return {
      result: ctx.unconfigured(
        `Could not pick a claude session (${sessions.length} found). Pass --session <id> explicitly.`,
      ),
    };
  }
  const raw = ctx.fs.readText(`${projectDir}/${sessionFile}`);
  if (raw == null) {
    return { result: ctx.unconfigured(`Could not read ${projectDir}/${sessionFile}.`) };
  }
  return { files: [{ rawName: 'raw.jsonl', raw }], harnessId: 'claude-code' };
}

function resolveCopilotCli(ctx: Ctx, config: ScrubCfg): Resolved {
  const sid = pickCopilotCliSession(
    ctx.options.session as string | undefined,
    ctx.env.get('COPILOT_AGENT_SESSION_ID'),
  );
  if (!sid) {
    return {
      result: ctx.unconfigured(
        'copilot-cli has many sessions and ctx.fs exposes no mtime; pass --session <id> explicitly.',
      ),
    };
  }

  // events.jsonl — per-session. User prompts + tool usage stay verbatim; only the
  // vendor's ~33KB system.message body is redacted (the adapter never reads it, so
  // the segment is unchanged — this just shrinks the fixture and avoids republishing
  // a proprietary system prompt).
  const eventsPath = copilotCliEventsPath(config.homeDir, sid);
  const events = ctx.fs.readText(eventsPath);
  if (events == null) {
    return { result: ctx.unconfigured(`No copilot-cli events at ${eventsPath}. Check --session.`) };
  }
  const files: CapturedRaw[] = [
    { rawName: 'raw.events.jsonl', raw: redactCopilotSystemMessage(events) },
  ];

  // process log — find the process-*.log holding this session (or take --log), then
  // FILTER to only its assistant_usage records (never the raw interleaved debug log).
  const explicitLog = ctx.options.log as string | undefined;
  let logRaw: string | null = null;
  if (explicitLog) {
    logRaw = ctx.fs.readText(explicitLog);
    if (logRaw == null) return { result: ctx.unconfigured(`Could not read --log ${explicitLog}.`) };
  } else {
    const logsDir = copilotCliLogsDir(config.homeDir);
    for (const name of ctx.fs.readdir(logsDir)) {
      if (!isCopilotProcessLog(name)) continue;
      const c = ctx.fs.readText(`${logsDir}/${name}`);
      if (c?.includes(sid)) {
        logRaw = c;
        break;
      }
    }
  }
  if (logRaw !== null) {
    const filtered = filterCopilotProcessLog(logRaw, sid);
    if (filtered.length > 0) files.push({ rawName: 'raw.process.log', raw: filtered });
  }

  return { files, harnessId: 'copilot-cli' };
}

export default captureFixtures;
