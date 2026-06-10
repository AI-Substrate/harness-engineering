import { join } from 'node:path';
import type { Clock } from '../../adapters/clock/clock-port.js';
import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { ProcessPort } from '../../adapters/process/process-port.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { ensureTemp, HARNESS_DIR, TEMP_DIR } from '../shared/temp.js';
import {
  OBSERVATION_KINDS,
  OBSERVATION_SEVERITIES,
  type ObservationEntry,
  parseBuffer,
  serializeEntry,
} from './buffer-codec.js';

/**
 * Pure capture/list/clear logic for `harness observe` behind injected ports
 * (P2/P3) — the deterministic half of in-flight friction capture the old
 * observe skill made agents re-infer every session. The CLI owns: agent
 * identity resolution (D4), schema validation at write (D6), per-kind
 * sequential IDs over a tolerant parse (D2/D3), append-only buffer writes,
 * and the `ensureTemp()` gitignore guarantee at capture time (AC-5).
 */

export interface ObserveDeps {
  fs: FsPort;
  clock: Clock;
  proc: ProcessPort;
  env: EnvPort;
}

export interface CaptureOptions {
  description?: string;
  kind?: string;
  target?: string;
  severity?: string;
  workaround?: string;
  suggestedEncoding?: string;
  agent?: string;
}

export interface ObserveFailure {
  ok: false;
  status: 'error' | 'unconfigured';
  code?: string;
  message: string;
  next_action: string;
}

export type CaptureOutcome =
  | { ok: true; bucket: string; id: string; kind: string; path: string }
  | ObserveFailure;

/** One pending observation, annotated with the bucket it came from (D9). */
export interface AnnotatedEntry extends ObservationEntry {
  bucket: string;
}

export type ListOutcome =
  | {
      ok: true;
      observations: AnnotatedEntry[];
      buckets_scanned: string[];
      malformed_skipped: number;
    }
  | ObserveFailure;

export type ClearOutcome =
  | { ok: true; cleared: number; buckets_scanned: string[]; malformed_skipped: number }
  | ObserveFailure;

const BUFFER_FILE = 'session-buffer.md';
const DEFAULT_BUCKET = 'agent';
const MIN_DESCRIPTION = 10;

/** Lowercase-kebab the raw identity; empties out rather than failing (D4). */
function sanitizeBucket(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Resolve the buffer bucket (D4, extending spec D-11): `--agent` flag →
 * `HARNESS_AGENT` env → the literal `agent`. Each candidate is kebab-sanitized;
 * an empty or whitespace-only value is treated as unset and falls through the
 * chain — capture NEVER fails on identity (it's provenance labeling, not
 * routing ceremony).
 */
export function resolveBucket(agentFlag: string | undefined, env: EnvPort): string {
  for (const candidate of [agentFlag, env.get('HARNESS_AGENT')]) {
    if (candidate !== undefined) {
      const cleaned = sanitizeBucket(candidate);
      if (cleaned.length > 0) return cleaned;
    }
  }
  return DEFAULT_BUCKET;
}

/** Capture ONE observation: validate → resolve identity → assign ID → append. */
export function captureObservation(opts: CaptureOptions, deps: ObserveDeps): CaptureOutcome {
  const cwd = deps.proc.cwd();
  if (!deps.fs.exists(join(cwd, HARNESS_DIR))) {
    return unconfiguredRepo(cwd);
  }

  // Validation at write (D6): reject before any side effect, buffer untouched.
  const kind = opts.kind ?? '';
  const kinds = Object.keys(OBSERVATION_KINDS);
  if (!kinds.includes(kind)) {
    return {
      ok: false,
      status: 'unconfigured',
      message: `Unknown --kind ${JSON.stringify(kind)}.`,
      next_action: `Pass --kind as one of: ${kinds.join(', ')}.`,
    };
  }
  const description = opts.description ?? '';
  if (description.length < MIN_DESCRIPTION) {
    return {
      ok: false,
      status: 'unconfigured',
      message: `Description too short (${description.length} chars).`,
      next_action: `Describe the observation in at least ${MIN_DESCRIPTION} characters (got ${description.length}).`,
    };
  }
  if (
    opts.severity !== undefined &&
    !(OBSERVATION_SEVERITIES as readonly string[]).includes(opts.severity)
  ) {
    return {
      ok: false,
      status: 'unconfigured',
      message: `Unknown --severity ${JSON.stringify(opts.severity)}.`,
      next_action: `Pass --severity as one of: ${OBSERVATION_SEVERITIES.join(', ')}.`,
    };
  }

  const bucket = resolveBucket(opts.agent, deps.env);
  const bucketDir = join(cwd, HARNESS_DIR, TEMP_DIR, bucket);
  const bufferAbs = join(bucketDir, BUFFER_FILE);
  const relPath = join(HARNESS_DIR, TEMP_DIR, bucket, BUFFER_FILE);

  let existing = '';
  if (deps.fs.exists(bufferAbs)) {
    const text = deps.fs.readText(bufferAbs);
    if (text === null) {
      return unreadableBuffer(relPath);
    }
    existing = text;
  }

  // Per-kind sequential ID over the VALID entries only — malformed blocks are
  // skipped by the scan and the buffer is never rewritten (AC-3).
  const prefix = OBSERVATION_KINDS[kind as keyof typeof OBSERVATION_KINDS];
  const id = nextId(prefix, parseBuffer(existing).entries);

  const entry: ObservationEntry = {
    id,
    kind,
    description,
    ...(opts.target !== undefined && { target: opts.target }),
    ...(opts.severity !== undefined && { severity: opts.severity }),
    ...(opts.workaround !== undefined && { workaround: opts.workaround }),
    ...(opts.suggestedEncoding !== undefined && { suggested_encoding: opts.suggestedEncoding }),
    first_seen_at: deps.clock.nowIso(),
  };

  try {
    ensureTemp(deps); // the transient guarantee fires at capture time (AC-5)
    deps.fs.mkdirp(bucketDir);
    const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    deps.fs.writeText(bufferAbs, existing + separator + serializeEntry(entry));
  } catch (err) {
    return {
      ok: false,
      status: 'error',
      code: ErrorCodes.UNKNOWN,
      message: `Could not write ${relPath}: ${err instanceof Error ? err.message : String(err)}`,
      next_action: `Could not write \`${relPath}\` (permissions?). Check \`${HARNESS_DIR}/\` is writable.`,
    };
  }

  return { ok: true, bucket, id, kind, path: relPath };
}

/**
 * List pending observations — ALL buckets by default (the sweep that keeps any
 * bucket from stranding, D-12), `--agent` narrowing to one. Entries come back
 * verbatim, annotated with their bucket; deviant blocks are counted in
 * `malformed_skipped` and preserved on disk (D3/D9).
 */
export function listObservations(opts: { agent?: string }, deps: ObserveDeps): ListOutcome {
  const swept = sweepBuckets(opts, deps);
  if ('failure' in swept) return swept.failure;

  const observations: AnnotatedEntry[] = [];
  let malformed = 0;
  for (const bucket of swept.buckets) {
    const { entries, malformed: m } = parseBuffer(bucket.content);
    malformed += m;
    for (const entry of entries) {
      observations.push({ ...entry, bucket: bucket.name });
    }
  }
  return {
    ok: true,
    observations,
    buckets_scanned: swept.buckets.map((b) => b.name),
    malformed_skipped: malformed,
  };
}

/**
 * Truncate what `--list` would return (all buckets by default, `--agent`-scoped;
 * files kept). `cleared` counts the valid entries removed; deviant blocks are
 * reported in `malformed_skipped` so their (now wiped) presence is never silent.
 */
export function clearObservations(opts: { agent?: string }, deps: ObserveDeps): ClearOutcome {
  const swept = sweepBuckets(opts, deps);
  if ('failure' in swept) return swept.failure;

  let cleared = 0;
  let malformed = 0;
  for (const bucket of swept.buckets) {
    const { entries, malformed: m } = parseBuffer(bucket.content);
    cleared += entries.length;
    malformed += m;
    deps.fs.writeText(bucket.bufferAbs, '');
  }
  return {
    ok: true,
    cleared,
    buckets_scanned: swept.buckets.map((b) => b.name),
    malformed_skipped: malformed,
  };
}

interface SweptBucket {
  name: string;
  bufferAbs: string;
  content: string;
}

/**
 * Resolve which buckets to operate on and read their buffers up front, so an
 * unreadable buffer mid-sweep fails the whole command honestly (E146, D6)
 * before any truncation happens.
 */
function sweepBuckets(
  opts: { agent?: string },
  deps: ObserveDeps,
): { buckets: SweptBucket[] } | { failure: ObserveFailure } {
  const cwd = deps.proc.cwd();
  if (!deps.fs.exists(join(cwd, HARNESS_DIR))) {
    return { failure: unconfiguredRepo(cwd) };
  }
  const tempDir = join(cwd, HARNESS_DIR, TEMP_DIR);

  const scoped = opts.agent !== undefined ? sanitizeBucket(opts.agent) : undefined;
  const candidates =
    scoped !== undefined && scoped.length > 0 ? [scoped] : deps.fs.readdir(tempDir).slice().sort();

  const buckets: SweptBucket[] = [];
  for (const name of candidates) {
    const bufferAbs = join(tempDir, name, BUFFER_FILE);
    if (!deps.fs.exists(bufferAbs)) {
      continue; // not a bucket (e.g. the nested .gitignore) or nothing captured yet
    }
    const content = deps.fs.readText(bufferAbs);
    if (content === null) {
      return { failure: unreadableBuffer(join(HARNESS_DIR, TEMP_DIR, name, BUFFER_FILE)) };
    }
    buckets.push({ name, bufferAbs, content });
  }
  return { buckets };
}

function nextId(prefix: string, entries: ObservationEntry[]): string {
  let max = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  for (const entry of entries) {
    const m = pattern.exec(entry.id);
    if (m?.[1] !== undefined) {
      const n = Number.parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

function unconfiguredRepo(cwd: string): ObserveFailure {
  return {
    ok: false,
    status: 'unconfigured',
    message: `No ${HARNESS_DIR}/ directory found in ${cwd}.`,
    next_action: `No \`${HARNESS_DIR}/\` here — set up the harness first (create \`${HARNESS_DIR}/\`), then re-run.`,
  };
}

function unreadableBuffer(relPath: string): ObserveFailure {
  return {
    ok: false,
    status: 'error',
    code: ErrorCodes.OBSERVE_BUFFER_UNREADABLE,
    message: `Observation buffer ${relPath} exists but could not be read.`,
    next_action: `Inspect \`${relPath}\` — fix permissions or move it aside, then retry (the CLI never deletes it).`,
  };
}
