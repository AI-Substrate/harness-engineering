/**
 * Pure orchestration logic for the `capture-fixtures` extension (plan 037).
 *
 * Extension-specific path/config computation only — NO I/O, NO `node:*`, NO core
 * imports (so it unit-tests in isolation, arch-check style). The privacy-critical
 * SCRUB is NOT here: it lives once in the core telemetry service
 * (`services/telemetry/fixture-scrub`) and is imported by `extension.ts`, so the
 * security control has a single source of truth guarded by one test.
 */

export const SURFACES = ['claude', 'copilot-cli', 'copilot-vscode', 'cursor'] as const;
export type Surface = (typeof SURFACES)[number];

export function isSurface(s: string | undefined): s is Surface {
  return s != null && (SURFACES as readonly string[]).includes(s);
}

/** The committed `raw.*` filename for each surface (mirrors fixtures/real/README.md). */
export function rawFilename(surface: Surface): string {
  switch (surface) {
    case 'claude':
    case 'cursor':
      return 'raw.jsonl';
    case 'copilot-cli':
      return 'raw.events.jsonl';
    case 'copilot-vscode':
      return 'raw.rows.json';
  }
}

/** The claude `projects/` dir mangle: every non-alphanumeric char → `-` (matches claudeTranscriptPath). */
export function claudeMangle(absPath: string): string {
  return absPath.replace(/\\/g, '/').replace(/[^A-Za-z0-9]/g, '-');
}

/** Where claude stores this repo's session transcripts. */
export function claudeProjectDir(homeDir: string, repoRoot: string): string {
  return `${homeDir}/.claude/projects/${claudeMangle(repoRoot)}`;
}

/** Gitignored staging root — capture lands here BEFORE scrub + manual review (P12). */
export function scratchRoot(repoRoot: string): string {
  return `${repoRoot}/scratch/telemetry-fixtures`;
}

/** The committed corpus dir for one captured instance. */
export function instanceDir(repoRoot: string, surface: Surface, instance: string): string {
  return `${repoRoot}/harness/cli/test/services/telemetry/fixtures/real/${surface}/${instance}`;
}

/** Default corpus instance id from an ISO timestamp: `YYYY-MM-DD-real`. */
export function defaultInstanceId(nowIso: string): string {
  return `${nowIso.slice(0, 10)}-real`;
}

/** The categories the scrub neutralizes — a NON-SENSITIVE attestation (no tokens), so a
 * committed fixture records which private-data classes were removed (companion F004). */
export const SCRUB_CATEGORIES = [
  'machine-paths',
  'home-username',
  'git-handles',
  'person-names',
  'emails',
  'secrets',
] as const;

export interface CaptureMeta {
  surface: Surface;
  captured_utc: string;
  harness: string;
  scrubbed: boolean;
  scrub_categories: readonly string[];
  note: string;
}

/** Capture provenance written beside the scrubbed raw fixture (no session id — not identifying, but kept out anyway). */
export function buildMeta(surface: Surface, nowIso: string, harness: string, note: string): CaptureMeta {
  return {
    surface,
    captured_utc: nowIso.slice(0, 10),
    harness,
    scrubbed: true,
    scrub_categories: [...SCRUB_CATEGORIES],
    note,
  };
}

/** Pick the `.jsonl` session files in a claude project dir (filenames only, no path). */
export function sessionFiles(entries: string[]): string[] {
  return entries.filter((e) => e.endsWith('.jsonl')).sort();
}

/** One source file to capture: where to read it from, and the `raw.*` name to stage it as. */
export interface SourceFile {
  rawName: string;
  sourcePath: string;
}

/** The single claude transcript source. */
export function claudeSources(projectDir: string, sessionFile: string): SourceFile[] {
  return [{ rawName: 'raw.jsonl', sourcePath: `${projectDir}/${sessionFile}` }];
}

/**
 * The per-session copilot-cli events file (verbatim — this dir is one session only).
 * Mirrors `copilotEventsPath` in the runtime adapter; kept here as a pure join so
 * capture-logic stays core-free.
 */
export function copilotCliEventsPath(home: string, sessionId: string): string {
  return `${home}/.copilot/session-state/${sessionId}/events.jsonl`;
}

/**
 * The copilot-cli logs dir. The process log is NOT named by session id — it is a
 * per-process `process-*.log` that interleaves many sessions, found by scanning for
 * the one whose content includes the session id (I/O, done at the run() root). The
 * captured fixture keeps only that session's `assistant_usage` records
 * (`filterCopilotProcessLog`), never the raw multi-hundred-MB debug log.
 */
export function copilotCliLogsDir(home: string): string {
  return `${home}/.copilot/logs`;
}

/** True for a copilot-cli `process-*.log` debug-log filename. */
export function isCopilotProcessLog(name: string): boolean {
  return name.startsWith('process-') && name.endsWith('.log');
}

/**
 * copilot-cli has thousands of sessions and `ctx.fs` exposes no mtime, so capture
 * cannot auto-pick "most recent". Selection is explicit `--session`, else the live
 * `COPILOT_AGENT_SESSION_ID`; `null` (→ ask for `--session`) when neither is set.
 */
export function pickCopilotCliSession(
  explicit: string | undefined,
  current: string | undefined,
): string | null {
  return explicit ?? current ?? null;
}

/**
 * Cursor's `projects/` dir mangle: strip leading slash(es), `/` → `-` (the observed
 * scheme — `/Users/x/repo` → `Users-x-repo`). Unlike claude's mangle this keeps
 * dots/other chars, matching the on-disk `~/.cursor/projects/<mangled>/` layout.
 */
export function cursorMangle(absPath: string): string {
  return absPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\//g, '-');
}

/**
 * Where cursor stores this repo's agent transcripts on disk. Capture reads this
 * directly (Finding 04): `AGENT_TRANSCRIPTS` only gates the runtime auto-detect, so
 * a capture from outside a live cursor shell derives the dir from home + cwd.
 */
export function cursorTranscriptsDir(homeDir: string, repoRoot: string): string {
  return `${homeDir}/.cursor/projects/${cursorMangle(repoRoot)}/agent-transcripts`;
}

/** The conversation's transcript file: `<transcriptsDir>/<conv>/<conv>.jsonl`. */
export function cursorTranscriptFile(transcriptsDir: string, convId: string): string {
  return `${transcriptsDir}/${convId}/${convId}.jsonl`;
}

export interface CaptureConfig {
  homeDir: string;
  repoRoot: string;
  username: string;
  names: string[];
}

/**
 * Derive the scrub config from raw env/cwd values (the caller reads these from
 * ctx.env/ctx.cwd — this stays pure). username defaults to the home basename;
 * extra person-names are passed through (configurable, default none).
 */
export function deriveCaptureConfig(input: {
  home: string | undefined;
  cwd: string;
  user?: string | undefined;
  names?: string[];
}): CaptureConfig | null {
  const homeDir = (input.home ?? '').replace(/\/+$/, '');
  if (!homeDir) return null;
  const repoRoot = input.cwd.replace(/\/+$/, '');
  const username = input.user ?? homeDir.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  return { homeDir, repoRoot, username, names: input.names ?? [] };
}
