import type {
  AdvertisedTelemetryRef,
  RemoteRepository,
} from '../../adapters/git/remote-telemetry-git-port.js';
import type { RemoteSelector } from './remote-input.js';
import { compareUnsignedUtf8 } from './remote-input.js';

export { compareUnsignedUtf8 } from './remote-input.js';

export interface ParsedTelemetryAdvertisement extends AdvertisedTelemetryRef {
  sessionId: string;
  /** Strict encoded ref-start date, or null when the date path is unavailable/invalid. */
  refDate: string | null;
}

export type AdvertisementParseResult =
  | { ok: true; value: ParsedTelemetryAdvertisement }
  | { ok: false; reason: 'invalid_namespace' | 'invalid_session' | 'invalid_oid' };

export interface AdvertisementWithRepository extends AdvertisedTelemetryRef {
  repository: RemoteRepository;
}

export type SelectionGap =
  | 'duplicate_session_identity'
  | 'date_provenance_unavailable'
  | 'commit_provenance_unavailable'
  | 'manifest_date_conflict';

export interface TelemetrySessionGroup {
  repository: RemoteRepository;
  sessionId: string;
  refs: ParsedTelemetryAdvertisement[];
  gaps: SelectionGap[];
}

const SAFE_SESSION = /^[A-Za-z0-9._-]{1,256}$/;
const FULL_OID = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const PREFIX = 'refs/harness-telemetry/';

function strictDate(year: string, month: string, day: string): string | null {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return null;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const value = new Date(Date.UTC(y, m - 1, d));
  if (value.getUTCFullYear() !== y || value.getUTCMonth() !== m - 1 || value.getUTCDate() !== d) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

/** Strictly normalize one advertised ref without echoing hostile input on failure. */
export function parseTelemetryAdvertisement(
  input: AdvertisedTelemetryRef,
): AdvertisementParseResult {
  if (!input.name.startsWith(PREFIX)) return { ok: false, reason: 'invalid_namespace' };
  const relative = input.name.slice(PREFIX.length);
  const parts = relative.split('/');
  const sessionId = parts.at(-1) ?? '';
  if (!SAFE_SESSION.test(sessionId)) return { ok: false, reason: 'invalid_session' };
  if (!FULL_OID.test(input.oid)) return { ok: false, reason: 'invalid_oid' };
  const refDate =
    parts.length >= 4 ? strictDate(parts[0] ?? '', parts[1] ?? '', parts[2] ?? '') : null;
  return {
    ok: true,
    value: {
      name: input.name,
      oid: input.oid.toLowerCase(),
      sessionId,
      refDate,
    },
  };
}

/** Group duplicate terminal identities per repository; never merge repositories. */
export function groupTelemetryAdvertisements(
  inputs: readonly AdvertisementWithRepository[],
): TelemetrySessionGroup[] {
  const groups = new Map<string, TelemetrySessionGroup>();
  for (const input of inputs) {
    const parsed = parseTelemetryAdvertisement(input);
    if (!parsed.ok) continue;
    const mapKey = `${input.repository.key}\u0000${parsed.value.sessionId}`;
    let group = groups.get(mapKey);
    if (group === undefined) {
      group = {
        repository: input.repository,
        sessionId: parsed.value.sessionId,
        refs: [],
        gaps: [],
      };
      groups.set(mapKey, group);
    }
    group.refs.push(parsed.value);
  }

  const out = [...groups.values()];
  for (const group of out) {
    group.refs.sort(
      (a, b) => compareUnsignedUtf8(a.name, b.name) || compareUnsignedUtf8(a.oid, b.oid),
    );
    if (group.refs.length > 1) group.gaps.push('duplicate_session_identity');
  }
  out.sort(
    (a, b) =>
      compareUnsignedUtf8(a.repository.key, b.repository.key) ||
      compareUnsignedUtf8(a.sessionId, b.sessionId),
  );
  return out;
}

export interface SnapshotCandidateSelection {
  candidates: TelemetrySessionGroup[];
  unresolved: TelemetrySessionGroup[];
}

/**
 * Select whole logical groups before any telemetry fetch. Commit selection must
 * decode provenance first, so it fetches every group; date selection records
 * unknown-only groups as unresolved without fetching them.
 */
export function selectTelemetrySnapshotCandidates(
  groups: readonly TelemetrySessionGroup[],
  selector: RemoteSelector | null,
): SnapshotCandidateSelection {
  const candidates: TelemetrySessionGroup[] = [];
  const unresolved: TelemetrySessionGroup[] = [];
  for (const group of groups) {
    if (selector === null || selector.kind === 'commit') {
      candidates.push(group);
      continue;
    }
    if (selector.kind === 'session') {
      if (group.sessionId === selector.session) candidates.push(group);
      continue;
    }
    const dates = group.refs.flatMap((ref) => (ref.refDate === null ? [] : [ref.refDate]));
    if (dates.length === 0) unresolved.push(group);
    else if (dates.some((date) => date >= selector.from && date <= selector.to)) {
      candidates.push(group);
    }
  }
  return { candidates, unresolved };
}

export type ProductProvenance =
  | { state: 'known'; commits: string[] }
  | { state: 'partial'; commits: string[] }
  | { state: 'unavailable'; commits: null };

export interface SelectableTelemetrySession extends TelemetrySessionGroup {
  product: ProductProvenance;
}

export interface SelectionResult {
  selected: SelectableTelemetrySession[];
  unresolved: SelectableTelemetrySession[];
  completeness: 'complete' | 'partial';
  gaps: Array<{
    repositoryKey: string;
    sessionId: string;
    ref: string | null;
    reason: SelectionGap;
  }>;
}

export type RepositoryCommitMembership = Readonly<
  Record<string, Readonly<Record<string, boolean>>>
>;

/** Inclusive product membership across every merge path: both ancestor predicates are required. */
export function isCommitInInclusiveInterval(
  candidate: string,
  from: string,
  to: string,
  isAncestor: (ancestor: string, descendant: string) => boolean,
): boolean {
  return isAncestor(from, candidate) && isAncestor(candidate, to);
}

/**
 * Pure whole-group selector. Commit membership is supplied by the adapter's
 * bounded two-ancestor graph result; this function never trims records/blobs.
 */
export function selectTelemetrySessionGroups(
  groups: readonly SelectableTelemetrySession[],
  selector: RemoteSelector | null,
  commitMembership: RepositoryCommitMembership = {},
): SelectionResult {
  const selected: SelectableTelemetrySession[] = [];
  const unresolved: SelectableTelemetrySession[] = [];
  const gaps: SelectionResult['gaps'] = [];
  let sawUnresolved = false;

  for (const group of groups) {
    let match = selector === null;
    let unresolvedGroup = false;
    if (selector?.kind === 'session') match = group.sessionId === selector.session;
    if (selector?.kind === 'date') {
      const knownDates = group.refs.flatMap((ref) => (ref.refDate === null ? [] : [ref.refDate]));
      match = knownDates.some((date) => date >= selector.from && date <= selector.to);
      unresolvedGroup = knownDates.length === 0;
    }
    if (selector?.kind === 'commit') {
      const commits = group.product.commits ?? [];
      const repositoryMembership = commitMembership[group.repository.key] ?? {};
      match = commits.some((commit) => repositoryMembership[commit] === true);
      unresolvedGroup = group.product.state !== 'known';
    }

    if (unresolvedGroup) sawUnresolved = true;
    if (match) selected.push(group);
    else if (unresolvedGroup) unresolved.push(group);

    if (match) {
      for (const reason of group.gaps) {
        gaps.push({
          repositoryKey: group.repository.key,
          sessionId: group.sessionId,
          ref: null,
          reason,
        });
      }
    }
    if (selector?.kind === 'date' && unresolvedGroup) {
      for (const ref of group.refs.filter((candidate) => candidate.refDate === null)) {
        gaps.push({
          repositoryKey: group.repository.key,
          sessionId: group.sessionId,
          ref: ref.name,
          reason: 'date_provenance_unavailable',
        });
      }
    }
    if (selector?.kind === 'commit' && unresolvedGroup) {
      for (const ref of group.refs) {
        gaps.push({
          repositoryKey: group.repository.key,
          sessionId: group.sessionId,
          ref: ref.name,
          reason: 'commit_provenance_unavailable',
        });
      }
    }
  }

  gaps.sort(
    (a, b) =>
      compareUnsignedUtf8(a.repositoryKey, b.repositoryKey) ||
      compareUnsignedUtf8(a.sessionId, b.sessionId) ||
      compareUnsignedUtf8(a.ref ?? '', b.ref ?? '') ||
      compareUnsignedUtf8(a.reason, b.reason),
  );
  const uniqueGaps = gaps.filter(
    (gap, index) =>
      index === 0 ||
      gap.repositoryKey !== gaps[index - 1]?.repositoryKey ||
      gap.sessionId !== gaps[index - 1]?.sessionId ||
      gap.ref !== gaps[index - 1]?.ref ||
      gap.reason !== gaps[index - 1]?.reason,
  );
  return {
    selected,
    unresolved,
    completeness: sawUnresolved ? 'partial' : 'complete',
    gaps: uniqueGaps,
  };
}
