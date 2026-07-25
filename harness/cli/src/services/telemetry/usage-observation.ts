import {
  type Event,
  USAGE_BUCKET_KEYS,
  USAGE_OBSERVATION_KINDS,
  type UsageBucketKey,
  type UsageEvent,
  type UsageObservationKind,
} from './events.js';
import {
  COVERAGE_STRENGTH,
  type EvidenceObservationKind,
  isBucketAbsenceReason,
  isSubstantiveReason,
  reasonSpecificity,
  SESSION_TOTAL_KIND,
  type TokenCoverageState,
  type TokenEvidence,
  type TokenEvidenceReason,
  type TokenEvidenceSource,
  type TokenFieldEvidence,
} from './token-evidence.js';

/** One counts-only usage observation. Source prose and identity never enter this type. */
export interface UsageObservation {
  t: string;
  observation_kind: UsageObservationKind;
  input?: number;
  output?: number;
  cache_read?: number;
  cache_create?: number;
  nano_aiu?: number;
  /**
   * DERIVED, never wire data (`normalizeUsageObservation` does not read it): which
   * observation kind each bucket actually came from, set by
   * {@link reduceUsageObservations} when it had to compose buckets across kinds
   * because no single observation carried them all (finding 04).
   */
  field_kinds?: Partial<Record<UsageBucketKey, UsageObservationKind>>;
  /**
   * DERIVED: message observations exist after the selected cumulative observation, so
   * these values are a prefix of the session with a known-missing tail (finding 03).
   */
  post_checkpoint_tail?: boolean;
}

const USAGE_KIND_SET: ReadonlySet<string> = new Set(USAGE_OBSERVATION_KINDS);

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Rebuild an observation from its closed allowlist. Unknown kinds, malformed
 * buckets, missing timestamps, and bucket-less records fail closed.
 */
export function normalizeUsageObservation(value: unknown): UsageObservation | null {
  if (value === null || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (typeof source.t !== 'string' || source.t.length === 0) return null;
  if (typeof source.observation_kind !== 'string' || !USAGE_KIND_SET.has(source.observation_kind)) {
    return null;
  }

  const observation: UsageObservation = {
    t: source.t,
    observation_kind: source.observation_kind as UsageObservationKind,
  };
  let hasBucket = false;
  for (const key of USAGE_BUCKET_KEYS) {
    if (!(key in source)) continue;
    const count = nonNegativeInteger(source[key]);
    if (count === undefined) return null;
    observation[key] = count;
    hasBucket = true;
  }
  return hasBucket ? observation : null;
}

function latestOfKind(
  observations: readonly UsageObservation[],
  kind: UsageObservationKind,
): UsageObservation | undefined {
  let latest: UsageObservation | undefined;
  let latestTime = Number.NEGATIVE_INFINITY;
  let latestIndex = -1;
  for (let index = 0; index < observations.length; index += 1) {
    const observation = observations[index];
    if (observation.observation_kind !== kind) continue;
    const parsed = Date.parse(observation.t);
    const time = Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
    if (latest === undefined || time > latestTime || (time === latestTime && index > latestIndex)) {
      latest = observation;
      latestTime = time;
      latestIndex = index;
    }
  }
  return latest;
}

/**
 * Resolve unlike evidence without adding it: chronologically latest valid final,
 * else latest cumulative checkpoint, else the sum of every distinct source
 * message record, else latest partial compaction as explicitly partial evidence.
 */
export function reduceUsageObservations(
  observations: readonly UsageObservation[],
): UsageObservation | null {
  const valid = observations.flatMap((observation) => {
    const normalized = normalizeUsageObservation(observation);
    return normalized === null ? [] : [normalized];
  });

  const messages = valid.filter((observation) => observation.observation_kind === 'message_output');
  const messageSum = sumMessages(messages);

  // Candidates in descending kind authority. Each is a WHOLE observation; buckets are
  // taken from the first candidate that carries them, never summed across kinds.
  const candidates: UsageObservation[] = [];
  const final = latestOfKind(valid, 'final_shutdown');
  if (final !== undefined) candidates.push(final);
  const checkpoint = latestOfKind(valid, 'cumulative_checkpoint');
  if (checkpoint !== undefined) candidates.push(checkpoint);
  if (messageSum !== null) candidates.push(messageSum);
  const compaction = latestOfKind(valid, 'partial_compaction');
  if (compaction !== undefined) candidates.push(compaction);
  const base = candidates[0];
  if (base === undefined) return null;

  // Compose per field (finding 04): a sparse final (e.g. `nano_aiu` only) must not
  // bury the four buckets a fuller checkpoint measured. Each bucket keeps the kind it
  // actually came from so the evidence layer can be honest about a mixed set.
  const reduced: UsageObservation = { t: base.t, observation_kind: base.observation_kind };
  const fieldKinds: Partial<Record<UsageBucketKey, UsageObservationKind>> = {};
  for (const key of USAGE_BUCKET_KEYS) {
    for (const candidate of candidates) {
      const value = candidate[key];
      if (value === undefined) continue;
      reduced[key] = value;
      fieldKinds[key] = candidate.observation_kind;
      break;
    }
  }
  if (USAGE_BUCKET_KEYS.every((key) => reduced[key] === undefined)) return null;
  if (Object.values(fieldKinds).some((kind) => kind !== base.observation_kind)) {
    reduced.field_kinds = fieldKinds;
  }

  // Finding 03: work that continued past the selected cumulative observation is not in
  // it. We do not add the tail (unlike kinds never sum) — we declare it.
  if (
    base.observation_kind === 'final_shutdown' ||
    base.observation_kind === 'cumulative_checkpoint'
  ) {
    const baseTime = Date.parse(base.t);
    const tail = messages.some((message) => {
      const t = Date.parse(message.t);
      return Number.isFinite(t) && Number.isFinite(baseTime) && t > baseTime;
    });
    if (tail) reduced.post_checkpoint_tail = true;
  }
  return reduced;
}

/** Sum every distinct message record into one `message_output` observation. */
function sumMessages(messages: readonly UsageObservation[]): UsageObservation | null {
  const latest = latestOfKind(messages, 'message_output');
  if (latest === undefined) return null;
  const reduced: UsageObservation = { t: latest.t, observation_kind: 'message_output' };
  for (const key of USAGE_BUCKET_KEYS) {
    let present = false;
    let total = 0;
    for (const observation of messages) {
      const count = observation[key];
      if (count === undefined) continue;
      present = true;
      total += count;
    }
    if (present) reduced[key] = total;
  }
  return reduced;
}

/** Reduce every typed usage event in one session with the same kind precedence. */
export function reduceUsageEvents(events: readonly Event[]): UsageObservation | null {
  const observations: UsageObservation[] = [];
  for (const event of events) {
    if (event.kind !== 'usage') continue;
    const usage = event as UsageEvent;
    const observation: UsageObservation = {
      t: usage.t,
      observation_kind: usage.observation_kind,
    };
    if (usage.in !== undefined) observation.input = usage.in;
    if (usage.out !== undefined) observation.output = usage.out;
    if (usage.cache_read !== undefined) observation.cache_read = usage.cache_read;
    if (usage.cache_create !== undefined) observation.cache_create = usage.cache_create;
    if (usage.nano_aiu !== undefined) observation.nano_aiu = usage.nano_aiu;
    observations.push(observation);
  }
  return reduceUsageObservations(observations);
}

export interface CompleteUsageTokens {
  input: number;
  output: number;
  cache_read: number;
  cache_create: number;
  total: number;
}

/** Project only a complete authoritative observation into additive token buckets. */
export function completeUsageTokens(
  observation: UsageObservation | null,
): CompleteUsageTokens | null {
  if (
    observation === null ||
    observation.observation_kind === 'partial_compaction' ||
    observation.input === undefined ||
    observation.output === undefined ||
    observation.cache_read === undefined ||
    observation.cache_create === undefined
  ) {
    return null;
  }
  return {
    input: observation.input,
    output: observation.output,
    cache_read: observation.cache_read,
    cache_create: observation.cache_create,
    total:
      observation.input + observation.output + observation.cache_read + observation.cache_create,
  };
}

const PRIMARY_TOKEN_FIELDS: readonly UsageBucketKey[] = [
  'input',
  'output',
  'cache_read',
  'cache_create',
];

function unavailableField(reason: TokenEvidenceReason): TokenFieldEvidence {
  return {
    value: null,
    source: null,
    observation_kind: null,
    coverage: 'unavailable',
    reason,
  };
}

export function tokenEvidenceFromObservation(
  observation: UsageObservation | null,
  source: TokenEvidenceSource,
  /**
   * Label every bucket with this kind instead of the observation's own — used only by
   * {@link tokenEvidenceFromLegacyTokens} to stamp a whole-session rollup
   * `session_total`. Per-bucket `field_kinds` still win, because those record a real
   * cross-kind composition (finding 04).
   */
  kindOverride?: EvidenceObservationKind,
): TokenEvidence {
  const fields = Object.fromEntries(
    USAGE_BUCKET_KEYS.map((key) => {
      const value = observation?.[key];
      return [
        key,
        value === undefined
          ? unavailableField(observation === null ? 'no_observation' : 'field_absent')
          : {
              value,
              source,
              // The kind this BUCKET came from — which is not the observation's own
              // kind when the reduction composed across kinds (finding 04).
              observation_kind:
                observation?.field_kinds?.[key] ??
                kindOverride ??
                observation?.observation_kind ??
                null,
              coverage: 'measured' as const,
              reason: null,
            },
      ];
    }),
  ) as Record<UsageBucketKey, TokenFieldEvidence>;
  const measured = PRIMARY_TOKEN_FIELDS.filter((key) => fields[key].coverage === 'measured').length;
  const complete = measured === PRIMARY_TOKEN_FIELDS.length;
  const mixedKinds = observation?.field_kinds !== undefined;
  const tail = observation?.post_checkpoint_tail === true;
  const coverage: TokenCoverageState =
    observation?.observation_kind === 'partial_compaction' || tail || mixedKinds
      ? measured > 0
        ? 'partial'
        : 'unavailable'
      : complete
        ? 'measured'
        : measured > 0
          ? 'partial'
          : 'unavailable';
  return {
    coverage,
    reason:
      coverage === 'measured'
        ? null
        : coverage === 'unavailable'
          ? 'no_observation'
          : // Most specific first: a known-missing tail and a cross-kind composition
            // are precise diagnoses; `partial_observation` is the generic fallback.
            tail
            ? 'post_checkpoint_tail'
            : mixedKinds
              ? 'mixed_observation_kinds'
              : 'partial_observation',
    cause: 'unknown',
    source: measured > 0 ? source : null,
    fields,
  };
}

export interface LegacyTokenBuckets {
  input: number;
  output: number;
  cache_read: number;
  cache_create: number;
}

export interface LegacyTokenOpts {
  /**
   * TRUE when this rollup is whole-session BY CONSTRUCTION — a committed ROLLED ref
   * holds every seq of the session in one tree, so its sum is the session, and it must
   * rank with a real `final_shutdown` (both speak for the whole session; plan 052
   * AC-06's source precedence then decides between them).
   *
   * FALSE (the default) for a sum of the LOCAL BUFFER's capture windows. Capture runs
   * on harness commands and the vendor writes its shutdown after the last one, so that
   * sum structurally cannot contain the tail. Stamping it whole-session would hand it
   * authority over a vendor final and silently resurrect finding 01 (R2-01).
   */
  wholeSession?: boolean;
}

export function tokenEvidenceFromLegacyTokens(
  tokens: LegacyTokenBuckets | null,
  source: TokenEvidenceSource,
  opts?: LegacyTokenOpts,
): TokenEvidence {
  return tokenEvidenceFromObservation(
    tokens === null
      ? null
      : {
          t: '1970-01-01T00:00:00.000Z',
          observation_kind: 'cumulative_checkpoint',
          input: tokens.input,
          output: tokens.output,
          cache_read: tokens.cache_read,
          cache_create: tokens.cache_create,
        },
    source,
    opts?.wholeSession === true ? SESSION_TOTAL_KIND : undefined,
  );
}

const KIND_QUALITY: Record<EvidenceObservationKind, number> = {
  session_total: 5,
  final_shutdown: 4,
  cumulative_checkpoint: 3,
  message_output: 2,
  partial_compaction: 1,
};
const SOURCE_QUALITY: Record<TokenEvidenceSource, number> = { live: 3, ref: 2, ledger: 1 };

/**
 * How much of a session a field's origin speaks for — the FIRST merge key, above
 * source (finding 01). Live capture windows structurally never contain the shutdown
 * event, so without this axis a window-scoped live field masks an authoritative
 * session-scoped ledger/ref field and the lane still reports `measured`.
 *
 * The top tier is WHOLE SESSION: a `session_total` rollup (the ref's tree is the entire
 * session) and a vendor `final_shutdown` (written once the session is over). Below it
 * sits a real wire `cumulative_checkpoint` — cumulative up to a MOMENT, so whatever
 * happened after it is missing. That split is R2-02's ruling and it buys two properties
 * one kind could not hold at once: a final now outranks a wire checkpoint REGARDLESS of
 * source (the original finding-01 intent), while a ref rollup and a ledger final still
 * tie here so plan 052 AC-06's source precedence decides and the ref keeps winning.
 *
 * {@link KIND_QUALITY} stays a separate, lower key: it breaks a remaining tie once
 * scope AND source are equal.
 */
const SCOPE_QUALITY: Record<EvidenceObservationKind, number> = {
  session_total: 3,
  final_shutdown: 3,
  cumulative_checkpoint: 2,
  message_output: 1,
  partial_compaction: 0,
};

/** Did any bucket this candidate could not report survive the merge still unfilled? */
function hasUnfilledBucket(
  candidate: TokenEvidence,
  merged: Record<UsageBucketKey, TokenFieldEvidence>,
): boolean {
  return PRIMARY_TOKEN_FIELDS.some(
    (key) => candidate.fields[key].coverage !== 'measured' && merged[key].coverage !== 'measured',
  );
}

export function mergeTokenEvidence(candidates: readonly TokenEvidence[]): TokenEvidence {
  const fields = {} as Record<UsageBucketKey, TokenFieldEvidence>;
  /** The candidates a winning field was actually taken from — R2-02's constraint set. */
  const contributors = new Set<TokenEvidence>();
  for (const key of USAGE_BUCKET_KEYS) {
    const measured = candidates
      .map((candidate) => ({ candidate, field: candidate.fields[key] }))
      .filter(
        (
          entry,
        ): entry is {
          candidate: TokenEvidence;
          field: TokenFieldEvidence & { value: number; source: TokenEvidenceSource };
        } =>
          entry.field.coverage === 'measured' &&
          entry.field.value !== null &&
          entry.field.source !== null,
      )
      .sort(
        (a, b) =>
          // Scope first (finding 01), then source, then kind. A window-scoped field can
          // never mask a session-scoped one no matter which store it came from.
          SCOPE_QUALITY[b.field.observation_kind ?? 'partial_compaction'] -
            SCOPE_QUALITY[a.field.observation_kind ?? 'partial_compaction'] ||
          SOURCE_QUALITY[b.field.source] - SOURCE_QUALITY[a.field.source] ||
          KIND_QUALITY[b.field.observation_kind ?? 'partial_compaction'] -
            KIND_QUALITY[a.field.observation_kind ?? 'partial_compaction'],
      );
    const winner = measured[0];
    if (winner === undefined) {
      fields[key] = unavailableField('field_absent');
      continue;
    }
    fields[key] = winner.field;
    contributors.add(winner.candidate);
  }
  const measuredCount = PRIMARY_TOKEN_FIELDS.filter(
    (key) => fields[key].coverage === 'measured',
  ).length;
  const containsPartial = PRIMARY_TOKEN_FIELDS.some(
    (key) => fields[key].observation_kind === 'partial_compaction',
  );
  // The shape of the merged field set on its own terms.
  const structural: TokenCoverageState = containsPartial
    ? 'partial'
    : measuredCount === PRIMARY_TOKEN_FIELDS.length
      ? 'measured'
      : measuredCount > 0
        ? 'partial'
        : 'unavailable';

  // R2-02: a merge may never claim MORE coverage than the VALUES it selected. Field
  // counts alone cannot see a candidate's declared partiality — a lane that honestly
  // said `post_checkpoint_tail`, `mixed_observation_kinds` or
  // `flushed_segments_unreadable` still contributes four measured fields, so recomputing
  // from counts laundered every one of those labels back to `measured`/null and deleted
  // the honesty the layers below had just computed.
  //
  // Only SUBSTANTIVE shortfalls constrain the merge. A candidate that is merely sparse
  // (`partial_observation` — it lacked buckets) is repaired by taking those buckets from
  // another candidate; that is what merging is for, and propagating it would degrade a
  // genuinely complete set.
  // …and a bucket-absence reason (`vendor_field_absent`) constrains only while its own
  // gap SURVIVES: it names a bucket the vendor cannot report, so once a second source
  // supplies that bucket the merged set is complete and the reason is discharged
  // (R3-02). Kept substantive while unfilled — it diagnoses the gap far better than the
  // generic `partial_observation` it would otherwise fall back to.
  const constraining = [...contributors].filter(
    (candidate) =>
      candidate.coverage !== 'measured' &&
      isSubstantiveReason(candidate.reason) &&
      (!isBucketAbsenceReason(candidate.reason) || hasUnfilledBucket(candidate, fields)),
  );
  let coverage = structural;
  for (const candidate of constraining) {
    if (COVERAGE_STRENGTH[candidate.coverage] < COVERAGE_STRENGTH[coverage]) {
      coverage = candidate.coverage;
    }
  }
  // …and the most diagnosable reason among them. Falls back to the generic structural
  // reason when no contributor named a specific cause.
  const declared = constraining
    .map((candidate) => candidate.reason)
    .sort((a, b) => reasonSpecificity(a) - reasonSpecificity(b))[0];
  const structuralReason: TokenEvidenceReason | null =
    coverage === 'measured'
      ? null
      : coverage === 'partial'
        ? 'partial_observation'
        : 'no_observation';

  const sourceCounts = new Map<TokenEvidenceSource, number>();
  for (const field of Object.values(fields)) {
    if (field.source !== null)
      sourceCounts.set(field.source, (sourceCounts.get(field.source) ?? 0) + 1);
  }
  const source =
    [...sourceCounts.entries()].sort(
      (a, b) => b[1] - a[1] || SOURCE_QUALITY[b[0]] - SOURCE_QUALITY[a[0]],
    )[0]?.[0] ?? null;
  return {
    coverage,
    reason: coverage === 'measured' ? null : (declared ?? structuralReason),
    cause: 'unknown',
    source,
    fields,
  };
}
