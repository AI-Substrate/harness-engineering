import type { FsPort } from '../../adapters/fs/fs-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import { HARNESS_DIR, TEMP_DIR } from '../shared/temp.js';

/**
 * The telemetry session cursor (plan 034, T006/T007) — a per-session watermark
 * recording the high-water source offset already captured, so the next command
 * windows only the "since last command" delta. Pure over the injected `FsPort`
 * (no `node:*`). Writes are crash-safe (temp + rename, mirroring `flow-service`),
 * so a partial write never leaves a corrupt watermark (T007).
 */

export const TELEMETRY_DIR = 'telemetry';

/** `.harness/temp/telemetry` under `cwd` (posix). */
export function telemetryDir(cwd: string): string {
  return posixJoin(toPosix(cwd), HARNESS_DIR, TEMP_DIR, TELEMETRY_DIR);
}

/**
 * A short, stable, deterministic suffix derived from the raw id — two independent
 * 32-bit hash passes (distinct bases + multipliers) concatenated into a ~64-bit
 * digest, so distinct lossy ids collide only with NEGLIGIBLE probability (not an
 * absolute guarantee — it is a hash, not a perfect injection). NOT cryptographic;
 * its only job is collision-resistance for the session's rolled ref segment. Pure
 * (P2: no `node:crypto`).
 */
function shortHash(s: string): string {
  let h1 = 0x811c9dc5; // FNV-1a basis
  let h2 = 0xc2b2ae35; // a different basis → an independent second word
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193); // FNV prime
    h2 = Math.imul(h2 ^ c, 0x85ebca77); // a different odd multiplier (decorrelates the words)
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/**
 * Make an opaque session id safe for a path segment — collapse anything outside
 * `[A-Za-z0-9_-]` (so `..`, `/`, etc. can never escape the telemetry dir).
 *
 * H4 (plan 038, telemetry-otel): the session id is also the session's rolled REF
 * segment, and two writers colliding on a segment → a non-fast-forward push →
 * lost telemetry. A lossy collapse breaks uniqueness (`a/b` and `a-b` both → `a-b`;
 * every all-symbol id → the same fallback). So whenever cleaning changed the
 * string, append a wide deterministic digest of the RAW id — collisions then become
 * NEGLIGIBLY unlikely (a hash, not a perfect guarantee). A clean id (alnum/`_`/`-`
 * only — the UUID-like norm) passes through untouched.
 */
export function sanitizeSessionId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (cleaned === raw && cleaned.length > 0) return cleaned;
  return `${cleaned || 'sess'}-${shortHash(raw)}`;
}

/** Path to the session's `.cursor` watermark file. */
export function cursorPathFor(cwd: string, sessionId: string): string {
  return posixJoin(telemetryDir(cwd), `${sanitizeSessionId(sessionId)}.cursor`);
}

/** Path to the session's `.branch` marker (last-seen git branch — for branch-change detection). */
export function branchPathFor(cwd: string, sessionId: string): string {
  return posixJoin(telemetryDir(cwd), `${sanitizeSessionId(sessionId)}.branch`);
}

/** Read the last-seen branch, or `null` when missing/empty (the first capture of a session). */
export function readBranch(fs: FsPort, path: string): string | null {
  const raw = fs.readText(path);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Persist the last-seen branch crash-safely (temp + rename), mirroring {@link writeCursor}. */
export function writeBranch(fs: FsPort, path: string, branch: string): void {
  const tmp = `${path}.tmp`;
  fs.writeText(tmp, branch);
  fs.rename(tmp, path);
}

/** Directory holding the session's buffered segment entries (`<seq>.json`). */
export function sessionDirFor(cwd: string, sessionId: string): string {
  return posixJoin(telemetryDir(cwd), sanitizeSessionId(sessionId));
}

/**
 * Path to the `.flowcursor` for a (session, plan) pair (plan 035 — flow replay).
 * Keyed per-PLAN (not just per-session) because the flight-plan event log is
 * per-plan: a session touching two plans must window each plan's log independently.
 * The value is the count of `the-flow.json` `events[]` already surfaced — an
 * append-only ARRAY OFFSET, not a timestamp.
 */
export function flowCursorPathFor(cwd: string, sessionId: string, planId: string): string {
  return posixJoin(
    telemetryDir(cwd),
    `${sanitizeSessionId(sessionId)}.${sanitizeSessionId(planId)}.flowcursor`,
  );
}

/** Read the flow-log offset, or `0` when missing/corrupt (first capture ⇒ surface full history). */
export function readFlowCursor(fs: FsPort, path: string): number {
  const raw = fs.readText(path);
  if (raw === null) return 0;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const n = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/** Persist the flow-log offset crash-safely (temp + rename), mirroring {@link writeCursor}. */
export function writeFlowCursor(fs: FsPort, path: string, offset: number): void {
  const tmp = `${path}.tmp`;
  fs.writeText(tmp, String(offset));
  fs.rename(tmp, path);
}

/** Read the durable flushed segment high-water, or `0` when missing/corrupt. */
export function readFlushed(fs: FsPort, path: string): number {
  const raw = fs.readText(path);
  if (raw === null) return 0;
  const t = raw.trim();
  return /^\d+$/.test(t) ? Number.parseInt(t, 10) : 0;
}

/**
 * Read the watermark, or `null` when missing OR corrupt (non-numeric / negative /
 * empty). A `null` tells the caller to reset to session-start — a corrupt cursor
 * never throws and never yields a bogus offset.
 */
export function readCursor(fs: FsPort, path: string): number | null {
  const raw = fs.readText(path);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Persist the watermark crash-safely: write a sibling `.tmp`, then `rename` it
 * over the target. A crash before the rename leaves the PRIOR watermark intact
 * and readable (never a half-written/corrupt cursor). Caller ensures the parent
 * dir exists.
 */
export function writeCursor(fs: FsPort, path: string, value: number): void {
  const tmp = `${path}.tmp`;
  fs.writeText(tmp, String(value));
  fs.rename(tmp, path);
}
