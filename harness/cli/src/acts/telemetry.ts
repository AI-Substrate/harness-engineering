import type { Command } from 'commander';
import type { Clock } from '../adapters/clock/clock-port.js';
import type { EnvPort } from '../adapters/env/env-port.js';
import type { FsPort } from '../adapters/fs/fs-port.js';
import type { GitReadPort, ShardBlob } from '../adapters/git/git-read-port.js';
import { type GitWritePort, TELEMETRY_REF_GLOB } from '../adapters/git/git-write-port.js';
import type { RemoteTelemetryGitPort } from '../adapters/git/remote-telemetry-git-port.js';
import type { HashPort } from '../adapters/hash/hash-port.js';
import type { ProcessPort } from '../adapters/process/process-port.js';
import { formatDegraded, formatError, formatOk, formatUnconfigured } from '../output/envelope.js';
import { ErrorCodes } from '../output/error-codes.js';
import { exitWithEnvelope } from '../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../output/output-port.js';
import { posixDirname, posixJoin } from '../services/shared/posix-path.js';
import { readFlushed, sanitizeSessionId, telemetryDir } from '../services/telemetry/cursor.js';
import type { MarkCountKey } from '../services/telemetry/events.js';
import { getFleetEvidence } from '../services/telemetry/fleet-evidence.js';
import { buildInsights, type InsightInput } from '../services/telemetry/insights.js';
import { runMark } from '../services/telemetry/mark.js';
import { otlpLogsToEvents } from '../services/telemetry/otlp/logs.js';
import {
  parseRemoteRepositories,
  parseRemoteSelector,
  type RawRemoteSelector,
} from '../services/telemetry/remote-input.js';
import {
  listPublishedTelemetry,
  pullPublishedTelemetry,
  type RemoteServiceFailure,
} from '../services/telemetry/remote-telemetry-service.js';
import { renderInsights } from '../services/telemetry/render/insights-html.js';
import { type ReportColumn, renderReports } from '../services/telemetry/render/report-html.js';
import {
  buildReport,
  buildReportFromInputs,
  type ReportFilter,
  type ReportSortKey,
  type TelemetryReport,
  type TelemetryReportInput,
} from '../services/telemetry/report.js';
import {
  parseManifest,
  ROLLED_LOGS_NAME,
  ROLLED_MANIFEST_NAME,
} from '../services/telemetry/rolled-shard.js';
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
import { readTelemetryBundle } from '../services/telemetry/telemetry-bundle-reader.js';

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
  /** Dedicated arbitrary-remote published telemetry reader (P060). */
  remoteGit?: RemoteTelemetryGitPort;
  /** P059 SHA-256 port consumed for repository keys and bundle integrity. */
  hash?: HashPort;
}

interface RemoteCommandOptions extends RawRemoteSelector {
  repo: string[];
  repoFile: string[];
  out?: string;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function remoteError(failure: RemoteServiceFailure): {
  code: string;
  message: string;
  next: string;
} {
  switch (failure.kind) {
    case 'transport':
      return {
        code: ErrorCodes.REMOTE_TELEMETRY_TRANSPORT_FAILED,
        message: failure.message,
        next: 'Check remote reachability and ambient Git authentication, then retry.',
      };
    case 'invalid_telemetry':
      return {
        code: ErrorCodes.REMOTE_TELEMETRY_INVALID,
        message: failure.message,
        next: 'Inspect or republish the named repository telemetry ref; unsafe bytes were not copied.',
      };
    case 'namespace_moved':
      return {
        code: ErrorCodes.REMOTE_TELEMETRY_MOVED,
        message: failure.message,
        next: 'The remote moved repeatedly; wait for publication to settle, then retry.',
      };
    case 'endpoint_unknown':
      return {
        code: ErrorCodes.REMOTE_TELEMETRY_ENDPOINT_UNKNOWN,
        message: failure.message,
        next: 'Pass full product commit OIDs reachable from every selected repository.',
      };
    case 'range_diverged':
      return {
        code: ErrorCodes.REMOTE_TELEMETRY_RANGE_DIVERGED,
        message: failure.message,
        next: 'Choose a product start commit that is an ancestor of the end commit.',
      };
    case 'session_not_found':
      return {
        code: ErrorCodes.REMOTE_TELEMETRY_SESSION_NOT_FOUND,
        message: 'the exact session was not published by any requested repository',
        next: 'Run `harness telemetry ls --repo <url>` and choose an exact terminal session id.',
      };
    case 'bundle_conflict':
      return {
        code: ErrorCodes.TELEMETRY_BUNDLE_CONFLICT,
        message: 'the exact output folder already contains different or unmanaged entries',
        next: 'Choose an absent folder, or reuse the unchanged folder produced by the same pull.',
      };
    case 'bundle_write':
      return {
        code: ErrorCodes.TELEMETRY_BUNDLE_WRITE_FAILED,
        message: 'the telemetry bundle could not be published atomically',
        next: 'Check parent-directory permissions and concurrent writers, then retry safely.',
      };
  }
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
 *
 * A ROLLED ref (plan 049 — the shape sync publishes today) carries the whole session in
 * ONE `session.logs.jsonl` whose name holds no seq, so seq-by-filename saw an EMPTY
 * git-ref seq set and shadowed nothing (R2-03). If the prune then lagged — a kill or a
 * failed delete between the ref push and the buffer cleanup — the same seq was read
 * twice, from the rolled lines AND the surviving temp `<seq>.json`, and the doubled
 * total was reported `measured`. The rolled manifest's `max_seq` is the ref's own
 * statement of which seqs it owns, so it becomes the shadow floor.
 */
function shardCombineFs(
  blobs: ShardBlob[],
  sessionDir: string,
  base?: CombineFs,
  /**
   * Fallback shadow floor for a rolled ref whose manifest could not be read — the
   * local `<session>.flushed` watermark, which only ever advances after a successful
   * push and so is never ahead of the ref's contents.
   */
  flushedWatermark?: number,
): CombineFs {
  const byName = new Map(blobs.map((b) => [b.name, b.content] as const));
  const gitRefSeqs = new Set<number>();
  for (const b of blobs) {
    const seq = seqOfShardName(b.name);
    if (seq !== null) gitRefSeqs.add(seq);
  }
  // Every seq up to and including the rolled watermark is inside the rolled blob. `null`
  // ⇒ the legacy per-seq shape, where the filename set above is already exact.
  const rolled = byName.has(ROLLED_LOGS_NAME);
  const manifestMaxSeq = rolled
    ? (parseManifest(byName.get(ROLLED_MANIFEST_NAME))?.max_seq ?? null)
    : null;
  const rolledMaxSeq = rolled ? (manifestMaxSeq ?? flushedWatermark ?? null) : null;
  // A temp file is shadowed when git-ref owns its <seq> — never surfaced from temp.
  const tempShadowed = (name: string): boolean => {
    const seq = seqOfShardName(name);
    if (seq === null) return false;
    return gitRefSeqs.has(seq) || (rolledMaxSeq !== null && seq <= rolledMaxSeq);
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
  const telDir = telemetryDir(deps.proc.cwd());
  const sessionDir = posixJoin(telDir, sessionId);
  const fs = shardCombineFs(
    blobs,
    sessionDir,
    auto ? deps.fs : undefined,
    auto
      ? readFlushed(deps.fs, posixJoin(telDir, `${sanitizeSessionId(sessionId)}.flushed`))
      : undefined,
  );
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

/** True if a parsed doc looks like a saved `TelemetryReport` (defensive input guard). */
function isTelemetryReport(doc: unknown): doc is TelemetryReport {
  if (typeof doc !== 'object' || doc === null) return false;
  const d = doc as Record<string, unknown>;
  return (
    typeof d.schema_version === 'string' &&
    d.schema_version.startsWith('harness.telemetry-report') &&
    typeof d.scope === 'object' &&
    d.scope !== null &&
    typeof d.rollups === 'object' &&
    d.rollups !== null &&
    typeof d.provenance === 'object' &&
    d.provenance !== null
  );
}

/** A stable, home-stripped label for one report input (its file stem). */
function reportInputName(path: string, cwd: string): string {
  const base = path.split('/').filter(Boolean).pop() ?? path;
  const stem = base.endsWith(REPORT_FILE_SUFFIX)
    ? base.slice(0, -REPORT_FILE_SUFFIX.length)
    : base.endsWith('.json')
      ? base.slice(0, -'.json'.length)
      : base;
  return sanitizeInputPath(stem, cwd);
}

/**
 * Load the `insights` inputs: each arg is a `*.report.json` file OR a folder swept
 * for `*.report.json`. Every unreadable / non-JSON / non-report path becomes a
 * NAMED `skipped` entry (the 2.4 error contract) — never silently dropped. The
 * loaded reports are de-duped by their sanitized name.
 */
function readReportInputs(
  fs: ReportFs,
  paths: readonly string[],
  cwd: string,
): { loaded: InsightInput[]; skipped: { path: string; reason: string }[] } {
  const loaded: InsightInput[] = [];
  const skipped: { path: string; reason: string }[] = [];
  const seenPaths = new Set<string>();
  const usedNames = new Map<string, number>();
  const consume = (p: string): void => {
    // Dedup by PATH (not name): two distinct reports can share a file stem (the
    // `report` verb defaults every stem to `report`), so a name-keyed dedup would
    // wrongly collapse them. Path-keyed dedup only drops the SAME file twice.
    if (seenPaths.has(p)) return;
    seenPaths.add(p);
    const raw = fs.readText(p);
    if (raw === null) {
      skipped.push({ path: sanitizeInputPath(p, cwd), reason: 'not found or unreadable' });
      return;
    }
    let doc: unknown;
    try {
      doc = JSON.parse(raw);
    } catch {
      skipped.push({ path: sanitizeInputPath(p, cwd), reason: 'invalid JSON' });
      return;
    }
    if (!isTelemetryReport(doc)) {
      skipped.push({ path: sanitizeInputPath(p, cwd), reason: 'not a TelemetryReport' });
      return;
    }
    const base = reportInputName(p, cwd);
    // Distinct inputs keep distinct names even when their file stems collide
    // (disambiguated `report`, `report-2`, …) so provenance/HTML never conflate them.
    const count = usedNames.get(base) ?? 0;
    usedNames.set(base, count + 1);
    const name = count === 0 ? base : `${base}-${count + 1}`;
    loaded.push({ name, report: doc });
  };
  for (const p of paths) {
    const norm = p.replace(/\\/g, '/');
    if (norm.endsWith('.json')) {
      consume(norm);
      continue;
    }
    // A folder: sweep every *.report.json under it (recursively).
    const found = sweepBySuffix(fs, norm, REPORT_FILE_SUFFIX);
    if (found.length === 0) {
      skipped.push({ path: sanitizeInputPath(norm, cwd), reason: 'no *.report.json found' });
    }
    for (const f of found) consume(f);
  }
  return { loaded, skipped };
}

/** Recursively collect every file ending in `suffix` under `paths` (never throws). */
function sweepBySuffix(fs: ReportFs, root: string, suffix: string): string[] {
  const found = new Set<string>();
  const seen = new Set<string>();
  const walk = (p: string): void => {
    const norm = p.replace(/\\/g, '/');
    if (seen.has(norm)) return;
    seen.add(norm);
    if (norm.endsWith(suffix)) {
      if (fs.readText(norm) !== null) found.add(norm);
      return;
    }
    for (const name of fs.readdir(norm)) walk(posixJoin(norm, name));
  };
  walk(root);
  return [...found].sort();
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
  // P12: `--filter-repo` is embedded in report JSON/HTML, so path-like values are
  // home-stripped. The report service applies this facet to repository-tagged
  // bundle inputs; legacy SessionExport-only inputs have no repository identity,
  // so the same value remains an honest echo-only declaration for that branch.
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
 * Its `sync` verb ROLLS the gitignored telemetry buffer into ONE ref per session
 * at its start date (`refs/harness-telemetry/<start-date>/<session>`) via plumbing
 * — a forced orphan rewrite whose tip tree is the whole session (plan 049) — and
 * on the first run migrates any old per-(capture-date, session) refs. No business
 * logic here; `sync-service` does the work, this maps the outcome onto the
 * Envelope + exit code (ok → 0; a failed roll push / ref-update → error exit 1,
 * the buffer left intact for retry).
 */
export function registerTelemetryAct(program: Command, io: CliIo, deps: TelemetryActDeps): void {
  const telemetry = program
    .command('telemetry')
    .description(
      'Telemetry — flush counts-only segments to dated refs (`sync`) and read a pij session’s evidence (`get`)',
    );

  const remotePort = (label: 'ls' | 'pull'): OutputPort =>
    io.mode === 'json'
      ? createOutputPort('json', io.writers)
      : {
          emit: (envelope) => {
            if (envelope.status === 'error') {
              io.writers.err(
                `harness telemetry ${label}: ${envelope.error?.message ?? 'failed'}\n`,
              );
              if (envelope.next_action) io.writers.err(`  → ${envelope.next_action}\n`);
              return;
            }
            const data = envelope.data as {
              rows?: unknown[];
              sessions?: number;
              refs?: number;
              out?: string;
              written?: boolean;
              reused?: boolean;
            };
            if (label === 'ls') {
              io.writers.out(
                `telemetry ls: ${data.rows?.length ?? 0} session(s)${envelope.status === 'degraded' ? ' (degraded)' : ''}\n`,
              );
            } else {
              io.writers.out(
                `telemetry pull: ${data.sessions ?? 0} session(s), ${data.refs ?? 0} ref(s) → ${data.out ?? ''} (${data.reused ? 'reused' : data.written ? 'written' : 'unchanged'})${envelope.status === 'degraded' ? ' (degraded)' : ''}\n`,
              );
            }
          },
        };

  const invalidRemote = (message: string, label: 'ls' | 'pull'): void => {
    exitWithEnvelope(
      formatError('telemetry', ErrorCodes.INVALID_ARGS, message, deps.clock, {
        next_action: `Run \`harness telemetry ${label} --help\` and pass only explicit network repositories plus one valid selector family.`,
      }),
      remotePort(label),
    );
  };

  telemetry
    .command('ls')
    .description('Inventory sessions published under explicit remote refs/harness-telemetry/**')
    .option('--repo <url>', 'Network Git repository URL (repeatable)', collectOption, [])
    .option('--repo-file <path>', 'UTF-8 file of repository URLs (repeatable)', collectOption, [])
    .option('--session <id>', 'Exact terminal telemetry session id')
    .option('--from-date <YYYY-MM-DD>', 'Inclusive published ref start date')
    .option('--to-date <YYYY-MM-DD>', 'Inclusive published ref end date')
    .option('--from-commit <full-oid>', 'Inclusive product commit start')
    .option('--to-commit <full-oid>', 'Inclusive product commit end')
    .action(async (options: RemoteCommandOptions) => {
      if (deps.hash === undefined || deps.remoteGit === undefined) {
        exitWithEnvelope(
          formatError(
            'telemetry',
            ErrorCodes.UNKNOWN,
            'remote telemetry dependencies are unavailable in this context',
            deps.clock,
            { next_action: 'Invoke through the Harness CLI composition root.' },
          ),
          remotePort('ls'),
        );
        return;
      }
      const repositories = parseRemoteRepositories(
        {
          repos: options.repo ?? [],
          repoFiles: (options.repoFile ?? []).map((path) => ({
            path,
            bytes: deps.fs.readBytesNoFollow(path),
          })),
        },
        deps.hash,
      );
      if (!repositories.ok) {
        invalidRemote(repositories.message, 'ls');
        return;
      }
      const selector = parseRemoteSelector('ls', options);
      if (!selector.ok) {
        invalidRemote(selector.message, 'ls');
        return;
      }
      const result = await listPublishedTelemetry(
        { repositories: repositories.repositories, selector: selector.selector },
        { git: deps.remoteGit, fs: deps.fs, hash: deps.hash },
      );
      if (!result.ok) {
        const mapped = remoteError(result);
        exitWithEnvelope(
          formatError('telemetry', mapped.code, mapped.message, deps.clock, {
            next_action: mapped.next,
          }),
          remotePort('ls'),
        );
        return;
      }
      const data = {
        rows: result.rows,
        completeness: result.completeness,
        gaps: result.gaps,
        errors: result.errors,
        effects: result.effects,
      };
      const envelope =
        result.status === 'degraded'
          ? formatDegraded(
              'telemetry',
              data,
              'Review the named gaps/repository errors before treating the inventory as complete.',
              deps.clock,
              { evidence: [{ label: 'remote inventory', none: true }] },
            )
          : formatOk('telemetry', data, deps.clock, {
              evidence: [{ label: 'remote inventory', none: true }],
              next_action:
                'Choose an exact session or inclusive date/product-commit range to pull.',
            });
      exitWithEnvelope(envelope, remotePort('ls'));
    });

  telemetry
    .command('pull')
    .description(
      'Pull complete selected published sessions into one deterministic exact-folder bundle',
    )
    .option('--repo <url>', 'Network Git repository URL (repeatable)', collectOption, [])
    .option('--repo-file <path>', 'UTF-8 file of repository URLs (repeatable)', collectOption, [])
    .option('--session <id>', 'Exact terminal telemetry session id')
    .option('--from-date <YYYY-MM-DD>', 'Inclusive published ref start date')
    .option('--to-date <YYYY-MM-DD>', 'Inclusive published ref end date')
    .option('--from-commit <full-oid>', 'Inclusive product commit start')
    .option('--to-commit <full-oid>', 'Inclusive product commit end')
    .requiredOption('--out <exact-folder>', 'Exact absent-or-identical output folder')
    .action(async (options: RemoteCommandOptions) => {
      if (deps.hash === undefined || deps.remoteGit === undefined) {
        exitWithEnvelope(
          formatError(
            'telemetry',
            ErrorCodes.UNKNOWN,
            'remote telemetry dependencies are unavailable in this context',
            deps.clock,
            { next_action: 'Invoke through the Harness CLI composition root.' },
          ),
          remotePort('pull'),
        );
        return;
      }
      const repositories = parseRemoteRepositories(
        {
          repos: options.repo ?? [],
          repoFiles: (options.repoFile ?? []).map((path) => ({
            path,
            bytes: deps.fs.readBytesNoFollow(path),
          })),
        },
        deps.hash,
      );
      if (!repositories.ok) {
        invalidRemote(repositories.message, 'pull');
        return;
      }
      const selector = parseRemoteSelector('pull', options);
      if (!selector.ok || selector.selector === null || options.out === undefined) {
        invalidRemote(
          selector.ok ? 'pull requires --out and exactly one selector' : selector.message,
          'pull',
        );
        return;
      }
      const result = await pullPublishedTelemetry(
        {
          repositories: repositories.repositories,
          selector: selector.selector,
          out: options.out,
        },
        { git: deps.remoteGit, fs: deps.fs, hash: deps.hash },
      );
      if (!result.ok) {
        const mapped = remoteError(result);
        exitWithEnvelope(
          formatError('telemetry', mapped.code, mapped.message, deps.clock, {
            next_action: mapped.next,
          }),
          remotePort('pull'),
        );
        return;
      }
      const data = { ...result.data, effects: result.effects };
      const evidence = [{ label: 'telemetry pull bundle', path: `${result.data.out}/bundle.json` }];
      const envelope =
        result.status === 'degraded'
          ? formatDegraded(
              'telemetry',
              data,
              'The valid bundle preserves all selected bytes; review selection/data gaps before analysis.',
              deps.clock,
              { evidence },
            )
          : formatOk('telemetry', data, deps.clock, {
              evidence,
              next_action:
                'Run `harness telemetry report <bundle-folder>` to analyze the verified bundle.',
            });
      exitWithEnvelope(envelope, remotePort('pull'));
    });

  telemetry
    .command('sync')
    .description(
      'Roll buffered telemetry into one ref per session at its start date (refs/harness-telemetry/<start-date>/<session>), forced-push it, and (first run) migrate any old per-date refs',
    )
    .action(() => {
      const result = syncTelemetry({
        fs: deps.fs,
        env: deps.env,
        proc: deps.proc,
        git: deps.gitWrite,
        clock: deps.clock,
        ...(deps.gitRead !== undefined && { gitRead: deps.gitRead }),
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
          // `pushed` = a FRESH commit was published this run; an idempotent
          // re-push (bytes already on the ref — lost-watermark re-run / divergent
          // remote) still force-delivers but is excluded, so re-runs don't inflate it.
          pushed: result.pushed,
          plans: result.plans,
          ...(result.migration !== undefined && { migration: result.migration }),
        },
        deps.clock,
        {
          next_action:
            result.segments === 0
              ? 'Nothing buffered to flush.'
              : 'Segments flushed to refs/harness-telemetry/<start-date>/<session>; the scraper fetches refs/harness-telemetry/* in one pass.',
        },
      );
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                const migLine =
                  result.migration !== undefined && result.migration.rewritten > 0
                    ? `telemetry sync: migrated ${result.migration.rewritten} session(s), ${result.migration.deleted} old ref(s) removed\n`
                    : '';
                io.writers.out(
                  migLine +
                    (result.segments === 0
                      ? 'telemetry sync: nothing to flush\n'
                      : `telemetry sync: flushed ${result.segments} segment(s) across ${result.sessions} session(s)${result.pushed ? ' and pushed' : ''}\n`),
                );
              },
            };
      exitWithEnvelope(envelope, port);
    });

  telemetry
    .command('mark')
    .description(
      "Emit a peer's counts-only self-attestation (a `mark`) onto its own session telemetry lane — the reviewer-verdict channel that puts a read-only peer's outcome on its lane. Shape-guarded slugs + integer finding counts only; no free text.",
    )
    .requiredOption(
      '--kind <slug>',
      'The mark category slug (^[a-z][a-z0-9-]{0,31}$), e.g. `review`',
    )
    .option('--verdict <slug>', 'Optional verdict slug (same shape), e.g. `fix-required`')
    .option('--findings-critical <n>', 'Critical finding count (non-negative integer)')
    .option('--findings-high <n>', 'High finding count (non-negative integer)')
    .option('--findings-med <n>', 'Medium finding count (non-negative integer)')
    .option('--findings-low <n>', 'Low finding count (non-negative integer)')
    .option('--findings <n>', 'Total finding count (non-negative integer)')
    .action(
      (options: {
        kind: string;
        verdict?: string;
        findingsCritical?: string;
        findingsHigh?: string;
        findingsMed?: string;
        findingsLow?: string;
        findings?: string;
      }) => {
        // Parse count flags → numbers; a non-integer string becomes NaN and is
        // rejected by the guard (buildMarkEvent) with a shaped next_action.
        const counts: Partial<Record<MarkCountKey, number>> = {};
        const put = (key: MarkCountKey, raw: string | undefined): void => {
          if (raw !== undefined) counts[key] = Number(raw);
        };
        put('findings_critical', options.findingsCritical);
        put('findings_high', options.findingsHigh);
        put('findings_med', options.findingsMed);
        put('findings_low', options.findingsLow);
        put('findings', options.findings);

        const result = runMark(
          { fs: deps.fs, env: deps.env, proc: deps.proc, clock: deps.clock },
          {
            kind: options.kind,
            ...(options.verdict !== undefined && { verdict: options.verdict }),
            counts,
          },
        );

        if (!result.ok) {
          const envelope = formatUnconfigured('telemetry', result.next_action, deps.clock);
          const port: OutputPort =
            io.mode === 'json'
              ? createOutputPort('json', io.writers)
              : {
                  emit: (e) => {
                    io.writers.err(`harness telemetry mark: ${e.next_action ?? 'unconfigured'}\n`);
                  },
                };
          exitWithEnvelope(envelope, port);
          return;
        }

        const envelope = formatOk(
          'telemetry',
          {
            kind: result.event.mark_kind,
            ...(result.event.verdict !== undefined && { verdict: result.event.verdict }),
            counts: result.event.counts,
            session: result.sessionId,
            harness: result.harness,
          },
          deps.clock,
          {
            evidence: [{ label: 'marker segment', path: result.path }],
            next_action:
              'The mark is on this session lane; it surfaces via `harness telemetry get-fleet` (cost-excluded, attribution-visible).',
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: () => {
                  io.writers.out(
                    `telemetry mark: recorded ${result.event.mark_kind}${result.event.verdict ? ` (${result.event.verdict})` : ''} → ${result.path}\n`,
                  );
                },
              };
        exitWithEnvelope(envelope, port);
      },
    );

  telemetry
    .command('get')
    .description(
      "Read a pij session's telemetry into a normalized, counts-only evidence object (the conformance scorer's telemetry lane). Reads the live buffer first and falls back to the committed refs/harness-telemetry/* rollup when a commit has already flushed it; the envelope names its evidence source (`source`: buffer | ref | buffer+ref) and whether a local ref namespace existed to check (`ref_checked`). Local refs only — never a fetch.",
    )
    .argument('<pij-session-id>', 'The pij session id whose telemetry to resolve')
    .option(
      '--worktree <path>',
      'Worktree root whose buffer to read (overrides pij-folder resolution)',
    )
    .action(async (pijSessionId: string, options: { worktree?: string }) => {
      const evidence = await getSessionEvidence(
        pijSessionId,
        {
          fs: deps.fs,
          env: deps.env,
          proc: deps.proc,
          ...(deps.gitRead ? { gitRead: deps.gitRead } : {}),
        },
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
              'BOTH surfaces were empty — the live buffer and the committed refs/harness-telemetry/* rollup. Check the id (`pij list`); telemetry is captured per command — run a harness command in that session, then retry. Use --worktree <path> if it ran from a git worktree.',
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

      const envelope =
        evidence.token_evidence.coverage === 'measured'
          ? formatOk('telemetry', evidence, deps.clock, {
              next_action:
                'Counts-only evidence derived from the session event stream; the conformance scorer consumes it as its telemetry lane.',
            })
          : formatDegraded(
              'telemetry',
              evidence,
              `Token coverage is ${evidence.token_evidence.coverage} (${evidence.token_evidence.reason ?? 'source_unavailable'}; cause: ${evidence.token_evidence.cause}). Sync or complete the missing token fields, then retry.`,
              deps.clock,
            );
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                const gaps = evidence.gaps.length ? `, gaps: ${evidence.gaps.join(',')}` : '';
                io.writers.out(
                  `telemetry get: ${evidence.segments} segment(s), ${evidence.skill_order.length} skill(s), ${Object.keys(evidence.tools).length} tool(s)${gaps} [source: ${evidence.source}${evidence.ref_checked ? '' : ', ref namespace absent'}]\n`,
                );
              },
            };
      exitWithEnvelope(envelope, port);
    });

  telemetry
    .command('get-fleet')
    .description(
      'Join a flow-pair fleet (orchestrator + pij children) into one FleetEvidence with honest cost/time totals (plan 051)',
    )
    .argument('<root-pij-id>', 'The orchestrator (root) pij id whose child sessions form the fleet')
    .option(
      '--roster <path>',
      'A flow-pair run.json whose `roster` scopes membership + fills orphan/unrostered diffs (D1); env-tree scope without it',
    )
    .option(
      '--worktree <path>',
      'Worktree root whose buffer to read (overrides pij-folder resolution)',
    )
    .action(async (rootPijId: string, options: { roster?: string; worktree?: string }) => {
      const fleet = await getFleetEvidence(
        rootPijId,
        { fs: deps.fs, env: deps.env, proc: deps.proc },
        {
          ...(options.worktree ? { worktree: options.worktree } : {}),
          ...(options.roster ? { rosterPath: options.roster } : {}),
          ...(deps.gitRead ? { gitRead: deps.gitRead } : {}),
        },
      );

      // No child joins to this root → honest error envelope (exit 1); buffer untouched.
      if (fleet === null) {
        const envelope = formatError(
          'telemetry',
          ErrorCodes.UNKNOWN,
          `no fleet telemetry found for root pij id '${rootPijId}'`,
          deps.clock,
          {
            next_action:
              'Check the root id (`pij list`); a fleet needs ≥1 child whose captured_env.PIJ_PARENT_ID equals this root. Use --worktree <path> if the children ran from a git worktree.',
          },
        );
        const port: OutputPort =
          io.mode === 'json'
            ? createOutputPort('json', io.writers)
            : {
                emit: (e) => {
                  io.writers.err(
                    `harness telemetry get-fleet: ${e.error?.message ?? 'not found'}\n`,
                  );
                  if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
                },
              };
        exitWithEnvelope(envelope, port);
        return;
      }

      const fleetIncomplete =
        fleet.orphans.length > 0 ||
        fleet.sessions.some((lane) => lane.token_evidence.coverage !== 'measured');
      const envelope = fleetIncomplete
        ? formatDegraded(
            'telemetry',
            fleet,
            'One or more fleet lanes have partial/unavailable token evidence or an unresolved identity. Inspect sessions[].token_evidence and orphans, then sync or recover the named lane.',
            deps.clock,
          )
        : formatOk('telemetry', fleet, deps.clock, {
            next_action:
              'Fleet evidence merged per field across live, ref, and ledger sources; scalar source/totals are compatibility projections.',
          });
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                const c = fleet.totals.cost;
                const wall = fleet.totals.time.wall_clock_s;
                const bySource = fleet.sessions.reduce<Record<string, number>>((acc, l) => {
                  acc[l.source] = (acc[l.source] ?? 0) + 1;
                  return acc;
                }, {});
                const srcSummary = Object.entries(bySource)
                  .map(([s, n]) => `${n} ${s}`)
                  .join(', ');
                const nanoAiu = fleet.sessions.reduce(
                  (sum, l) => sum + (l.billing?.nano_aiu ?? 0),
                  0,
                );
                const aic = nanoAiu > 0 ? `, ${(nanoAiu / 1e9).toFixed(1)} AIC` : '';
                const sem = fleet.semantics;
                io.writers.out(
                  `telemetry get-fleet: ${fleet.sessions.length} lane(s) [${c.measured_lanes} measured, ${c.unmeasured_lanes} unmeasured] (${srcSummary}), ${c.grand_total.toLocaleString()} tokens${aic}, wall ${wall === null ? 'unknown' : `${wall}s`}, semantics ${sem.measured_lanes}/${sem.measured_lanes + sem.blind_lanes} lanes measured, scope ${fleet.scope}\n`,
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
      'Where to read from: auto (git-ref shadows temp, default) | temp (local buffer) | git-ref (committed shards)',
      'auto',
    )
    .option(
      '--out <path>',
      'Output path for the .session.json (default: <session-id>.session.json)',
    )
    .option('--no-html', 'Suppress the co-produced self-contained HTML view (default: on)')
    .action((sessionId: string, options: { source: string; out?: string; html: boolean }, cmd) => {
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
      // `auto` is the DEFAULT (finding 02): a mid-session sync prunes the buffer, so a
      // pure-temp read returns only the delta since the last commit. When the read port
      // is absent, a DEFAULTED auto degrades to temp — combineSession then marks the
      // read partial (`flushed_segments_unreadable`) if the session was flushed, so the
      // subset can never pass as whole. An EXPLICIT --source auto still errors.
      const explicitSource = cmd.getOptionValueSource('source') !== 'default';
      if (
        source === 'temp' ||
        (source === 'auto' && deps.gitRead === undefined && !explicitSource)
      ) {
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

      const envelopeData = {
        session_id: sessionId,
        segment_count: exp.source.segment_count,
        schema_versions: exp.summary.segment_schema_versions,
        degraded: exp.summary.degraded,
        token_evidence: exp.summary.token_evidence,
        out: outPath,
        html: htmlOut ?? null,
        totals,
      };
      // Anything the producer contract could not carry (plan 068 item 1) — the read
      // never dies for it, but it never passes as complete either.
      const skippedSignals = exp.summary.degraded.filter(
        (entry) => entry.startsWith('metric_skipped:') || entry.startsWith('event_skipped:'),
      );
      const envelope =
        exp.summary.token_evidence.coverage === 'measured' && skippedSignals.length === 0
          ? formatOk('telemetry', envelopeData, deps.clock, {
              evidence,
              next_action:
                'A schema-valid SessionExport (combined OTel) + its self-contained HTML view. Roll many up with `harness telemetry report`.',
            })
          : formatDegraded(
              'telemetry',
              envelopeData,
              skippedSignals.length > 0 && exp.summary.token_evidence.coverage === 'measured'
                ? `Skipped ${skippedSignals.length} signal(s) the producer contract could not carry (${skippedSignals.join(', ')}); every other signal is complete.`
                : `Token coverage is ${exp.summary.token_evidence.coverage} (${exp.summary.token_evidence.reason ?? 'source_unavailable'}). Run or sync a session with complete typed usage; inspect token_evidence.fields for unavailable buckets.`,
              deps.clock,
              { evidence },
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
      'Applied only to bundle origins; mixed inputs retain every legacy SessionExport (echo-only)',
    )
    .option('--from <iso>', 'Only sessions whose activity reaches on/after this instant')
    .option('--to <iso>', 'Only sessions whose activity starts on/before this instant')
    .option('--sort <key>', 'Rollup row ordering: tokens | time | count', 'tokens')
    .option('--top <n>', 'Cap rows per rollup (records rollup.truncated; never silent)')
    .option('--no-html', 'Data-only: skip the co-produced HTML render')
    .action((paths: string[], options: ReportOptions) => {
      const files = sweepSessionFiles(deps.fs, paths);
      const { exports, skipped } = readExports(deps.fs, files);
      const bundleInputs: TelemetryReportInput[] = [];
      const bundleSelectionGaps: Array<{
        repositoryKey: string;
        repository: string;
        sessionId: string;
        reason: string;
      }> = [];
      let bundleFound = false;
      for (const path of paths) {
        const candidate = path.replace(/\\/g, '/').endsWith('bundle.json')
          ? path
          : posixJoin(path, 'bundle.json');
        if (deps.fs.readBytesNoFollow(candidate) === null) continue;
        bundleFound = true;
        if (deps.hash === undefined) {
          exitWithEnvelope(
            formatError(
              'telemetry',
              ErrorCodes.UNKNOWN,
              'bundle verification hash dependency is unavailable',
              deps.clock,
              { next_action: 'Invoke through the Harness CLI composition root.' },
            ),
            io.mode === 'json'
              ? createOutputPort('json', io.writers)
              : { emit: (e) => io.writers.err(`harness telemetry report: ${e.error?.message}\n`) },
          );
          return;
        }
        const bundle = readTelemetryBundle(path, { fs: deps.fs, hash: deps.hash });
        if (!bundle.ok) {
          exitWithEnvelope(
            formatError(
              'telemetry',
              ErrorCodes.REMOTE_TELEMETRY_INVALID,
              'telemetry pull bundle schema, path set, or integrity verification failed',
              deps.clock,
              {
                next_action:
                  'Re-run `harness telemetry pull` into an absent folder; do not edit bundle bytes.',
              },
            ),
            io.mode === 'json'
              ? createOutputPort('json', io.writers)
              : { emit: (e) => io.writers.err(`harness telemetry report: ${e.error?.message}\n`) },
          );
          return;
        }
        bundleInputs.push(...bundle.inputs);
        const repositoryByKey = new Map(
          bundle.repositories.map((repository) => [repository.key, repository.identity]),
        );
        bundleSelectionGaps.push(
          ...bundle.selection.gaps.map((gap) => ({
            repositoryKey: gap.repository_key,
            repository: repositoryByKey.get(gap.repository_key) as string,
            sessionId: gap.session_id ?? 'unknown',
            reason: gap.reason,
          })),
        );
      }

      if (exports.length === 0 && !bundleFound) {
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
      const reportOptions = {
        filter,
        sort: sortKey(options.sort),
        ...(top !== undefined && Number.isFinite(top) ? { top } : {}),
        sourcePaths: paths.map((p) => sanitizeInputPath(p, deps.proc.cwd())),
        generatedAt: deps.clock.nowIso(),
      };
      const report = bundleFound
        ? buildReportFromInputs(
            [
              ...exports.map<TelemetryReportInput>((exp, index) => ({
                origin: 'legacy',
                kind: 'full',
                repositoryKey: `legacy-${index}`,
                repository: 'local-session-export',
                sessionId: exp.identity.harness_session_id,
                sessionExport: exp,
                coverage: {
                  events: { state: 'full', count: otlpLogsToEvents(exp.signals.logs).length },
                  measurements: { state: 'unavailable', count: null },
                  gaps: ['measurements_unavailable'],
                },
                gaps: ['measurements_unavailable'],
              })),
              ...bundleInputs,
            ],
            { ...reportOptions, selectionGaps: bundleSelectionGaps },
          )
        : buildReport(exports, reportOptions);
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

      const reportIncomplete =
        report.provenance.token_coverage.partial > 0 ||
        report.provenance.token_coverage.unavailable > 0;
      const reportData = {
        sessions: report.scope.session_count,
        single: report.scope.single,
        skipped,
        filter: report.filter,
        totals: report.totals,
        token_coverage: report.provenance.token_coverage,
        out: jsonPath,
        html: htmlPath ?? null,
        columns,
      };
      const envelope = reportIncomplete
        ? formatDegraded(
            'telemetry',
            reportData,
            'Report token coverage is partial/unavailable. Inspect provenance.token_coverage reasons and regenerate missing session evidence.',
            deps.clock,
            { evidence },
          )
        : formatOk('telemetry', reportData, deps.clock, {
            evidence,
            next_action: htmlPath
              ? 'Open the index.html under file:// (self-contained). Add more pre-filtered reports to the folder + `report-render` to compare.'
              : 'A schema-valid TelemetryReport. Render it with `harness telemetry report-render <folder>`.',
          });
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
    .command('insights')
    .description(
      'Compute the WS001 v1 insight sections + discipline panel over 1..N saved *.report.json (+ a self-contained HTML). Consumes reports ONLY — no shards, no external joins, no LLM.',
    )
    .argument(
      '<paths...>',
      'One or more *.report.json files (or folders swept for them). Single-session reports unlock the per-session sections.',
    )
    .option('--out <dir>', 'Output folder (insights.json + index.html)', './telemetry-insights')
    .option('--no-html', 'Data-only: skip the co-produced HTML render')
    .action((paths: string[], options: { out: string; html: boolean }) => {
      const cwd = deps.proc.cwd();
      const { loaded, skipped } = readReportInputs(deps.fs, paths, cwd);

      const textErr = (label: string): OutputPort =>
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: (e) => {
                io.writers.err(`harness telemetry insights: ${e.error?.message ?? label}\n`);
                if (e.next_action) io.writers.err(`  → ${e.next_action}\n`);
              },
            };

      // No usable input → honest hard error (nothing computed / written).
      if (loaded.length === 0) {
        const named = skipped.map((s) => `${s.path} (${s.reason})`).join('; ');
        const envelope = formatError(
          'telemetry',
          ErrorCodes.UNKNOWN,
          `no valid TelemetryReport found${named.length > 0 ? `: ${named}` : ` under ${paths.join(', ')}`}`,
          deps.clock,
          {
            details: { skipped },
            next_action:
              'Produce reports first: `harness telemetry report <session.json…> --out <dir>` (or `telemetry sweep --month`), then feed the *.report.json here.',
          },
        );
        exitWithEnvelope(envelope, textErr('no valid reports'));
        return;
      }

      const doc = buildInsights(loaded, { skipped, generatedAt: deps.clock.nowIso() });

      const outDir = options.out;
      deps.fs.mkdirp(outDir);
      const jsonPath = posixJoin(outDir, 'insights.json');
      deps.fs.writeText(jsonPath, `${JSON.stringify(doc, null, 2)}\n`);
      const evidence: { label: string; path: string }[] = [{ label: 'insights', path: jsonPath }];
      let htmlPath: string | undefined;
      if (options.html !== false) {
        htmlPath = posixJoin(outDir, 'index.html');
        deps.fs.writeText(htmlPath, renderInsights(doc));
        evidence.push({ label: 'insights view', path: htmlPath });
      }

      const pipeline =
        'Phase-3 loop: sweep → `report` EACH cached export → `insights` over the N *.report.json' +
        (htmlPath ? '. Open index.html under file:// (self-contained).' : '.');

      // 2.4 error contract: a bad input among good ones is NAMED (envelope errors),
      // while the partial run still wrote the artifacts + recorded the omission in
      // insights.json provenance.skipped_inputs (never a silent drop).
      if (skipped.length > 0) {
        const named = skipped.map((s) => `${s.path} (${s.reason})`).join('; ');
        const envelope = formatError(
          'telemetry',
          ErrorCodes.INVALID_ARGS,
          `skipped ${skipped.length} unreadable input(s): ${named}`,
          deps.clock,
          {
            details: {
              out: jsonPath,
              html: htmlPath ?? null,
              skipped,
              sections: doc.sections.length,
            },
            next_action: `Partial insights written to ${jsonPath} (omissions recorded in provenance.skipped_inputs). Fix the named input(s) and re-run. ${pipeline}`,
          },
        );
        exitWithEnvelope(envelope, textErr('partial run'));
        return;
      }

      const envelope = formatOk(
        'telemetry',
        {
          out: jsonPath,
          html: htmlPath ?? null,
          sections: doc.sections.length,
          single_session_reports: doc.provenance.single_session_reports,
          aggregate_reports: doc.provenance.aggregate_reports,
        },
        deps.clock,
        { evidence, next_action: pipeline },
      );
      const port: OutputPort =
        io.mode === 'json'
          ? createOutputPort('json', io.writers)
          : {
              emit: () => {
                const view = htmlPath ? ` (+ ${htmlPath})` : '';
                io.writers.out(
                  `telemetry insights: ${loaded.length} report(s) → ${jsonPath}${view}\n`,
                );
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

      const sweepData = {
        month: options.month,
        sessions: report.scope.session_count,
        exported,
        reused,
        empty,
        token_coverage: report.provenance.token_coverage,
        out: jsonPath,
        html: htmlPath ?? null,
      };
      const sweepIncomplete =
        report.provenance.token_coverage.partial > 0 ||
        report.provenance.token_coverage.unavailable > 0;
      const envelope = sweepIncomplete
        ? formatDegraded(
            'telemetry',
            sweepData,
            'Monthly token coverage is partial/unavailable. Inspect token_coverage reasons and recover or resync the affected sessions.',
            deps.clock,
            { evidence },
          )
        : formatOk('telemetry', sweepData, deps.clock, {
            evidence,
            next_action: htmlPath
              ? 'Open the index.html under file:// (self-contained). Re-run to refresh; unchanged sessions are cache-skipped.'
              : 'A schema-valid month TelemetryReport. Render it with `harness telemetry report-render <folder>`.',
          });
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
