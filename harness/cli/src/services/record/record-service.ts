import { join } from 'node:path';
import type { Clock } from '../../adapters/clock/clock-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import type { RecordRegistry } from './registry.js';

/**
 * Pure record-scaffolding logic behind injected ports (`fs`/`clock`/`proc`). Like
 * `services/scaffold`, it never imports `node:fs` or `process.cwd()` (Constitution
 * P2), so it is unit-testable with fakes. The CLI owns placement uniformly:
 * `.harness/records/<type>/<YYYY-MM-DD>/<NNN>-<slug>.md` — the UTC date (via the
 * Clock) is a directory and `<NNN>` is a per-day, per-type ordinal (001, 002, …),
 * so records sort chronologically within the day and never clobber an existing file.
 */

const HARNESS_DIR = '.harness';
const RECORDS_DIR = 'records';
const TEMP_DIR = 'temp';
const TYPE_PATTERN = /^[a-z][a-z0-9-]*$/;
/** Max per-day ordinal (keeps `<NNN>` 3 digits); refuse beyond rather than clobber. */
const MAX_ORDINAL = 999;

const TEMP_GITIGNORE = '# Crash-resilient agent scratch — never committed.\n*\n';

export interface RecordDeps {
  fs: FsPort;
  clock: Clock;
  proc: ProcessPort;
}

export interface RecordCreateOptions {
  /** The record type (the `<type>` arg). */
  type?: string;
  /** Optional slug for the filename; slugified to `[a-z0-9-]`. Absent → ordinal-only name (`<NNN>.md`). */
  slug?: string;
}

export type RecordOutcome =
  | { ok: true; type: string; path: string; source: 'core' | 'extension' }
  | {
      ok: false;
      status: 'error' | 'unconfigured';
      code?: string;
      message: string;
      next_action: string;
    };

/** Lowercase + strip to `[a-z0-9-]`, collapsing/​trimming separators. */
export function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** `YYYY-MM-DD` from the injected Clock's UTC ISO instant (deterministic in tests). */
function dateStamp(clock: Clock): string {
  return clock.nowIso().slice(0, 10);
}

/**
 * Next 1-based ordinal for a date dir: 1 + the highest `NNN` prefix already
 * present (files are named `<NNN>[-slug].md`). Missing/empty dir → 1.
 */
function nextOrdinal(fs: FsPort, dateDir: string): number {
  let max = 0;
  for (const name of fs.readdir(dateDir)) {
    const m = /^(\d+)(?:-|\.)/.exec(name);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

/**
 * Ensure `.harness/temp/` exists and is self-gitignored on first use (AC-17):
 * the crash-resilient scratch buffer is never committed even in a consumer repo
 * that hasn't added the root `.gitignore` rule. Idempotent — only writes what's
 * missing. Returns the absolute temp dir.
 */
export function ensureTemp(deps: RecordDeps): string {
  const tempDir = join(deps.proc.cwd(), HARNESS_DIR, TEMP_DIR);
  if (!deps.fs.exists(tempDir)) {
    deps.fs.mkdirp(tempDir);
  }
  const gitignore = join(tempDir, '.gitignore');
  if (!deps.fs.exists(gitignore)) {
    deps.fs.writeText(gitignore, TEMP_GITIGNORE);
  }
  return tempDir;
}

/**
 * Scaffold a record file for `harness record <type>`. Resolves the type in the
 * merged registry, computes a never-clobbering path, ensures the scratch buffer,
 * and writes the type's template. Returns a typed outcome the act maps onto the
 * Envelope + exit code (ok → 0, unconfigured → 2, error → 1).
 */
export function createRecord(
  opts: RecordCreateOptions,
  registry: RecordRegistry,
  deps: RecordDeps,
): RecordOutcome {
  const { fs, clock, proc } = deps;
  const cwd = proc.cwd();
  const harnessDir = join(cwd, HARNESS_DIR);

  // 1. Honest `unconfigured` when there's no harness to record into.
  if (!fs.exists(harnessDir)) {
    return {
      ok: false,
      status: 'unconfigured',
      message: `No ${HARNESS_DIR}/ directory found in ${cwd}.`,
      next_action: `No \`${HARNESS_DIR}/\` here — set up the harness first (create \`${HARNESS_DIR}/\`), then re-run.`,
    };
  }

  // 2. Resolve the type in the merged registry (core ∪ extension).
  const type = opts.type ?? '';
  const known = registry.types.map((t) => t.type);
  const entry = registry.types.find((t) => t.type === type);
  if (!TYPE_PATTERN.test(type) || entry === undefined) {
    return {
      ok: false,
      status: 'error',
      code: ErrorCodes.RECORD_TYPE_UNKNOWN,
      message: `Unknown record type: ${JSON.stringify(type)}.`,
      next_action: `Unknown record type \`${type}\`. Known: ${known.join(', ') || '(none)'} (run \`harness record --list\`).`,
    };
  }

  // 3. Optional slug → slugified; an explicit slug that empties out is an error.
  let slug: string | undefined;
  if (opts.slug !== undefined) {
    const cleaned = slugify(opts.slug);
    if (cleaned.length === 0) {
      return {
        ok: false,
        status: 'error',
        code: ErrorCodes.INVALID_ARGS,
        message: `Invalid --slug ${JSON.stringify(opts.slug)} (nothing left after slugify).`,
        next_action: 'Pass a slug of [a-z0-9-], e.g. `--slug my-note`.',
      };
    }
    slug = cleaned;
  }

  // 4. Resolve a never-clobbering path: <date>/<NNN>[-<slug>].md — the date is a
  //    directory and <NNN> is a per-day, per-type ordinal = 1 + the highest already
  //    present, so a fresh higher ordinal can't collide with an existing record.
  const date = dateStamp(clock);
  const dir = join(harnessDir, RECORDS_DIR, type, date);
  const fileFor = (ord: number): string => {
    const nnn = String(ord).padStart(3, '0');
    return slug ? `${nnn}-${slug}.md` : `${nnn}.md`;
  };
  let ordinal = nextOrdinal(fs, dir);
  let fileName = fileFor(ordinal);
  // Defensive: if readdir lagged and the computed name somehow exists, bump on.
  while (fs.exists(join(dir, fileName)) && ordinal < MAX_ORDINAL) {
    ordinal += 1;
    fileName = fileFor(ordinal);
  }
  const fileAbs = join(dir, fileName);
  const relPath = join(HARNESS_DIR, RECORDS_DIR, type, date, fileName);

  // 5. Exhaustion guard: refuse rather than clobber (or overflow to 4 digits) at the
  //    practically-unreachable limit of MAX_ORDINAL same-day records of this type.
  if (ordinal > MAX_ORDINAL || fs.exists(fileAbs)) {
    return {
      ok: false,
      status: 'error',
      code: ErrorCodes.RECORD_WRITE_FAILED,
      message: `Ordinal space exhausted for ${join(HARNESS_DIR, RECORDS_DIR, type, date)} (${MAX_ORDINAL}+ same-day ${type} records).`,
      next_action: `Too many \`${type}\` records on ${date} — start a new day or prune the folder.`,
    };
  }

  // 6. Ensure the scratch buffer (AC-17) + write the template — both under ONE guard so
  //    a permissions failure on `.harness/` surfaces as E181 (not a generic E100).
  try {
    ensureTemp(deps);
    fs.mkdirp(dir);
    fs.writeText(fileAbs, entry.template);
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      code: ErrorCodes.RECORD_WRITE_FAILED,
      message: `Could not write ${relPath}: ${err instanceof Error ? err.message : String(err)}`,
      next_action: `Could not write \`${relPath}\` (permissions?). Check \`${HARNESS_DIR}/\` is writable.`,
    };
  }

  return { ok: true, type, path: relPath, source: entry.source };
}
