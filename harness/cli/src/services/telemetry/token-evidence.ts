import type { UsageBucketKey, UsageObservationKind } from './events.js';

export const TOKEN_EVIDENCE_SOURCES = ['live', 'ref', 'ledger'] as const;
export type TokenEvidenceSource = (typeof TOKEN_EVIDENCE_SOURCES)[number];

export const TOKEN_COVERAGE_STATES = ['measured', 'partial', 'unavailable'] as const;
export type TokenCoverageState = (typeof TOKEN_COVERAGE_STATES)[number];

export const TOKEN_EVIDENCE_REASONS = [
  'no_observation',
  'field_absent',
  'partial_observation',
  'identity_unavailable',
  'source_unavailable',
  /**
   * The local buffer holds only the UNFLUSHED delta — a mid-session sync pruned the
   * rest — and the committed ref carrying the flushed half could not be read. The
   * values present are real but they are a SUBSET of the session (finding 02).
   */
  'flushed_segments_unreadable',
  /**
   * Message observations exist AFTER the cumulative observation that was selected, so
   * the values are a real prefix of the session with a known-missing tail (finding 03).
   * Unlike kinds are never added — the tail is declared, not summed.
   */
  'post_checkpoint_tail',
  /**
   * Buckets were composed from observations of different kinds because no single
   * observation carried them all (e.g. a nano-AIU-only final over a fuller
   * checkpoint) — each value is measured, the set is not one coherent snapshot
   * (finding 04).
   */
  'mixed_observation_kinds',
  /**
   * The vendor has no concept of this bucket at all (codex reports no cache-WRITE
   * accounting), so it is absent rather than zero. Stamping a measured 0 would be a
   * zero-without-evidence and would flip the lane to `measured` on a synthesized
   * number (finding 09).
   */
  'vendor_field_absent',
  /**
   * WHY a Claude transcript could not be read — the locator's own closed taxonomy,
   * carried through the segment so an operator can diagnose a token-blind session
   * without source-diving (finding 07). `unresolved` stays deliberately broad: it
   * covers no-session-id, failed Git discovery, and io-errors alike.
   */
  'transcript_zero',
  'transcript_multiple',
  'transcript_unresolved',
  'transcript_traversal',
  'transcript_symlink',
  'transcript_non_file',
  'transcript_oversize',
  'transcript_malformed',
  'transcript_ambiguity',
] as const;

export type TokenEvidenceReason = (typeof TOKEN_EVIDENCE_REASONS)[number];

/**
 * How strong a coverage claim is. A merge takes the WORST strength across the
 * candidates it actually selected fields from (R2-02): a merged result must never claim
 * more coverage than its own evidence, or the honesty labels the layers below it
 * computed are laundered back to `measured`/null on the way out.
 */
export const COVERAGE_STRENGTH: Record<TokenCoverageState, number> = {
  measured: 2,
  partial: 1,
  unavailable: 0,
};

/**
 * Reasons ordered MOST DIAGNOSABLE FIRST. When several contributing candidates each
 * declare why they are short, the merge keeps the one that tells an operator the most;
 * the generic three at the tail are fallbacks that name no specific cause.
 */
export const REASON_SPECIFICITY: readonly TokenEvidenceReason[] = [
  'flushed_segments_unreadable',
  'post_checkpoint_tail',
  'mixed_observation_kinds',
  'vendor_field_absent',
  'transcript_zero',
  'transcript_multiple',
  'transcript_traversal',
  'transcript_symlink',
  'transcript_non_file',
  'transcript_oversize',
  'transcript_malformed',
  'transcript_ambiguity',
  'transcript_unresolved',
  'identity_unavailable',
  'source_unavailable',
  'partial_observation',
  'field_absent',
  'no_observation',
];

/** Rank for {@link REASON_SPECIFICITY}; unknown/absent reasons sort last. */
export function reasonSpecificity(reason: TokenEvidenceReason | null): number {
  if (reason === null) return Number.POSITIVE_INFINITY;
  const index = REASON_SPECIFICITY.indexOf(reason);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

/**
 * The three reasons that describe MISSING BUCKETS rather than short VALUES: the
 * candidate simply did not carry those fields. Filling them from a second candidate is
 * exactly what a merge is FOR, so these must not survive it — a sparse vendor final
 * (input/output) merged with a live observation (cache buckets) is a complete,
 * genuinely `measured` set, and propagating their sparsity would be a false degrade.
 *
 * Every other reason says the values the candidate DID measure are short of the
 * session (a known-missing tail, an unreachable flushed half, a cross-kind
 * composition). No other candidate can repair that, so it must survive the merge
 * (R2-02) — except {@link BUCKET_ABSENCE_REASONS}, which are repairable but worth
 * naming while they last.
 */
const STRUCTURAL_REASONS: readonly TokenEvidenceReason[] = [
  'partial_observation',
  'field_absent',
  'no_observation',
];

/** True when a reason names a real shortfall in the VALUES, not just absent buckets. */
export function isSubstantiveReason(reason: TokenEvidenceReason | null): boolean {
  return reason !== null && !STRUCTURAL_REASONS.includes(reason);
}

/**
 * Reasons that name an ABSENT BUCKET the vendor has no CONCEPT of — codex reports no
 * cache-write, so `cache_create` is missing rather than zero and the values codex DID
 * measure are not short of the session.
 *
 * By the rule above that makes them repairable, but they are kept substantive because
 * `vendor_field_absent` is far more diagnosable than a generic `partial_observation` —
 * conditionally, and the condition is that the gap SURVIVES the merge. Once another
 * source supplies the bucket the set is complete, and carrying the reason would label a
 * complete set `partial`: the exact false degrade the split exists to prevent (R3-02).
 */
const BUCKET_ABSENCE_REASONS: readonly TokenEvidenceReason[] = ['vendor_field_absent'];

/** True when a reason is DISCHARGED by another candidate filling the missing bucket. */
export function isBucketAbsenceReason(reason: TokenEvidenceReason | null): boolean {
  return reason !== null && BUCKET_ABSENCE_REASONS.includes(reason);
}

/** Map an adapter's `token_unavailable_reason` onto the evidence taxonomy (finding 07). */
export function transcriptEvidenceReason(reason: string | undefined): TokenEvidenceReason | null {
  if (reason === undefined || reason.length === 0) return null;
  const candidate = `transcript_${reason.replace(/-/g, '_')}`;
  return (TOKEN_EVIDENCE_REASONS as readonly string[]).includes(candidate)
    ? (candidate as TokenEvidenceReason)
    : null;
}

/**
 * A whole-session rollup BY CONSTRUCTION — the rolled ref carries every seq of a
 * session in one tree, so summing it is not an observation of the session, it IS the
 * session. DERIVED ONLY: it is deliberately absent from `USAGE_OBSERVATION_KINDS`, so
 * `normalizeUsageObservation` rejects it and no wire record can ever claim it.
 *
 * It exists because a SYNTHETIC stamp must not constrain REAL kind semantics (R2-01).
 * While legacy rollups borrowed `cumulative_checkpoint`, no ranking could both keep a
 * real `final_shutdown` above a real wire checkpoint AND keep plan 052 AC-06's
 * ref-before-ledger precedence — the two claims collided inside one kind. Splitting
 * them buys both.
 */
export const SESSION_TOTAL_KIND = 'session_total' as const;

/**
 * The kinds that can label a token FIELD: the four wire observation kinds plus the
 * derived {@link SESSION_TOTAL_KIND}. Wider than {@link UsageObservationKind} on
 * purpose — evidence records where a number came from, which is not always an
 * observation an agent emitted.
 */
export type EvidenceObservationKind = UsageObservationKind | typeof SESSION_TOTAL_KIND;

export interface TokenFieldEvidence {
  value: number | null;
  source: TokenEvidenceSource | null;
  observation_kind: EvidenceObservationKind | null;
  coverage: 'measured' | 'unavailable';
  reason: TokenEvidenceReason | null;
}

export interface TokenEvidence {
  coverage: TokenCoverageState;
  reason: TokenEvidenceReason | null;
  cause: 'unknown';
  source: TokenEvidenceSource | null;
  fields: Record<UsageBucketKey, TokenFieldEvidence>;
}
