import type { HashPort } from '../../adapters/hash/hash-port.js';
import type { PublishedTelemetrySession, ValidatedPublishedBlob } from './published-telemetry.js';
import type { RemoteSelector } from './remote-input.js';
import {
  compareUnsignedUtf8,
  parseTelemetryAdvertisement,
  type SelectionResult,
} from './remote-selection.js';

export const TELEMETRY_BUNDLE_SCHEMA_VERSION = 'harness.telemetry-pull-bundle/v1' as const;

export interface BundleRepositorySnapshot {
  key: string;
  identity: string;
  advertisedRefs: number;
  selectedRefs: number;
}

export interface TelemetryBundleBuildInput {
  selector: RemoteSelector;
  completeness: SelectionResult['completeness'];
  selectionGaps: SelectionResult['gaps'];
  sessions: PublishedTelemetrySession[];
  repositorySnapshots: BundleRepositorySnapshot[];
}

export interface TelemetryBundleIntegrityRow {
  repository_key: string;
  path: string;
  sha256: string;
  bytes: number;
}

export type BundleRefDate =
  | { state: 'known'; value: string }
  | { state: 'unavailable'; value: null };

export type BundleProductCommits =
  | { state: 'known' | 'partial'; values: string[] }
  | { state: 'unavailable'; values: null };

export interface BundleSelectionGap {
  repository_key: string;
  session_id: string | null;
  ref: string | null;
  reason: SelectionResult['gaps'][number]['reason'];
}

export interface BundleDataCoverageGap {
  field: string;
  reason: 'field_not_recorded' | 'signal_unavailable' | 'identity_only';
  refs: string[];
}

export type TelemetryBundleSelectionMode = 'session' | 'date' | 'product-commit';

export interface TelemetryBundleManifest {
  schema_version: typeof TELEMETRY_BUNDLE_SCHEMA_VERSION;
  selection: {
    mode: TelemetryBundleSelectionMode;
    session_id: string | null;
    from_date: string | null;
    to_date: string | null;
    from_commit: string | null;
    to_commit: string | null;
    completeness: 'complete' | 'partial';
    matched_repositories: number;
    matched_sessions: number;
    matched_refs: number;
    gaps: BundleSelectionGap[];
  };
  provenance: {
    repositories: Array<{
      key: string;
      url: string;
      advertised_ref_count: number;
      selected_ref_count: number;
      sessions: Array<{
        session_id: string;
        fidelity: PublishedTelemetrySession['fidelity'];
        coverage: {
          events: 'full' | 'partial' | 'unavailable';
          measurements: 'complete' | 'partial' | 'unavailable';
          gaps: BundleDataCoverageGap[];
        };
        refs: Array<{
          name: string;
          advertised_oid: string;
          date: BundleRefDate;
          shape: PublishedTelemetrySession['shapes'][number];
          product_commits: BundleProductCommits;
          commits: Array<{
            oid: string;
            tree: Array<{
              logical_path: string;
              git_blob_oid: string;
              content_sha256: string;
              bytes: number;
              bundle_path: string;
            }>;
          }>;
        }>;
        gaps: BundleSelectionGap[];
      }>;
    }>;
  };
  integrity: {
    algorithm: 'sha256';
    blobs: TelemetryBundleIntegrityRow[];
  };
}

export interface TelemetryBundleFile {
  path: string;
  bytes: Uint8Array;
}

export interface TelemetryBundle {
  manifest: TelemetryBundleManifest;
  bundleJson: string;
  files: TelemetryBundleFile[];
}

function blobKey(blob: ValidatedPublishedBlob): string {
  return `${blob.refName}\u0000${blob.commitOid}\u0000${blob.path}\u0000${blob.gitOid}`;
}

function selectionGap(
  repositoryKey: string,
  sessionId: string | null,
  reason: BundleSelectionGap['reason'],
  ref: string | null = null,
): BundleSelectionGap {
  return { repository_key: repositoryKey, session_id: sessionId, ref, reason };
}

function sortedGaps(gaps: SelectionResult['gaps']): BundleSelectionGap[] {
  return gaps
    .map((gap) => selectionGap(gap.repositoryKey, gap.sessionId, gap.reason, gap.ref))
    .sort(
      (a, b) =>
        compareUnsignedUtf8(a.repository_key, b.repository_key) ||
        compareUnsignedUtf8(a.session_id ?? '', b.session_id ?? '') ||
        compareUnsignedUtf8(a.ref ?? '', b.ref ?? '') ||
        compareUnsignedUtf8(a.reason, b.reason),
    );
}

function selectorFields(
  selector: RemoteSelector,
): Pick<
  TelemetryBundleManifest['selection'],
  'mode' | 'session_id' | 'from_date' | 'to_date' | 'from_commit' | 'to_commit'
> {
  return {
    mode: selector.kind === 'commit' ? 'product-commit' : selector.kind,
    session_id: selector.kind === 'session' ? selector.session : null,
    from_date: selector.kind === 'date' ? selector.from : null,
    to_date: selector.kind === 'date' ? selector.to : null,
    from_commit: selector.kind === 'commit' ? selector.from : null,
    to_commit: selector.kind === 'commit' ? selector.to : null,
  };
}

function refDate(name: string): BundleRefDate {
  const match = /^refs\/harness-telemetry\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(name);
  if (match === null) return { state: 'unavailable', value: null };
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date
    ? { state: 'unavailable', value: null }
    : { state: 'known', value: date };
}

function refShape(
  ref: PublishedTelemetrySession['refs'][number],
): PublishedTelemetrySession['shapes'][number] {
  const paths = new Set(ref.history.flatMap((commit) => commit.entries.map((entry) => entry.path)));
  const pair = paths.has('session.logs.jsonl') && paths.has('session.metrics.jsonl');
  const loose = [...paths].some((path) => /^\d+\.json$/.test(path));
  if (pair && loose) return 'pair-plus-fallback';
  if (pair) return 'canonical-pair';
  if (loose && paths.has('manifest.json')) return 'fallback-only';
  if (paths.has('session.metrics.jsonl') && !paths.has('session.logs.jsonl')) return 'metrics-only';
  if ([...paths].some((path) => /^\d+\.logs\.jsonl$/.test(path))) return 'legacy-history';
  return 'identity-only';
}

function bundleCoverage(
  session: PublishedTelemetrySession,
): TelemetryBundleManifest['provenance']['repositories'][number]['sessions'][number]['coverage'] {
  const refs = session.refs.map((ref) => ref.name).sort(compareUnsignedUtf8);
  return {
    events:
      session.coverage.events.state === 'full'
        ? 'full'
        : session.coverage.events.state === 'observed'
          ? 'partial'
          : 'unavailable',
    measurements:
      session.coverage.measurements.state === 'complete'
        ? 'complete'
        : session.coverage.measurements.state === 'measured'
          ? 'partial'
          : 'unavailable',
    gaps: session.coverage.gaps
      .map(
        (gap): BundleDataCoverageGap => ({
          field: gap === 'events_unavailable' ? 'events' : 'measurements',
          reason: session.fidelity === 'identity-only' ? 'identity_only' : 'signal_unavailable',
          refs,
        }),
      )
      .sort(
        (a, b) => compareUnsignedUtf8(a.field, b.field) || compareUnsignedUtf8(a.reason, b.reason),
      ),
  };
}

function sortedProductValues(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUnsignedUtf8);
}

function bundleProduct(session: PublishedTelemetrySession): BundleProductCommits {
  return session.product.state === 'unavailable'
    ? { state: 'unavailable', values: null }
    : { state: session.product.state, values: sortedProductValues(session.product.commits) };
}

function manifestConflictRefs(session: PublishedTelemetrySession): string[] {
  const refs: string[] = [];
  for (const ref of session.refs) {
    const parsed = parseTelemetryAdvertisement({ name: ref.name, oid: ref.advertisedOid });
    if (!parsed.ok || parsed.value.refDate === null) continue;
    let conflict = false;
    for (const commit of ref.history) {
      const manifest = commit.entries.find((entry) => entry.path === 'manifest.json');
      if (manifest === undefined) continue;
      try {
        const value = JSON.parse(new TextDecoder().decode(manifest.bytes)) as {
          start_date?: unknown;
        };
        if (
          typeof value.start_date === 'string' &&
          value.start_date.replaceAll('/', '-') !== parsed.value.refDate
        ) {
          conflict = true;
        }
      } catch {
        // Published sessions are already validated; malformed content cannot reach here.
      }
      break;
    }
    if (conflict) refs.push(ref.name);
  }
  return refs.sort(compareUnsignedUtf8);
}

function sessionGapRows(session: PublishedTelemetrySession): BundleSelectionGap[] {
  const rows: BundleSelectionGap[] = [];
  for (const reason of session.gaps) {
    if (reason === 'duplicate_session_identity') {
      if (session.refs.length < 2) throw new Error('inconsistent duplicate-session gap');
      rows.push(selectionGap(session.repository.key, session.sessionId, reason));
      continue;
    }
    if (reason === 'manifest_date_conflict') {
      const conflicts = manifestConflictRefs(session);
      if (conflicts.length === 0) throw new Error('inconsistent manifest-date gap');
      rows.push(
        ...conflicts.map((ref) =>
          selectionGap(session.repository.key, session.sessionId, reason, ref),
        ),
      );
      continue;
    }
    const refs = session.refs.filter((ref) => {
      if (reason === 'date_provenance_unavailable')
        return refDate(ref.name).state === 'unavailable';
      const evidence = session.refEvidence.find((item) => item.name === ref.name);
      return evidence?.product.state !== 'known';
    });
    if (refs.length === 0) throw new Error('inconsistent availability gap');
    rows.push(
      ...refs.map((ref) =>
        selectionGap(session.repository.key, session.sessionId, reason, ref.name),
      ),
    );
  }
  return rows.sort(
    (a, b) =>
      compareUnsignedUtf8(a.repository_key, b.repository_key) ||
      compareUnsignedUtf8(a.session_id ?? '', b.session_id ?? '') ||
      compareUnsignedUtf8(a.ref ?? '', b.ref ?? '') ||
      compareUnsignedUtf8(a.reason, b.reason),
  );
}

function validateSelectionGapInput(input: TelemetryBundleBuildInput): void {
  const repositories = new Set(input.repositorySnapshots.map((snapshot) => snapshot.key));
  const sessions = new Map(
    input.sessions.map((session) => [`${session.repository.key}\0${session.sessionId}`, session]),
  );
  const identities = new Set<string>();
  let availability = 0;
  for (const gap of input.selectionGaps) {
    if (!repositories.has(gap.repositoryKey) || gap.sessionId.length === 0) {
      throw new Error('inconsistent selection gap');
    }
    const identity = `${gap.repositoryKey}\0${gap.sessionId}\0${gap.ref ?? ''}\0${gap.reason}`;
    if (identities.has(identity)) throw new Error('duplicate selection gap');
    identities.add(identity);
    const parsed =
      gap.ref === null ? null : parseTelemetryAdvertisement({ name: gap.ref, oid: '0'.repeat(40) });
    if (parsed !== null && (!parsed.ok || parsed.value.sessionId !== gap.sessionId)) {
      throw new Error('mismatched selection gap ref');
    }
    const selected = sessions.get(`${gap.repositoryKey}\0${gap.sessionId}`);
    if (gap.reason === 'date_provenance_unavailable') {
      availability++;
      if (parsed === null || !parsed.ok || parsed.value.refDate !== null) {
        throw new Error('inconsistent date gap');
      }
    } else if (gap.reason === 'commit_provenance_unavailable') {
      availability++;
      if (parsed === null || !parsed.ok) throw new Error('inconsistent commit gap');
      if (selected !== undefined) {
        const evidence = selected.refEvidence.find((item) => item.name === gap.ref);
        if (evidence === undefined || evidence.product.state === 'known') {
          throw new Error('inconsistent commit gap');
        }
      }
    } else if (gap.reason === 'duplicate_session_identity') {
      if (selected === undefined || selected.refs.length < 2 || gap.ref !== null) {
        throw new Error('inconsistent duplicate-session gap');
      }
    } else if (
      selected === undefined ||
      gap.ref === null ||
      !selected.refs.some((ref) => ref.name === gap.ref) ||
      !selected.gaps.includes('manifest_date_conflict')
    ) {
      throw new Error('inconsistent manifest-date gap');
    }
  }
  if (
    (input.completeness === 'complete' && availability > 0) ||
    (input.completeness === 'partial' && availability === 0)
  ) {
    throw new Error('inconsistent selection completeness');
  }
}

/** Pure deterministic serializer. `bundle.json` deliberately never hashes itself. */
export function buildTelemetryBundle(
  input: TelemetryBundleBuildInput,
  hash: HashPort,
): TelemetryBundle {
  validateSelectionGapInput(input);
  const sessions = [...input.sessions].sort(
    (a, b) =>
      compareUnsignedUtf8(a.repository.key, b.repository.key) ||
      compareUnsignedUtf8(a.sessionId, b.sessionId),
  );
  const snapshotMap = new Map(
    input.repositorySnapshots.map((snapshot) => [snapshot.key, snapshot] as const),
  );
  const sessionByRepository = new Map<string, PublishedTelemetrySession[]>();
  for (const session of sessions) {
    const rows = sessionByRepository.get(session.repository.key) ?? [];
    rows.push(session);
    sessionByRepository.set(session.repository.key, rows);
    if (!snapshotMap.has(session.repository.key)) {
      snapshotMap.set(session.repository.key, {
        key: session.repository.key,
        identity: session.repository.identity,
        advertisedRefs: session.refs.length,
        selectedRefs: session.refs.length,
      });
    }
  }

  const storedFiles = new Map<string, Uint8Array>();
  const integrity = new Map<string, TelemetryBundleIntegrityRow>();
  const repositories = [...snapshotMap.values()]
    .sort((a, b) => compareUnsignedUtf8(a.key, b.key))
    .map((snapshot) => {
      const repositorySessions = sessionByRepository.get(snapshot.key) ?? [];
      return {
        key: snapshot.key,
        url: snapshot.identity,
        advertised_ref_count: snapshot.advertisedRefs,
        selected_ref_count: snapshot.selectedRefs,
        sessions: repositorySessions.map((session) => {
          const validated = new Map(session.blobs.map((blob) => [blobKey(blob), blob] as const));
          const refs = [...session.refs]
            .sort(
              (a, b) =>
                compareUnsignedUtf8(a.name, b.name) ||
                compareUnsignedUtf8(a.advertisedOid, b.advertisedOid),
            )
            .map((ref) => {
              const evidence = session.refEvidence.find((item) => item.name === ref.name);
              return {
                name: ref.name,
                advertised_oid: ref.advertisedOid,
                date: refDate(ref.name),
                shape: evidence?.shape ?? refShape(ref),
                product_commits:
                  evidence === undefined
                    ? bundleProduct(session)
                    : evidence.product.state === 'unavailable'
                      ? { state: 'unavailable' as const, values: null }
                      : {
                          state: evidence.product.state,
                          values: sortedProductValues(evidence.product.commits),
                        },
                commits: ref.history.map((commit) => ({
                  oid: commit.oid,
                  tree: [...commit.entries]
                    .sort(
                      (a, b) =>
                        compareUnsignedUtf8(a.path, b.path) ||
                        compareUnsignedUtf8(a.mode, b.mode) ||
                        compareUnsignedUtf8(a.type, b.type) ||
                        compareUnsignedUtf8(a.oid, b.oid),
                    )
                    .map((entry) => {
                      const source = validated.get(
                        `${ref.name}\u0000${commit.oid}\u0000${entry.path}\u0000${entry.oid}`,
                      );
                      if (source === undefined) throw new Error('unvalidated bundle entry');
                      const digest = hash.sha256Hex(source.bytes).toLowerCase();
                      if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('invalid sha256');
                      const path = `repositories/${snapshot.key}/blobs/${digest}.blob`;
                      const prior = storedFiles.get(path);
                      if (prior !== undefined && !bytesEqual(prior, source.bytes)) {
                        throw new Error('sha256 collision');
                      }
                      storedFiles.set(path, Uint8Array.from(source.bytes));
                      integrity.set(path, {
                        repository_key: snapshot.key,
                        path,
                        sha256: digest,
                        bytes: source.bytes.byteLength,
                      });
                      return {
                        logical_path: entry.path,
                        git_blob_oid: entry.oid,
                        content_sha256: digest,
                        bytes: source.bytes.byteLength,
                        bundle_path: path,
                      };
                    }),
                })),
              };
            });
          return {
            session_id: session.sessionId,
            fidelity: session.fidelity,
            coverage: bundleCoverage(session),
            refs,
            gaps: sessionGapRows(session),
          };
        }),
      };
    });

  const integrityRows = [...integrity.values()].sort((a, b) => compareUnsignedUtf8(a.path, b.path));
  const manifest: TelemetryBundleManifest = {
    schema_version: TELEMETRY_BUNDLE_SCHEMA_VERSION,
    selection: {
      ...selectorFields(input.selector),
      completeness: input.completeness,
      matched_repositories: new Set(sessions.map((session) => session.repository.key)).size,
      matched_sessions: sessions.length,
      matched_refs: sessions.reduce((sum, session) => sum + session.refs.length, 0),
      gaps: sortedGaps(input.selectionGaps),
    },
    provenance: { repositories },
    integrity: { algorithm: 'sha256', blobs: integrityRows },
  };
  const bundleJson = `${JSON.stringify(manifest, null, 2)}\n`;
  const files: TelemetryBundleFile[] = [
    { path: 'bundle.json', bytes: new TextEncoder().encode(bundleJson) },
    ...[...storedFiles.entries()]
      .sort(([a], [b]) => compareUnsignedUtf8(a, b))
      .map(([path, bytes]) => ({ path, bytes })),
  ];
  return { manifest, bundleJson, files };
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}
