import type { TreeEntry } from '../../adapters/git/git-write-port.js';

/**
 * The ROLLED shard shape (plan 049 Phase 1) — one quiet ref per session at its start
 * date. Where the legacy shape published a flat per-seq blob set (`<seq>.logs.jsonl`
 * + `<seq>.metrics.jsonl`) into a per-(capture-date, session) ref (and each sync's
 * tree clobbered earlier segments — F-03), a rolled ref carries the WHOLE session in
 * ONE tree, rebuilt from the local buffer every sync:
 *
 *   session.logs.jsonl     — every seq's OTLP logs record, seq-ordered, one per line
 *   session.metrics.jsonl  — every seq's OTLP metrics record, seq-ordered
 *   <seq>.json             — a loose fallback for any seq WITHOUT a complete spool
 *                            pair (partial/absent — AC-14: never drop a segment)
 *   manifest.json          — {format, session, start_date, max_seq}
 *
 * Because each per-seq spool blob is a SINGLE-LINE JSON object (`writeJsonLine`:
 * `JSON.stringify(obj)\n`), concatenating them is valid JSONL and {@link splitJsonl}
 * is its exact inverse. Pure (P2: no `node:*`); the git surface is injected.
 */

/** The rolled logs blob name (seq-ordered OTLP logs records, one JSON object per line). */
export const ROLLED_LOGS_NAME = 'session.logs.jsonl';
/** The rolled metrics blob name. */
export const ROLLED_METRICS_NAME = 'session.metrics.jsonl';
/** The rolled manifest blob name — its presence is the new-shape discriminator. */
export const ROLLED_MANIFEST_NAME = 'manifest.json';
/** The manifest format marker (versioned so a future layout change is detectable). */
export const ROLLUP_FORMAT = 'harness-telemetry-rollup/v1' as const;

/** The rolled ref's manifest — layout metadata, NOT captured telemetry (P12: no new event fields). */
export interface RollManifest {
  format: typeof ROLLUP_FORMAT;
  session: string;
  /** `YYYY/MM/DD` — the session's start (first-segment) date; the ref's date bucket. */
  start_date: string;
  /** The highest buffer seq folded into this tree (the idempotency watermark). */
  max_seq: number;
}

/** The minimal git write surface the rolled-tree builder needs (P2: no `node:*`). */
export interface RolledGit {
  hashObject(content: string): string;
  mktree(entries: TreeEntry[]): string;
}

/** A loose per-seq fallback blob (a seq whose spool pair was partial/absent). */
export interface LooseBlob {
  /** `<seq>.json`. */
  name: string;
  content: string;
}

/** The material a rolled tree is built from — seq-ordered signal records + fallbacks. */
export interface RolledSpec {
  session: string;
  startDate: string;
  /** Seq-ordered logs records (each already a single-line OTLP LogsData JSON object). */
  logsLines: string[];
  /** Seq-ordered metrics records. */
  metricsLines: string[];
  /** Fallback loose `<seq>.json` blobs (kept verbatim — never concatenated). */
  looseJson: LooseBlob[];
  /** The highest seq included (the manifest watermark). */
  maxSeq: number;
}

/** Serialize the manifest with a STABLE key order (byte-deterministic across runs). */
export function serializeManifest(m: RollManifest): string {
  return `${JSON.stringify({
    format: m.format,
    session: m.session,
    start_date: m.start_date,
    max_seq: m.max_seq,
  })}\n`;
}

/** Parse a manifest blob; `null` when it is absent/corrupt or not the rollup format. */
export function parseManifest(raw: string | null | undefined): RollManifest | null {
  if (raw == null) return null;
  try {
    const o = JSON.parse(raw) as Partial<RollManifest>;
    if (o.format !== ROLLUP_FORMAT || typeof o.session !== 'string') return null;
    return {
      format: ROLLUP_FORMAT,
      session: o.session,
      start_date: typeof o.start_date === 'string' ? o.start_date : '',
      max_seq: typeof o.max_seq === 'number' ? o.max_seq : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Concatenate single-line JSON records into one JSONL blob — each record trimmed of
 * trailing newlines then joined with exactly one `\n`, with a final `\n`. The exact
 * inverse of {@link splitJsonl}, so a round-trip preserves every record's bytes.
 */
export function concatJsonl(records: readonly string[]): string {
  if (records.length === 0) return '';
  return `${records.map((r) => r.replace(/\n+$/, '')).join('\n')}\n`;
}

/** Split a rolled JSONL blob back into its per-record lines (drops blank lines). */
export function splitJsonl(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Build the rolled tree from its seq-ordered material: emit `session.logs.jsonl` /
 * `session.metrics.jsonl` (when non-empty), each loose `<seq>.json` fallback (sorted
 * for determinism), and `manifest.json`. Content-addressed via the injected git —
 * identical material ⇒ identical `treeSha`, which is the idempotency guard (a re-sync
 * that changes nothing rebuilds the SAME tree, so the writer skips a duplicate commit).
 */
export function buildRolledEntries(
  git: RolledGit,
  spec: RolledSpec,
): { entries: TreeEntry[]; treeSha: string; manifest: RollManifest } {
  const entries: TreeEntry[] = [];
  const add = (name: string, content: string): void => {
    entries.push({ mode: '100644', type: 'blob', sha: git.hashObject(content), name });
  };
  if (spec.logsLines.length > 0) add(ROLLED_LOGS_NAME, concatJsonl(spec.logsLines));
  if (spec.metricsLines.length > 0) add(ROLLED_METRICS_NAME, concatJsonl(spec.metricsLines));
  for (const j of [...spec.looseJson].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    add(j.name, j.content);
  }
  const manifest: RollManifest = {
    format: ROLLUP_FORMAT,
    session: spec.session,
    start_date: spec.startDate,
    max_seq: spec.maxSeq,
  };
  add(ROLLED_MANIFEST_NAME, serializeManifest(manifest));
  return { entries, treeSha: git.mktree(entries), manifest };
}
