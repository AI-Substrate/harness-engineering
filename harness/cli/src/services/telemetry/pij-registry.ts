import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';

/**
 * pij registry join port (plan 052 · T006 — dossier F-04). The flow-pair fleet's
 * lane join keys already live in pij's per-peer descriptors at `~/.pij/<id>.json`:
 * each carries the INNER harness session id (`harnessSessionId` — the copilot/codex/
 * claude session id the side-channel ledgers are keyed by) plus the codex rollout
 * `transcriptPath`, the `harness` label, and `spawnedBy`. This module READS that
 * registry into a lookup so `get-fleet` can resolve a roster pij id → its vendor
 * side-channel (F-01/F-02 ledgers) without any pij-side change.
 *
 * READ-ONLY + FAIL-SAFE (the whole telemetry read posture): never mutates `~/.pij`,
 * never throws. An absent `~/.pij` (no pij installed), an unreadable dir, or a
 * corrupt descriptor resolves to an unavailable / partial registry — never an
 * exception. PRIVACY (P12): only ids + the closed `harness` label are lifted; the
 * descriptor's paths/pids/timestamps are not surfaced beyond the codex transcript
 * path (an id used solely to LOCATE the rollout, never emitted in the export).
 */

/** One pij peer descriptor, reduced to the fleet join keys (ids + harness label only). */
export interface PijDescriptor {
  /** The peer's pij id (the `~/.pij/<id>.json` basename). */
  pij_id: string;
  /** `claude | copilot | codex | pi`, or null when the descriptor carried none. */
  harness: string | null;
  /** The INNER harness session id — the copilot/codex/claude session the ledgers key on. */
  harness_session_id: string | null;
  /** The codex rollout transcript path (used to LOCATE the rollout — never emitted). */
  transcript_path: string | null;
  /** The parent pij id that spawned this peer, or null. */
  spawned_by: string | null;
  /** First model label if the descriptor carried one, else null. */
  model: string | null;
}

/** The registry lookup — pij id ⇄ harness session id, plus an availability flag. */
export interface PijRegistry {
  /** `false` when `~/.pij` is absent / unreadable — the source is simply unavailable. */
  available: boolean;
  /** pij id → descriptor. */
  by_pij: Map<string, PijDescriptor>;
  /** harness session id → pij id (the reverse join the ref/live paths use). */
  by_harness_session: Map<string, string>;
}

/** The ports this reader needs — `readdir`/`readText` and `env.home()`. */
export interface PijRegistryDeps {
  fs: Pick<FsPort, 'readText' | 'readdir'>;
  env: Pick<EnvPort, 'home'>;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Parse one `~/.pij/<id>.json` body into a {@link PijDescriptor} (pure). Tolerant:
 * unparseable JSON or a non-object body → `null`; individual missing fields → `null`
 * (never thrown). `pijId` is the caller-supplied id (the filename), echoed back.
 */
export function parsePijDescriptor(pijId: string, raw: string): PijDescriptor | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (body === null || typeof body !== 'object') return null;
  const d = body as Record<string, unknown>;
  return {
    pij_id: pijId,
    harness: str(d.harness),
    harness_session_id: str(d.harnessSessionId),
    transcript_path: str(d.transcriptPath),
    spawned_by: str(d.spawnedBy),
    model: str(d.model),
  };
}

/** The `~/.pij` directory for a resolved home, in POSIX form. */
export function pijDir(home: string): string {
  return posixJoin(toPosix(home), '.pij');
}

/**
 * Read the whole `~/.pij` registry into a {@link PijRegistry} lookup. Absent home
 * or an absent / empty `~/.pij` dir → `{ available:false }` with empty maps (the
 * source is unavailable — a `readdir` cannot distinguish absent from empty, and
 * both mean "no join data", never an error). Corrupt/partial descriptors are
 * skipped individually.
 */
export function readPijRegistry(deps: PijRegistryDeps): PijRegistry {
  const empty: PijRegistry = {
    available: false,
    by_pij: new Map(),
    by_harness_session: new Map(),
  };
  const home = deps.env.home();
  if (!home) return empty;
  const dir = pijDir(home);
  const names = deps.fs.readdir(dir);
  if (names.length === 0) return empty; // absent or empty → unavailable

  const by_pij = new Map<string, PijDescriptor>();
  const by_harness_session = new Map<string, string>();
  for (const name of names) {
    const m = /^(pij-[^/]+)\.json$/.exec(name);
    if (m === null) continue;
    const pijId = m[1];
    const raw = deps.fs.readText(posixJoin(dir, name));
    if (raw === null) continue;
    const desc = parsePijDescriptor(pijId, raw);
    if (desc === null) continue;
    by_pij.set(pijId, desc);
    if (desc.harness_session_id !== null && !by_harness_session.has(desc.harness_session_id)) {
      by_harness_session.set(desc.harness_session_id, pijId);
    }
  }
  return { available: true, by_pij, by_harness_session };
}
