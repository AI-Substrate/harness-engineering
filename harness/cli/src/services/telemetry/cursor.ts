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
 * Make an opaque session id safe for a path segment — collapse anything outside
 * `[A-Za-z0-9_-]` (so `..`, `/`, etc. can never escape the telemetry dir).
 */
export function sanitizeSessionId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unknown';
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
