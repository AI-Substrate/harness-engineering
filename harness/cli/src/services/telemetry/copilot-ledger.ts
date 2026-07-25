import type { FsPort } from '../../adapters/fs/fs-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import type { UsageObservationKind } from './events.js';
import { isTelemetryTime } from './segment.js';
import { normalizeUsageObservation, type UsageObservation } from './usage-observation.js';

/**
 * Copilot shutdown-ledger reader (plan 052 · T003 — dossier F-01). Copilot lanes
 * are NOT token-blind: the FULL billing record — `totalNanoAiu` (the AIC billing
 * unit ×10⁹), per-bucket `tokenDetails`, `totalApiDurationMs`, and `codeChanges`
 * counts — is written to the `session.shutdown` event of
 * `~/.copilot/session-state/<session-id>/events.jsonl`, but ONLY at graceful
 * session end (so per-command live capture always reads it null — F-01). This
 * post-hoc reader recovers it deterministically.
 *
 * PURE + FAIL-SAFE: `extractCopilotLedger` is a pure function of the file text;
 * any missing / malformed / unexpected shape degrades to `measured:false` with
 * null fields (AC-02) — never a throw, never a guessed number. PRIVACY (P12): only
 * counts + durations + the FILE COUNT of `codeChanges.filesModified` are lifted —
 * never the file paths, never any prose.
 *
 * AIC = `nano_aiu / 1e9` (a presentation concern). The raw integer `nano_aiu` is
 * carried so the export stays counts-only (Constitution P12) and lossless.
 */

/** Per-bucket token counts from `session.shutdown` `tokenDetails` (cache_write → cache_create). */
export interface CopilotTokenBuckets {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_create?: number;
}

/** `codeChanges` reduced to counts — the file COUNT, not the paths (privacy). */
export interface CopilotCodeChanges {
  files_modified: number;
  lines_added: number;
  lines_removed: number;
}

/** The recovered copilot billing record, or an honest unmeasured shell. */
export interface CopilotLedger {
  /** `true` iff a `session.shutdown` carrying a numeric `totalNanoAiu` was found. */
  measured: boolean;
  /** `totalNanoAiu` — the AIC billing unit ×10⁹ (AIC = nano_aiu/1e9); null unmeasured. */
  nano_aiu: number | null;
  token_buckets: CopilotTokenBuckets | null;
  api_duration_ms: number | null;
  code_changes: CopilotCodeChanges | null;
  /** `totalPremiumRequests` — LEGACY (pre-2026-06), NOT cost (F-10). Carried, never billed. */
  premium_requests: number | null;
}

const UNMEASURED: CopilotLedger = {
  measured: false,
  nano_aiu: null,
  token_buckets: null,
  api_duration_ms: null,
  code_changes: null,
  premium_requests: null,
};

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function nonNegativeInteger(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;
}

function typedBucket(
  details: Record<string, unknown>,
  key: string,
): { present: boolean; value?: number } | null {
  if (!(key in details)) return { present: false };
  const value = nonNegativeInteger(obj(details[key]).tokenCount);
  return value === undefined ? null : { present: true, value };
}

function usageObservation(
  event: Record<string, unknown>,
  observationKind: UsageObservationKind,
): UsageObservation | null {
  const t =
    typeof event.timestamp === 'string'
      ? event.timestamp
      : typeof event.ts === 'string'
        ? event.ts
        : typeof event.time === 'string'
          ? event.time
          : null;
  if (t === null || !isTelemetryTime(t)) return null;
  const data = obj(event.data);
  const observation: Record<string, unknown> = { t, observation_kind: observationKind };

  if (observationKind === 'message_output') {
    if (!('outputTokens' in data)) return null;
    const output = nonNegativeInteger(data.outputTokens);
    if (output === undefined) return null;
    observation.output = output;
    return normalizeUsageObservation(observation);
  }

  const details = obj(data.tokenDetails);
  const mappings = [
    ['input', 'input'],
    ['output', 'output'],
    ['cache_read', 'cache_read'],
    ['cache_write', 'cache_create'],
  ] as const;
  for (const [sourceKey, targetKey] of mappings) {
    const parsed = typedBucket(details, sourceKey);
    if (parsed === null) return null;
    if (parsed.present) observation[targetKey] = parsed.value;
  }
  if ('totalNanoAiu' in data) {
    const nanoAiu = nonNegativeInteger(data.totalNanoAiu);
    if (nanoAiu === undefined) return null;
    observation.nano_aiu = nanoAiu;
  }
  return normalizeUsageObservation(observation);
}

/** Extract only closed, counts-only usage observations from Copilot events JSONL. */
export function extractCopilotUsageObservations(eventsJsonl: string): UsageObservation[] {
  const observations: UsageObservation[] = [];
  for (const line of eventsJsonl.split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const event = parsed as Record<string, unknown>;
    const observationKind: UsageObservationKind | null =
      event.type === 'assistant.message'
        ? 'message_output'
        : event.type === 'session.usage_checkpoint'
          ? 'cumulative_checkpoint'
          : event.type === 'session.compaction'
            ? 'partial_compaction'
            : event.type === 'session.shutdown'
              ? 'final_shutdown'
              : null;
    if (observationKind === null) continue;
    const observation = usageObservation(event, observationKind);
    if (observation !== null) observations.push(observation);
  }
  return observations;
}

/**
 * Extract the copilot billing record from a session's `events.jsonl` text (pure).
 * Reads the LAST `session.shutdown` event (a session emits one at graceful end).
 * Any absence / malformed shape → {@link UNMEASURED} (never throws).
 */
export function extractCopilotLedger(eventsJsonl: string): CopilotLedger {
  let data: Record<string, unknown> | null = null;
  for (const line of eventsJsonl.split('\n')) {
    const t = line.trim();
    if (t === '' || !t.includes('session.shutdown')) continue;
    try {
      const e = JSON.parse(t) as Record<string, unknown>;
      if (e.type === 'session.shutdown') data = obj(e.data);
    } catch {
      // a corrupt line is skipped, never fatal
    }
  }
  if (data === null) return UNMEASURED;

  const nano = num(data.totalNanoAiu);
  if (nano === null) return UNMEASURED; // no headline billing → honestly unmeasured

  const details = obj(data.tokenDetails);
  const input = typedBucket(details, 'input');
  const output = typedBucket(details, 'output');
  const cacheRead = typedBucket(details, 'cache_read');
  const cacheCreate = typedBucket(details, 'cache_write');
  const buckets = [input, output, cacheRead, cacheCreate];
  const tokenBuckets =
    buckets.some((entry) => entry === null) || !buckets.some((entry) => entry?.present)
      ? null
      : {
          ...(input?.present && input.value !== undefined ? { input: input.value } : {}),
          ...(output?.present && output.value !== undefined ? { output: output.value } : {}),
          ...(cacheRead?.present && cacheRead.value !== undefined
            ? { cache_read: cacheRead.value }
            : {}),
          ...(cacheCreate?.present && cacheCreate.value !== undefined
            ? { cache_create: cacheCreate.value }
            : {}),
        };
  const cc = obj(data.codeChanges);
  const filesModified = Array.isArray(cc.filesModified) ? cc.filesModified.length : 0;
  return {
    measured: true,
    nano_aiu: nano,
    token_buckets: tokenBuckets,
    api_duration_ms: num(data.totalApiDurationMs),
    code_changes: {
      files_modified: filesModified,
      lines_added: num(cc.linesAdded) ?? 0,
      lines_removed: num(cc.linesRemoved) ?? 0,
    },
    premium_requests: num(data.totalPremiumRequests),
  };
}

/** The copilot session `events.jsonl` path for a resolved home + harness session id. */
export function copilotSessionEventsPath(home: string, sessionId: string): string {
  return posixJoin(toPosix(home), '.copilot', 'session-state', sessionId, 'events.jsonl');
}

/**
 * Read + extract a copilot lane's billing ledger by harness session id. Missing
 * home / missing file → {@link UNMEASURED} (never throws). Ports-only (P2).
 */
export function readCopilotLedger(
  fs: Pick<FsPort, 'readText'>,
  home: string | undefined,
  sessionId: string,
): CopilotLedger {
  if (!home) return UNMEASURED;
  const raw = fs.readText(copilotSessionEventsPath(home, sessionId));
  if (raw === null) return UNMEASURED;
  return extractCopilotLedger(raw);
}

/** AIC (the human billing unit) from nano-AIU; null when unmeasured. */
export function aicFromNano(nanoAiu: number | null): number | null {
  return nanoAiu === null ? null : nanoAiu / 1e9;
}
