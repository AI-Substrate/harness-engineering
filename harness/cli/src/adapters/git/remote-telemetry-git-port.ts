/**
 * Dedicated read-only port for arbitrary remote published telemetry.
 *
 * Unlike GitReadPort (local, fetch-free) and GitWritePort (origin publication),
 * this seam owns remote advertisement, disposable verified telemetry snapshots,
 * and bounded product-commit graph membership. Services never receive a temp path
 * or invoke Git/process APIs directly.
 */

export interface RemoteRepository {
  /** Stable public key: `repo-` plus the first 16 hex SHA-256 characters. */
  key: string;
  /** Canonical, credential-free identity safe for output. */
  identity: string;
  /** Validated network transport URL; never contains a password/token. */
  transportUrl: string;
}

export interface AdvertisedTelemetryRef {
  name: string;
  oid: string;
}

export interface RemoteAdvertisementSuccess {
  ok: true;
  refs: AdvertisedTelemetryRef[];
  /** Invalid names/OIDs are counted without echoing hostile bytes. */
  malformedRefCount: number;
}

export type RemoteTelemetryFailureKind =
  | 'transport'
  | 'invalid_telemetry'
  | 'namespace_moved'
  | 'endpoint_unknown'
  | 'range_diverged';

export interface RemoteTelemetryFailure {
  ok: false;
  kind: RemoteTelemetryFailureKind;
  /** Safe static summary only; adapters must not expose stderr/temp paths/URLs. */
  message: string;
  repositoryKey: string;
}

export type RemoteAdvertisementResult = RemoteAdvertisementSuccess | RemoteTelemetryFailure;

export interface RemoteTelemetryBlob {
  path: string;
  mode: string;
  type: 'blob';
  oid: string;
  bytes: Uint8Array;
}

export interface RemoteTelemetryCommit {
  oid: string;
  parents: string[];
  /** Tree entries are normalized but bytes remain verbatim. */
  entries: RemoteTelemetryBlob[];
}

export interface RemoteTelemetryRefSnapshot {
  name: string;
  advertisedOid: string;
  /** Child-before-parent deterministic history. */
  history: RemoteTelemetryCommit[];
}

export interface RemoteEffects {
  advertisedRefs: number;
  fetchedRefs: number;
  telemetryBytes: number;
  productGraphFetched: boolean;
  callerRepositoryMutated: false;
  disposableStoreRemoved: boolean;
}

export interface TelemetrySnapshot {
  repository: RemoteRepository;
  refs: RemoteTelemetryRefSnapshot[];
  effects: RemoteEffects;
}

export interface SnapshotRequest {
  repository: RemoteRepository;
  /** Complete advertised telemetry namespace used only for movement proof. */
  advertisedRefs: readonly AdvertisedTelemetryRef[];
  /** Selector-specific whole-session refs fetched into the disposable store. */
  candidateRefs: readonly AdvertisedTelemetryRef[];
}

export type TelemetrySnapshotResult =
  | { ok: true; snapshot: TelemetrySnapshot }
  | RemoteTelemetryFailure;

export interface CommitRangeRequest {
  repository: RemoteRepository;
  from: string;
  to: string;
  candidates: readonly string[];
}

export type ProductCommitIntervalResult =
  | {
      ok: true;
      /** Candidate OID → inclusive two-ancestor membership. */
      membership: Record<string, boolean>;
      /** Candidate OIDs unavailable in the bounded graph (selection gaps). */
      unavailable: string[];
    }
  | RemoteTelemetryFailure;

export interface RemoteTelemetryGitPort {
  advertiseTelemetryRefs(repository: RemoteRepository): Promise<RemoteAdvertisementResult>;
  loadVerifiedTelemetrySnapshot(request: SnapshotRequest): Promise<TelemetrySnapshotResult>;
  resolveProductCommitInterval(request: CommitRangeRequest): Promise<ProductCommitIntervalResult>;
}
