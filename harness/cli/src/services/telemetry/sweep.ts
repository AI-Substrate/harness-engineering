/**
 * `sweep.ts` (plan 048 Phase 1 · T1.6 / AC-01) — PLAN a month-scoped telemetry
 * sweep for one repo. The measures substrate already ships single-session export
 * (`session save --source git-ref`) and N-input `report`; a month sweep is their
 * COMPOSITION over the committed `refs/harness-telemetry/YYYY/MM/*` shards — this
 * file owns only the pure planning, so the collector is a driver, not a new read
 * path (dossier F-01/F-02).
 *
 * PURE SERVICE (P2): no `node:*`, no git, no clock, no fs. The caller
 * (`acts/telemetry.ts`) enumerates refs + reads shard trees through the git READ
 * port, feeds their content fingerprints in, exports the fresh sessions, and
 * writes the report/HTML/cache. Everything here is a deterministic function of its
 * inputs so re-sweeps are idempotent and the cache decision is unit-testable.
 */

/** The committed-shard ref namespace (mirrors `git-write-port.TELEMETRY_REF_PREFIX`). */
const TELEMETRY_REF_PREFIX = 'refs/harness-telemetry';

/** The on-disk per-sweep cache file (under `--out`), keyed by session id → fingerprint. */
export const SWEEP_CACHE_FILE = '.sweep-cache.json';

/** A committed shard tree blob (name + UTF-8 content) — mirrors `git-read-port.ShardBlob`. */
export interface ShardBlobLike {
  name: string;
  content: string;
}

/** One in-month telemetry ref the sweep considers, with a caller-computed fingerprint. */
export interface SweepRefInput {
  /** `refs/harness-telemetry/YYYY/MM/DD/<session>`. */
  ref: string;
  /** The session id (the ref's final segment). */
  session: string;
  /** `YYYY/MM/DD` — the ref's date shard. */
  datePath: string;
  /** A content digest of the ref's shard tree (the "tip" proxy for cache invalidation). */
  fingerprint: string;
}

/** One session's sweep plan: its in-month refs, a combined fingerprint, and the cache verdict. */
export interface SweepSession {
  session: string;
  /** Sorted, this session's in-month refs. */
  refs: string[];
  /** Combined (sorted) fingerprint over `refs` — the cache key. */
  fingerprint: string;
  /** `true` ⇒ unchanged since the last sweep ⇒ REUSE the prior export (skip re-export). */
  cached: boolean;
}

/** The whole month plan: which sessions to (re-)export vs reuse. */
export interface SweepPlan {
  /** The requested `YYYY-MM`. */
  month: string;
  /** `refs/harness-telemetry/YYYY/MM/` — the enumerated ref prefix. */
  month_prefix: string;
  /** Sorted by session id (stable output). */
  sessions: SweepSession[];
  total_sessions: number;
  /** Cached (skipped) sessions. */
  reused: number;
  /** Sessions needing a (re-)export. */
  fresh: number;
}

/** The persisted per-session fingerprint cache (session id → combined fingerprint). */
export type SweepCache = Record<string, string>;

/** Parse + validate a `YYYY-MM` month; `null` when malformed or the month is out of 01–12. */
export function parseMonth(month: string): { yyyy: string; mm: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (m === null) return null;
  const mm = Number.parseInt(m[2] ?? '', 10);
  if (!Number.isFinite(mm) || mm < 1 || mm > 12) return null;
  return { yyyy: m[1] ?? '', mm: m[2] ?? '' };
}

/** `refs/harness-telemetry/YYYY/MM/` for a valid month, else `''`. */
export function monthRefPrefix(month: string): string {
  const p = parseMonth(month);
  return p === null ? '' : `${TELEMETRY_REF_PREFIX}/${p.yyyy}/${p.mm}/`;
}

/**
 * Parse a telemetry ref into its session + date shard, or `null` when it does not
 * match `refs/harness-telemetry/YYYY/MM/DD/<session>` (a non-telemetry ref, a
 * short/odd shape). The session is the ref's final segment (opaque, slash-free by
 * construction — but we join defensively so an unexpected slash never truncates it).
 */
export function parseTelemetryRef(ref: string): { session: string; datePath: string } | null {
  const prefix = `${TELEMETRY_REF_PREFIX}/`;
  if (!ref.startsWith(prefix)) return null;
  const rest = ref.slice(prefix.length).split('/');
  if (rest.length < 4) return null;
  const [yyyy, mm, dd, ...sessionParts] = rest;
  const session = sessionParts.join('/');
  if (
    !/^\d{4}$/.test(yyyy ?? '') ||
    !/^\d{2}$/.test(mm ?? '') ||
    !/^\d{2}$/.test(dd ?? '') ||
    session.length === 0
  ) {
    return null;
  }
  return { session, datePath: `${yyyy}/${mm}/${dd}` };
}

/** True when a `YYYY/MM/DD` date shard falls inside the requested `YYYY-MM`. */
export function refInMonth(datePath: string, month: string): boolean {
  const p = parseMonth(month);
  return p !== null && datePath.startsWith(`${p.yyyy}/${p.mm}/`);
}

/** A pure djb2 digest (unsigned, hex) — collision-resistant enough for cache invalidation. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/**
 * A deterministic fingerprint of a shard tree — the "tip" proxy the sweep cache
 * keys on. Order-independent (sorted by blob name) so ref enumeration order never
 * changes it; sensitive to every blob's content (`name:len:djb2`) so any appended
 * segment or edited shard invalidates the cache.
 */
export function fingerprintBlobs(blobs: readonly ShardBlobLike[]): string {
  return [...blobs]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((b) => `${b.name}:${b.content.length}:${djb2(b.content)}`)
    .join('|');
}

/** Combine a session's per-ref fingerprints into one deterministic cache key. */
function combinedFingerprint(refs: readonly SweepRefInput[]): string {
  return [...refs]
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
    .map((r) => `${r.ref}=${r.fingerprint}`)
    .join('\n');
}

/**
 * Plan the month sweep: keep the in-month refs, group them by session, and decide
 * per session whether its combined fingerprint MATCHES the prior cache (⇒ reuse) or
 * changed / is new (⇒ re-export). Deterministic + pure; sorted by session id.
 */
export function planMonthSweep(
  month: string,
  refs: readonly SweepRefInput[],
  cache: SweepCache,
): SweepPlan {
  const bySession = new Map<string, SweepRefInput[]>();
  for (const r of refs) {
    if (!refInMonth(r.datePath, month)) continue;
    const list = bySession.get(r.session) ?? [];
    list.push(r);
    bySession.set(r.session, list);
  }
  const sessions: SweepSession[] = [...bySession.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([session, list]) => {
      const fingerprint = combinedFingerprint(list);
      return {
        session,
        refs: list.map((r) => r.ref).sort(),
        fingerprint,
        cached: cache[session] === fingerprint,
      };
    });
  const reused = sessions.filter((s) => s.cached).length;
  return {
    month,
    month_prefix: monthRefPrefix(month),
    sessions,
    total_sessions: sessions.length,
    reused,
    fresh: sessions.length - reused,
  };
}

/** The next on-disk cache = every planned session → its combined fingerprint. */
export function nextSweepCache(plan: SweepPlan): SweepCache {
  const out: SweepCache = {};
  for (const s of plan.sessions) out[s.session] = s.fingerprint;
  return out;
}
