import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { GitReadPort, ShardBlob } from '../adapters/git/git-read-port.js';
import { type GitWritePort, TELEMETRY_REF_GLOB } from '../adapters/git/git-write-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { formatError, formatOk } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { posixDirname, posixJoin } from '../services/shared/posix-path.js';
import { telemetryDir } from '../services/telemetry/cursor.js';
import { otlpLogsToEvents } from '../services/telemetry/otlp/logs.js';
import { type ReportColumn, renderReports } from '../services/telemetry/render/report-html.js';
import {
  buildReport,
  type ReportFilter,
  type ReportSortKey,
  type TelemetryReport,
} from '../services/telemetry/report.js';
import { getSessionEvidence } from '../services/telemetry/session-evidence.js';
import { combineSession, type SessionExport } from '../services/telemetry/session-export.js';
import {
  fingerprintBlobs,
  nextSweepCache,
  parseMonth,
  parseTelemetryRef,
  planMonthSweep,
  refInMonth,
  SWEEP_CACHE_FILE,
  type SweepCache,
  type SweepRefInput,
} from '../services/telemetry/sweep.js';
import { syncTelemetry } from '../services/telemetry/sync-service.js';

/** The ports the `telemetry` act injects into the sync service (a subset of VerbActDeps). */
export interface TelemetryActDeps {
  fs: FsPort;
  proc: ProcessPort;
  clock: Clock;
  env: EnvPort;
  /** The git WRITE plumbing (orphan-ref flush) — injected by the composition root (never built here). */
  gitWrite: GitWritePort;
  /**
   * OPTIONAL git READ plumbing (`session save --source git-ref|auto`) — injected by
   * the composition root (`ExecGitRead`). Absent in unit tests that never exercise
   * the git-ref source, so the git-ref branch fails honestly when it is not wired.
   */
  gitRead?: GitReadPort;
}

const SESSION_FILE_SUFFIX = '.session.json';
const REPORT_FILE_SUFFIX = '.report.json';

/** The fs surface the report sweep/render reach through (P2: no `node:*` here). */
type ReportFs = Pick<FsPort, 'exists' | 'readText' | 'readdir' | 'mkdirp' | 'writeText'>;

/** The read surface `combineSession` consumes — a temp buffer OR wrapped shard blobs. */
type CombineFs = Pick<FsPort, 'readText' | 'readdir'>;

/** Every committed telemetry shard blob for one session (all its date-sharded refs, flattened). */
function readSessionShards(gitRead: GitReadPort, sessionId: string): ShardBlob[] {
  const refs = gitRead
    .listTelemetryRefs(TELEMETRY_REF_GLOB)
    .filter((r) => r.endsWith(`/${sessionId}`));
  const blobs: ShardBlob[] = [];
  for (const ref of refs) blobs.push(...gitRead.readShardTree(ref));
  return blobs;
}

/** The `<seq>` a shard/buffer file belongs to (`<seq>.json|.logs.jsonl|.metrics.jsonl`), else null. */
function seqOfShardName(name: string): number | null {
  const m = /^(\d+)\.(?:json|logs\.jsonl|metrics\.jsonl)$/.exec(name);
  return m === null ? null : Number.parseInt(m[1], 10);
}

/**
 * Wrap a session's flat shard blobs as a {@link CombineFs} rooted at `sessionDir`,
 * so `combineSession` reads committed bytes through the SAME injection seam as the
 * temp buffer. When `base` is provided (`--source auto`), git-ref SHADOWS temp at
 * **SEQ granularity, not filename**: because a committed shard is `<seq>.logs.jsonl`
 * (+`.metrics.jsonl`) while temp is `<seq>.json`, a filename-only union would let the
 * temp `<seq>.json` win (its identity/tokens leak into a "git-ref" export). So every
 * temp `<seq>.{json,logs.jsonl,metrics.jsonl}` whose `<seq>` the git-ref set owns is
 * DROPPED — git-ref wins for any seq it has; temp fills only the seqs git-ref lacks.
 */
function shardCombineFs(blobs: ShardBlob[], sessionDir: string, base?: CombineFs): CombineFs {
  const byName = new Map(blobs.map((b) => [b.name, b.content] as const));
  const gitRefSeqs = new Set<number>();
  for (const b of blobs) {
    const seq = seqOfShardName(b.name);
    if (seq !== null) gitRefSeqs.add(seq);
  }
  // A temp file is shadowed when git-ref owns its <seq> — never surfaced from temp.
  const tempShadowed = (name: string): boolean => {
    const seq = seqOfShardName(name);
    return seq !== null && gitRefSeqs.has(seq);
  };
  const nameIn = (p: string): string | null => {
    const norm = p.replace(/\\/g, '/');
    return norm.startsWith(`${sessionDir}/`) ? norm.slice(sessionDir.length + 1) : null;
  };
  return {
    readText(p: string): string | null {
      const name = nameIn(p);
      if (name !== null && byName.has(name)) return byName.get(name) ?? null;
      // A shadowed temp seq belongs to git-ref — serve git-ref bytes or null, never temp.
      if (name !== null && tempShadowed(name)) return null;
      return base?.readText(p) ?? null;
    },
    readdir(p: string): string[] {
      const isSessionDir = p.replace(/\\/g, '/') === sessionDir;
      const names = new Set<string>();
      for (const n of base?.readdir(p) ?? []) {
        if (isSessionDir && tempShadowed(n)) continue;
        names.add(n);
      }
      if (isSessionDir) for (const n of byName.keys()) names.add(n);
      return [...names];
    },
  };
}

/**
 * Combine one session from committed telemetry shards (`--source git-ref`), or from
 * a git-ref-shadows-temp union (`--source auto`). Reads read-only through the git
 * READ port; the temp path is never touched. `auto` with no committed shard falls
 * back to a pure-temp combine (`kind:'temp'`).
 */
function combineSessionFromGitRef(
  sessionId: string,
  auto: boolean,
  gitRead: GitReadPort,
  deps: TelemetryActDeps,
): SessionExport {
  const blobs = readSessionShards(gitRead, sessionId);
  const sessionDir = posixJoin(telemetryDir(deps.proc.cwd()), sessionId);
  const fs = shardCombineFs(blobs, sessionDir, auto ? deps.fs : undefined);
  const gitBacked = !auto || blobs.length > 0;
  return combineSession(
    sessionId,
    { fs, proc: deps.proc, env: deps.env },
    gitBacked ? { kind: 'git-ref', sourceRoot: TELEMETRY_REF_GLOB } : { kind: 'temp' },
  );
}

/**
 * Combine ONE session from an EXPLICIT ref list — the month sweep's PLANNED,
 * in-month refs — rather than re-globbing every ref for the session (F1/AC-01).
 * The re-glob path ({@link readSessionShards}) folds ALL of a session's shards into
 * the combine, so a session with both June AND July refs would leak June shards
 * into a July sweep. The sweep therefore combines exactly `s.refs` (git-ref source,
 * never `auto`/temp): a month report is scoped to that month's committed shards.
 */
function combineSessionFromRefs(
  sessionId: string,
  refs: readonly string[],
  gitRead: GitReadPort,
  deps: TelemetryActDeps,
): SessionExport {
  const blobs: ShardBlob[] = [];
  for (const ref of refs) blobs.push(...gitRead.readShardTree(ref));
  const sessionDir = posixJoin(telemetryDir(deps.proc.cwd()), sessionId);
  const fs = shardCombineFs(blobs, sessionDir, undefined);
  return combineSession(
    sessionId,
    { fs, proc: deps.proc, env: deps.env },
    { kind: 'git-ref', sourceRoot: TELEMETRY_REF_GLOB },
  );
}

/**
 * Recursively collect every `*.session.json` under `paths` (a file, a folder, or a
 * mix). A directory is walked; a `*.session.json` file is taken; anything else is
 * ignored. Never throws (a file's `readdir` is `[]`, a dir's `readText` is null).
 * Returns a de-duplicated, sorted path list (stable report input).
 */
function sweepSessionFiles(fs: ReportFs, paths: readonly string[]): string[] {
  const found = new Set<string>();
  const seen = new Set<string>();
  const walk = (p: string): void => {
    const norm = p.replace(/\\/g, '/');
    if (seen.has(norm)) return;
    seen.add(norm);
    if (norm.endsWith(SESSION_FILE_SUFFIX)) {
      if (fs.readText(norm) !== null) found.add(norm);
      return;
    }
    for (const name of fs.readdir(norm)) walk(posixJoin(norm, name));
  };
  for (const p of paths) walk(p);
  return [...found].sort();
}

/** True if a parsed doc looks like a `SessionExport` (defensive — skip stray JSON). */
function isSessionExport(doc: unknown): doc is SessionExport {
  if (typeof doc !== 'object' || doc === null) return false;
  const d = doc as Record<string, unknown>;
  return (
    typeof d.identity === 'object' &&
    d.identity !== null &&
    typeof d.signals === 'object' &&
    d.signals !== null
  );
}

/** Read + parse each swept file into a `SessionExport`, de-duped by `harness_session_id`. */
function readExports(
  fs: ReportFs,
  filePaths: readonly string[],
): { exports: SessionExport[]; skipped: number } {
  const exports: SessionExport[] = [];
  const byId = new Set<string>();
  let skipped = 0;
  for (const path of filePaths) {
    const raw = fs.readText(path);
    if (raw === null) {
      skipped++;
      continue;
    }
    let doc: unknown;
    try {
      doc = JSON.parse(raw);
    } catch {
      skipped++;
      continue;
    }
    if (!isSessionExport(doc)) {
      skipped++;
      continue;
    }
    const id = doc.identity.harness_session_id;
    if (byId.has(id)) continue;
    byId.add(id);
    exports.push(doc);
  }
  return { exports, skipped };
}

/**
 * Make a user-supplied input path safe to embed in a report (P12): a path under
 * cwd becomes repo-relative; anything else collapses to its basename so no
 * absolute `/Users/<name>/…` home path can leak into the artifact.
 */
function sanitizeInputPath(p: string, cwd: string): string {
  const norm = p.replace(/\\/g, '/');
  const isAbs = /^([A-Za-z]:)?\//.test(norm);
  if (!isAbs) return norm;
  const cwdN = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  if (norm === cwdN) return '.';
  if (norm.startsWith(`${cwdN}/`)) return `./${norm.slice(cwdN.length + 1)}`;
  return norm.split('/').filter(Boolean).pop() ?? norm;
}

/** Split a comma list option into a trimmed, non-empty array (or undefined). */
function listOpt(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  const items = v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

interface ReportOptions {
  out: string;
  name?: string;
  filterHarness?: string;
  filterModel?: string;
  filterBranch?: string;
  filterRepo?: string;
  from?: string;
  to?: string;
  sort: string;
  top?: string;
  html: boolean;
}

/** Assemble a `ReportFilter` from the parsed `--filter-*` / `--from` / `--to` options. */
function filterFromOptions(o: ReportOptions, cwd: string): ReportFilter {
  const filter: ReportFilter = {};
  const harness = listOpt(o.filterHarness);
  const model = listOpt(o.filterModel);
  const branch = listOpt(o.filterBranch);
  const repo = listOpt(o.filterRepo);
  if (harness) filter.harness = harness;
  if (model) filter.model = model;
  if (branch) filter.branch = branch;
  // P12: `--filter-repo` is echoed verbatim into the committed report JSON
  // (`filter.repo` + `provenance.repos`) and inline-embedded into the HTML, so a
  // path-like value must be home-stripped exactly like `source_paths` — otherwise
  // `--filter-repo /Users/<name>/private/repo` leaks an absolute home path into a
  // publishable artifact. Repo is echo-only (not applied by matchesFilter), so this
  // never changes which sessions are included.
  if (repo) filter.repo = repo.map((r) => sanitizeInputPath(r, cwd));
  if (o.from !== undefined) filter.date_from = o.from;
  if (o.to !== undefined) filter.date_to = o.to;
  return filter;
}

/** A filesystem-safe report stem from `--name` or the filter facets (never empty). */
function deriveReportName(name: string | undefined, filter: ReportFilter): string {
  const raw =
    name ??
    filter.model?.join('-') ??
    filter.harness?.join('-') ??
    filter.branch?.join('-') ??
    'report';
  const clean = raw.replace(/[/\\]/g, '-').trim();
  return clean.length > 0 ? clean : 'report';
}

/** A `--sort` string narrowed to the supported keys (default `tokens`). */
function sortKey(v: string): ReportSortKey {
  return v === 'time' || v === 'count' ? v : 'tokens';
}

/**
 * Render EVERY `*.report.json` in a folder into one self-contained `index.html`
 * (the co-location contract: N reports → N labelled columns). Each column is
 * headed by its file stem. No data regeneration — pure embed (T008 · KF-04).
 */
function renderReportFolder(fs: ReportFs, dir: string): { htmlPath: string; count: number } {
  const columns: ReportColumn[] = [];
  for (const name of fs
    .readdir(dir)
    .filter((n) => n.endsWith(REPORT_FILE_SUFFIX))
    .sort()) {
    const raw = fs.readText(posixJoin(dir, name));
    if (raw === null) continue;
    try {
      const report = JSON.parse(raw) as TelemetryReport;
      columns.push({ label: name.slice(0, -REPORT_FILE_SUFFIX.length), report });
    } catch {
      // a malformed report file is skipped, never fatal
    }
  }
  const htmlPath = posixJoin(dir, 'index.html');
  fs.mkdirp(dir);
  fs.writeText(htmlPath, renderReports(columns));
  return { htmlPath, count: columns.length };
}

/** Swap a `.session.json` / `.json` tail for `.html` (the co-produced session view path). */
function htmlPathForSession(outPath: string): string {
  if (outPath.endsWith(SESSION_FILE_SUFFIX)) {
    return `${outPath.slice(0, -SESSION_FILE_SUFFIX.length)}.html`;
  }
  if (outPath.endsWith('.json')) return `${outPath.slice(0, -'.json'.length)}.html`;
  return `${outPath}.html`;
}

/** Read the on-disk per-sweep export cache ({} when absent / malformed — never throws). */
function readSweepCache(fs: ReportFs, path: string): SweepCache {
  const raw = fs.readText(path);
  if (raw === null) return {};
  try {
    const doc = JSON.parse(raw) as unknown;
    if (typeof doc !== 'object' || doc === null) return {};
    const out: SweepCache = {};
    for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Register the `telemetry` command family (plan 034 Phase 4). A CORE command
 * (reserved, like `flow`/`record`/`observe`) mirroring the `flow` family shape.
 * Its `sync` verb flushes the gitignored telemetry buffer to per-(date,session)
 * shard refs under `refs/harness-telemetry/` via plumbing — no business logic
 * here; `sync-service` does the work, this maps the outcome onto the Envelope +
 * exit code (ok → 0; a failed shard push / ref-update → error exit 1, the buffer
 * left intact for retry).
 */
export function registerTelemetryAct(program: Command, io: CliIo, deps: TelemetryActDeps): void {
  const telemetry = program
    .command('telemetry')
    .description(
      'Telemetry — flush counts-only segments to dated refs (`sync`) and read a pij session’s evidence (`get`)',
    );

  telemetry
    .command('sync')
    .description(
      'Flush buffered telemetry to refs/harness-telemetry/<date>/<session> shards (best-effort per-shard push)',
    )
    .action(() => {
      const result = syncTelemetry({
        fs: deps.fs,
        env: deps.env,
        proc: deps.proc,
        git: deps.gitWrite,
      });

      if (!result.ok) {
        const envelope = formatError(
          'telemetry',
          ErrorCodes.UNKNOWN,
          result.message ?? 'telemetry sync failed',
          deps.clock,
          {
            next_action:
              'Sync is best-effort; the buffer is intact and will retry on the next `harness telemetry sync`.',
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  io.writers.err(`harness telemetry sync: ${e.error?.message ?? 'failed'}\n`);
                  if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const envelope = formatOk(
        'telemetry',
        {
          synced: result.segments,
          sessions: result.sessions,
          pushed: result.pushed,
          plans: result.plans,
        },
        deps.clock,
        {
          next_action:
            result.segments === 0
              ? 'Nothing buffered to flush.'
              : 'Segments flushed to refs/harness-telemetry/<date>/<session>; the scraper fetches refs/harness-telemetry/* in one pass.',
        },
      );
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                io.writers.out(
                  result.segments === 0
                    ? 'telemetry sync: nothing to flush\n'
                    : `telemetry sync: flushed ${result.segments} segment(s) across ${result.sessions} session(s)${result.pushed ? ' and pushed' : ''}\n`,
                );
              },
            };
      exitWithEnvelope(envelope, port);
    });

  telemetry
    .command('get')
    .description(
      "Read a pij session's telemetry into a normalized, counts-only evidence object (the conformance scorer's telemetry lane)",
    )
    .argument('<pij-session-id>', 'The pij session id whose telemetry to resolve')
    .option(
      '--worktree <path>',
      'Worktree root whose buffer to read (overrides pij-folder resolution)',
    )
    .action(async (pijSessionId: string, options: { worktree?: string }) => {
      const evidence = await getSessionEvidence(
        pijSessionId,
        { fs: deps.fs, env: deps.env, proc: deps.proc },
        options.worktree ? { worktree: options.worktree } : undefined,
      );

      // Unknown id → honest error envelope (exit 1); the buffer is never mutated.
      if (evidence === null) {
        const envelope = formatError(
          'telemetry',
          ErrorCodes.UNKNOWN,
          `no telemetry found for pij session '${pijSessionId}'`,
          deps.clock,
          {
            next_action:
              'Check the id (`pij list`); telemetry is captured per command — run a harness command in that session, then retry. Use --worktree <path> if it ran from a git worktree.',
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  io.writers.err(`harness telemetry get: ${e.error?.message ?? 'not found'}\n`);
                  if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const envelope = formatOk('telemetry', evidence, deps.clock, {
        next_action:
          'Counts-only evidence derived from the session event stream; the conformance scorer consumes it as its telemetry lane.',
      });
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                const gaps = evidence.gaps.length ? `, gaps: ${evidence.gaps.join(',')}` : '';
                io.writers.out(
                  `telemetry get: ${evidence.segments} segment(s), ${evidence.skill_order.length} skill(s), ${Object.keys(evidence.tools).length} tool(s)${gaps}\n`,
                );
              },
            };
      exitWithEnvelope(envelope, port);
    });

  const session = telemetry
    .command('session')
    .description('Session export — combine one session’s telemetry into a single SessionExport');

  session
    .command('save')
    .description(
      'Combine a session’s buffered segments into one schema-valid SessionExport (.session.json)',
    )
    .argument('<session-id>', 'The harness session id (the telemetry buffer subdir) to combine')
    .option(
      '--source <source>',
      'Where to read from: temp (local buffer) | git-ref (committed shards) | auto (git-ref shadows temp)',
      'temp',
    )
    .option(
      '--out <path>',
      'Output path for the .session.json (default: <session-id>.session.json)',
    )
    .option('--no-html', 'Suppress the co-produced self-contained HTML view (default: on)')
    .action((sessionId: string, options: { source: string; out?: string; html: boolean }) => {
      const source = options.source;
      const saveErrorPort = (): OutputPort =>
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: (e) => {
                io.writers.err(`harness telemetry session save: ${e.error?.message ?? 'failed'}\n`);
                if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
              },
            };

      // Sources: temp (local buffer, P1) | git-ref (committed shards, P3) | auto
      // (git-ref shadows temp). Anything else is an honest error.
      if (source !== 'temp' && source !== 'git-ref' && source !== 'auto') {
        exitWithEnvelope(
          formatError(
            'telemetry',
            ErrorCodes.UNKNOWN,
            `--source '${source}' is not recognized (expected: temp | git-ref | auto)`,
            deps.clock,
            { next_action: 'Use --source temp | git-ref | auto.' },
          ),
          saveErrorPort(),
        );
        return;
      }

      let exp: SessionExport;
      if (source === 'temp') {
        exp = combineSession(sessionId, { fs: deps.fs, proc: deps.proc, env: deps.env });
      } else {
        // git-ref | auto both need the read port; it is composition-root-injected.
        if (deps.gitRead === undefined) {
          exitWithEnvelope(
            formatError(
              'telemetry',
              ErrorCodes.UNKNOWN,
              `--source '${source}' needs the git read port, which is not available in this context`,
              deps.clock,
              {
                next_action: 'Invoke via the harness CLI — the composition root wires ExecGitRead.',
              },
            ),
            saveErrorPort(),
          );
          return;
        }
        exp = combineSessionFromGitRef(sessionId, source === 'auto', deps.gitRead, deps);
      }

      // No segments for this id → honest error (exit 1); the buffer is never mutated.
      if (exp.source.segment_count === 0) {
        const envelope = formatError(
          'telemetry',
          ErrorCodes.UNKNOWN,
          `no telemetry segments found for session '${sessionId}'`,
          deps.clock,
          {
            next_action:
              'Check the session id (the telemetry buffer subdir under .harness/temp/telemetry); run a harness command in that session, then retry.',
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  io.writers.err(
                    `harness telemetry session save: ${e.error?.message ?? 'not found'}\n`,
                  );
                  if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const outPath = options.out ?? posixJoin(deps.proc.cwd(), `${sessionId}.session.json`);
      const dir = posixDirname(outPath);
      if (dir.length > 0) deps.fs.mkdirp(dir);
      deps.fs.writeText(outPath, `${JSON.stringify(exp, null, 2)}\n`);

      // Build the report ONCE (reused for the totals block below AND the HTML view):
      // the SAME renderer as `telemetry report`, no second one (F-03).
      const report = buildReport([exp], {
        sourcePaths: [posixJoin('.harness/temp/telemetry', sessionId)],
        generatedAt: deps.clock.nowIso(),
      });
      // A compact, denormalized totals block so a downstream consumer (e.g.
      // `flow-eval score`'s ledger `telemetry_summary`) can read all four cost
      // fields from ONE stable source: active (idle-excluded) time + non-cache
      // tokens + cache from the report totals, turns = the count of `turn` events.
      const totals = {
        active_time_s: report.totals.time_s,
        tokens: { input: report.totals.tokens.input, output: report.totals.tokens.output },
        cache: { read: report.totals.cache.read, create: report.totals.cache.create },
        turns: otlpLogsToEvents(exp.signals.logs).filter((e) => e.kind === 'turn').length,
      };

      // Co-produce the session VIEW (T008): the N=1 `report` render — the SAME
      // report object built above, no re-derivation. `--no-html` suppresses.
      const evidence: { label: string; path: string }[] = [
        { label: 'session export', path: outPath },
      ];
      let htmlOut: string | undefined;
      if (options.html !== false) {
        htmlOut = htmlPathForSession(outPath);
        const label = exp.identity.harness.length > 0 ? exp.identity.harness : sessionId;
        deps.fs.writeText(htmlOut, renderReports([{ label, report }]));
        evidence.push({ label: 'session view', path: htmlOut });
      }

      const envelope = formatOk(
        'telemetry',
        {
          session_id: sessionId,
          segment_count: exp.source.segment_count,
          schema_versions: exp.summary.segment_schema_versions,
          degraded: exp.summary.degraded,
          out: outPath,
          html: htmlOut ?? null,
          totals,
        },
        deps.clock,
        {
          evidence,
          next_action:
            'A schema-valid SessionExport (combined OTel) + its self-contained HTML view. Roll many up with `harness telemetry report`.',
        },
      );
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                const deg = exp.summary.degraded.length
                  ? ` (degraded: ${exp.summary.degraded.join(',')})`
                  : '';
                const view = htmlOut ? ` (+ ${htmlOut})` : '';
                io.writers.out(
                  `telemetry session save: combined ${exp.source.segment_count} segment(s) → ${outPath}${view}${deg}\n`,
                );
              },
            };
      exitWithEnvelope(envelope, port);
    });

  telemetry
    .command('report')
    .description(
      'Roll up 1..N saved *.session.json into one TelemetryReport (+ a self-contained HTML) — recursive sweep, filterable',
    )
    .argument(
      '<paths...>',
      'One or more *.session.json files, folders (swept recursively), or a mix',
    )
    .option(
      '--out <dir-or-file>',
      'Output folder (json + index.html), or a *.json file for data-only',
      './telemetry-report',
    )
    .option(
      '--name <label>',
      'Report file stem + HTML column label (default: derived from the filter)',
    )
    .option(
      '--filter-harness <a,b>',
      'Only sessions from these harnesses (claude-code | copilot-cli | cursor | …)',
    )
    .option('--filter-model <m,…>', 'Only sessions using these models')
    .option('--filter-branch <b,…>', 'Only sessions on these branches')
    .option(
      '--filter-repo <r,…>',
      'Echoed into report.filter (repo is not a v1 session facet — not applied)',
    )
    .option('--from <iso>', 'Only sessions whose activity reaches on/after this instant')
    .option('--to <iso>', 'Only sessions whose activity starts on/before this instant')
    .option('--sort <key>', 'Rollup row ordering: tokens | time | count', 'tokens')
    .option('--top <n>', 'Cap rows per rollup (records rollup.truncated; never silent)')
    .option('--no-html', 'Data-only: skip the co-produced HTML render')
    .action((paths: string[], options: ReportOptions) => {
      const files = sweepSessionFiles(deps.fs, paths);
      const { exports, skipped } = readExports(deps.fs, files);

      if (exports.length === 0) {
        const envelope = formatError(
          'telemetry',
          ErrorCodes.UNKNOWN,
          `no *.session.json sessions found under ${paths.join(', ')}`,
          deps.clock,
          {
            next_action:
              'Point `report` at a folder of *.session.json files (produce them with `harness telemetry session save`).',
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  io.writers.err(
                    `harness telemetry report: ${e.error?.message ?? 'no sessions'}\n`,
                  );
                  if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const filter = filterFromOptions(options, deps.proc.cwd());
      const top = options.top !== undefined ? Number.parseInt(options.top, 10) : undefined;
      const report = buildReport(exports, {
        filter,
        sort: sortKey(options.sort),
        ...(top !== undefined && Number.isFinite(top) ? { top } : {}),
        sourcePaths: paths.map((p) => sanitizeInputPath(p, deps.proc.cwd())),
        generatedAt: deps.clock.nowIso(),
      });
      const reportJson = `${JSON.stringify(report, null, 2)}\n`;

      // `--out foo.json` = data-only single file; otherwise a folder (json + co-located HTML).
      const outIsFile = options.out.endsWith('.json');
      const evidence: { label: string; path: string }[] = [];
      let jsonPath: string;
      let htmlPath: string | undefined;
      let columns = 0;

      if (outIsFile) {
        jsonPath = options.out;
        const d = posixDirname(jsonPath);
        if (d.length > 0) deps.fs.mkdirp(d);
        deps.fs.writeText(jsonPath, reportJson);
        evidence.push({ label: 'report', path: jsonPath });
      } else {
        const dir = options.out;
        const name = deriveReportName(options.name, filter);
        jsonPath = posixJoin(dir, `${name}${REPORT_FILE_SUFFIX}`);
        deps.fs.mkdirp(dir);
        deps.fs.writeText(jsonPath, reportJson);
        evidence.push({ label: 'report', path: jsonPath });
        if (options.html !== false) {
          // Co-produce this report's own self-contained view (1 column). A
          // multi-arm COMPARISON is `report --no-html` per arm + `report-render`
          // over the folder (workshop 003) — that verb renders every report present.
          htmlPath = posixJoin(dir, 'index.html');
          deps.fs.writeText(htmlPath, renderReports([{ label: name, report }]));
          columns = 1;
          evidence.push({ label: 'report view', path: htmlPath });
        }
      }

      const envelope = formatOk(
        'telemetry',
        {
          sessions: report.scope.session_count,
          single: report.scope.single,
          skipped,
          filter: report.filter,
          totals: report.totals,
          out: jsonPath,
          html: htmlPath ?? null,
          columns,
        },
        deps.clock,
        {
          evidence,
          next_action: htmlPath
            ? 'Open the index.html under file:// (self-contained). Add more pre-filtered reports to the folder + `report-render` to compare.'
            : 'A schema-valid TelemetryReport. Render it with `harness telemetry report-render <folder>`.',
        },
      );
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                const view = htmlPath ? ` (+ ${htmlPath})` : '';
                io.writers.out(
                  `telemetry report: rolled up ${report.scope.session_count} session(s) → ${jsonPath}${view}\n`,
                );
              },
            };
      exitWithEnvelope(envelope, port);
    });

  telemetry
    .command('report-render')
    .description(
      'Render the *.report.json in a folder into one self-contained index.html (N reports → N labelled columns; no data regen)',
    )
    .argument('<folder>', 'A folder containing one or more *.report.json files')
    .action((folder: string) => {
      const reports = deps.fs.readdir(folder).filter((n) => n.endsWith(REPORT_FILE_SUFFIX));
      if (reports.length === 0) {
        const envelope = formatError(
          'telemetry',
          ErrorCodes.UNKNOWN,
          `no *.report.json files found in ${folder}`,
          deps.clock,
          {
            next_action:
              'Produce reports with `harness telemetry report <paths…> --out <folder>`, then render the folder.',
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  io.writers.err(
                    `harness telemetry report-render: ${e.error?.message ?? 'no reports'}\n`,
                  );
                  if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const { htmlPath, count } = renderReportFolder(deps.fs, folder);
      const envelope = formatOk('telemetry', { out: htmlPath, columns: count }, deps.clock, {
        evidence: [{ label: 'report view', path: htmlPath }],
        next_action:
          'Open index.html under file:// (self-contained, no server). Each *.report.json in the folder is one column.',
      });
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                io.writers.out(`telemetry report-render: ${count} report(s) → ${htmlPath}\n`);
              },
            };
      exitWithEnvelope(envelope, port);
    });

  telemetry
    .command('sweep')
    .description(
      'Sweep ONE month of committed telemetry (refs/harness-telemetry/YYYY/MM/*) into a report (+ HTML) — from refs alone, re-runnable (per-session export cache)',
    )
    .requiredOption('--month <YYYY-MM>', 'The month to sweep (e.g. 2026-07)')
    .option(
      '--out <dir>',
      'Output folder (the month report json + index.html + the export cache)',
      './telemetry-report',
    )
    .option('--no-html', 'Data-only: skip the co-produced HTML render')
    .action((options: { month: string; out: string; html: boolean }) => {
      const sweepPort = (): OutputPort =>
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: (e) => {
                io.writers.err(`harness telemetry sweep: ${e.error?.message ?? 'failed'}\n`);
                if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
              },
            };

      // A malformed month is an honest error — never a silent empty sweep.
      if (parseMonth(options.month) === null) {
        exitWithEnvelope(
          formatError(
            'telemetry',
            ErrorCodes.UNKNOWN,
            `--month '${options.month}' is not a valid YYYY-MM`,
            deps.clock,
            { next_action: 'Pass a calendar month, e.g. --month 2026-07.' },
          ),
          sweepPort(),
        );
        return;
      }

      // The month sweep composes the git-ref read path — it needs the read port.
      if (deps.gitRead === undefined) {
        exitWithEnvelope(
          formatError(
            'telemetry',
            ErrorCodes.UNKNOWN,
            'telemetry sweep needs the git read port, which is not available in this context',
            deps.clock,
            { next_action: 'Invoke via the harness CLI — the composition root wires ExecGitRead.' },
          ),
          sweepPort(),
        );
        return;
      }
      const gitRead = deps.gitRead;

      // Enumerate every committed telemetry ref ONCE, keep the in-month ones, and
      // fingerprint each ref's shard tree (the cache's tip proxy). The pure planner
      // groups by session + decides reuse-vs-reexport.
      const refInputs: SweepRefInput[] = [];
      for (const ref of gitRead.listTelemetryRefs(TELEMETRY_REF_GLOB)) {
        const parsed = parseTelemetryRef(ref);
        if (parsed === null || !refInMonth(parsed.datePath, options.month)) continue;
        refInputs.push({
          ref,
          session: parsed.session,
          datePath: parsed.datePath,
          fingerprint: fingerprintBlobs(gitRead.readShardTree(ref)),
        });
      }

      const outDir = options.out;
      const cachePath = posixJoin(outDir, SWEEP_CACHE_FILE);
      const plan = planMonthSweep(options.month, refInputs, readSweepCache(deps.fs, cachePath));

      // Per-session export: reuse an unchanged session's prior .session.json (cache
      // hit); otherwise re-export from EXACTLY this month's PLANNED refs (`s.refs`),
      // so a session that also has other-month refs never leaks them into this
      // month's report (F1/AC-01). The cache key already follows the planned refs
      // (the combined fingerprint is over `s.refs`), so a different month's sweep of
      // the same session re-exports rather than reusing this artifact.
      const sessionsDir = posixJoin(outDir, 'sessions');
      const exports: SessionExport[] = [];
      let exported = 0;
      let reused = 0;
      let empty = 0;
      for (const s of plan.sessions) {
        const sessionPath = posixJoin(sessionsDir, `${s.session}${SESSION_FILE_SUFFIX}`);
        if (s.cached && deps.fs.exists(sessionPath)) {
          const raw = deps.fs.readText(sessionPath);
          if (raw !== null) {
            try {
              const doc = JSON.parse(raw) as unknown;
              if (isSessionExport(doc)) {
                exports.push(doc);
                reused++;
                continue;
              }
            } catch {
              // fall through to a fresh export when the cached file is unreadable
            }
          }
        }
        const exp = combineSessionFromRefs(s.session, s.refs, gitRead, deps);
        if (exp.source.segment_count === 0) {
          empty++;
          continue;
        }
        deps.fs.mkdirp(sessionsDir);
        deps.fs.writeText(sessionPath, `${JSON.stringify(exp, null, 2)}\n`);
        exports.push(exp);
        exported++;
      }

      // Roll the month up with the SAME builder as `report` — version-tolerant: a
      // v2.0 thin shard folds to time-only rows with the token gap DECLARED in
      // provenance.token_coverage (never a fabricated zero, never a crash).
      const report = buildReport(exports, {
        sourcePaths: [plan.month_prefix],
        generatedAt: deps.clock.nowIso(),
      });

      deps.fs.mkdirp(outDir);
      const jsonPath = posixJoin(outDir, `${options.month}${REPORT_FILE_SUFFIX}`);
      deps.fs.writeText(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
      const evidence: { label: string; path: string }[] = [{ label: 'report', path: jsonPath }];
      let htmlPath: string | undefined;
      if (options.html !== false) {
        htmlPath = posixJoin(outDir, 'index.html');
        deps.fs.writeText(htmlPath, renderReports([{ label: options.month, report }]));
        evidence.push({ label: 'report view', path: htmlPath });
      }

      // Persist the cache LAST so a re-sweep skips the unchanged sessions.
      deps.fs.writeText(cachePath, `${JSON.stringify(nextSweepCache(plan), null, 2)}\n`);

      const envelope = formatOk(
        'telemetry',
        {
          month: options.month,
          sessions: report.scope.session_count,
          exported,
          reused,
          empty,
          token_coverage: report.provenance.token_coverage,
          out: jsonPath,
          html: htmlPath ?? null,
        },
        deps.clock,
        {
          evidence,
          next_action: htmlPath
            ? 'Open the index.html under file:// (self-contained). Re-run to refresh; unchanged sessions are cache-skipped.'
            : 'A schema-valid month TelemetryReport. Render it with `harness telemetry report-render <folder>`.',
        },
      );
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                const view = htmlPath ? ` (+ ${htmlPath})` : '';
                io.writers.out(
                  `telemetry sweep ${options.month}: ${report.scope.session_count} session(s) [${exported} exported, ${reused} reused] → ${jsonPath}${view}\n`,
                );
              },
            };
      exitWithEnvelope(envelope, port);
    });
}
