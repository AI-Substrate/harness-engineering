import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { GitPort } from '../../adapters/git/git-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { ensureTemp, HARNESS_DIR } from '../shared/temp.js';
import { type ProvenanceFields, spliceProvenance } from './provenance.js';
import type { RecordRegistry } from './registry.js';

// Relocated to services/shared/temp.ts (plan 015 D1); re-exported so existing
// consumers (and tests) keep their import path.
export { ensureTemp };

/**
 * Pure record-scaffolding logic behind injected ports (`fs`/`clock`/`proc`). Like
 * `services/scaffold`, it never imports `node:fs` or `process.cwd()` (Constitution
 * P2), so it is unit-testable with fakes. The CLI owns placement uniformly:
 * `.harness/records/<type>/<YYYY-MM-DD>/<NNN>-<slug>.md` — the UTC date (via the
 * Clock) is a directory and `<NNN>` is a per-day, per-type ordinal (001, 002, …),
 * so records sort chronologically within the day and never clobber an existing file.
 */

const RECORDS_DIR = 'records';
const TYPE_PATTERN = /^[a-z][a-z0-9-]*$/;
/** Max per-day ordinal (keeps `<NNN>` 3 digits); refuse beyond rather than clobber. */
const MAX_ORDINAL = 999;

export interface RecordDeps {
  fs: FsPort;
  clock: Clock;
  proc: ProcessPort;
  /** Provenance `branch` + `repo` (`GitPort.currentBranch()` / `remoteUrl()`). */
  git: GitPort;
  /** Provenance `agent` + `plan_id` (`HARNESS_AGENT` / `HARNESS_PLAN_ID`). */
  env: EnvPort;
  /** Provenance `harness_version` — an injected string (`readVersion` reads `node:fs`, so it stays in the wiring, never the service — P2). */
  version: string;
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

/** Env value → itself when set & non-blank, else null (provenance never guesses). */
function envOrNull(value: string | undefined): string | null {
  return value !== undefined && value.trim().length > 0 ? value : null;
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
  const { fs, clock, proc, git, env, version } = deps;
  // Logical paths are POSIX on every OS (plan 017) — convert once at the boundary.
  const cwd = toPosix(proc.cwd());
  const harnessDir = posixJoin(cwd, HARNESS_DIR);

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
  const dir = posixJoin(harnessDir, RECORDS_DIR, type, date);
  const fileFor = (ord: number): string => {
    const nnn = String(ord).padStart(3, '0');
    return slug ? `${nnn}-${slug}.md` : `${nnn}.md`;
  };
  let ordinal = nextOrdinal(fs, dir);
  let fileName = fileFor(ordinal);
  // Defensive: if readdir lagged and the computed name somehow exists, bump on.
  while (fs.exists(posixJoin(dir, fileName)) && ordinal < MAX_ORDINAL) {
    ordinal += 1;
    fileName = fileFor(ordinal);
  }
  const fileAbs = posixJoin(dir, fileName);
  const relPath = posixJoin(HARNESS_DIR, RECORDS_DIR, type, date, fileName);

  // 5. Exhaustion guard: refuse rather than clobber (or overflow to 4 digits) at the
  //    practically-unreachable limit of MAX_ORDINAL same-day records of this type.
  if (ordinal > MAX_ORDINAL || fs.exists(fileAbs)) {
    return {
      ok: false,
      status: 'error',
      code: ErrorCodes.RECORD_WRITE_FAILED,
      message: `Ordinal space exhausted for ${posixJoin(HARNESS_DIR, RECORDS_DIR, type, date)} (${MAX_ORDINAL}+ same-day ${type} records).`,
      next_action: `Too many \`${type}\` records on ${date} — start a new day or prune the folder.`,
    };
  }

  // 6. Stamp the CLI-owned provenance header into the template's frontmatter
  //    (the 7 env/identity keys; `schema_version` stays template-owned). A pure
  //    string splice — the service reads only injected ports, never node:fs/git
  //    or process.cwd directly (Constitution P2). Values degrade to `null`, never
  //    guessed, when git/env can't supply them; the write still succeeds.
  const provenance: ProvenanceFields = {
    record_kind: type,
    harness_version: version,
    branch: git.currentBranch(),
    repo: git.remoteUrl(),
    created_at: clock.nowIso(),
    agent: envOrNull(env.get('HARNESS_AGENT')),
    plan_id: envOrNull(env.get('HARNESS_PLAN_ID')),
  };
  const content = spliceProvenance(entry.template, provenance);

  // 7. Ensure the scratch buffer (AC-17) + write the stamped record — both under ONE
  //    guard so a permissions failure on `.harness/` surfaces as E181 (not a generic E100).
  try {
    ensureTemp(deps);
    fs.mkdirp(dir);
    fs.writeText(fileAbs, content);
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
