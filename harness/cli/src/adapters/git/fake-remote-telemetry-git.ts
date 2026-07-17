import type {
  CommitRangeRequest,
  ProductCommitIntervalResult,
  RemoteAdvertisementResult,
  RemoteRepository,
  RemoteTelemetryGitPort,
  SnapshotRequest,
  TelemetrySnapshotResult,
} from './remote-telemetry-git-port.js';

export type FakeRemoteTelemetryGitCall =
  | { kind: 'advertise'; repository: RemoteRepository }
  | { kind: 'snapshot'; request: SnapshotRequest }
  | { kind: 'interval'; request: CommitRangeRequest };

export interface FakeRemoteTelemetryGitRepositoryState {
  advertisement?: RemoteAdvertisementResult;
  snapshot?: TelemetrySnapshotResult;
  interval?: ProductCommitIntervalResult;
}

export interface FakeRemoteTelemetryGitState extends FakeRemoteTelemetryGitRepositoryState {
  byRepository?: Record<string, FakeRemoteTelemetryGitRepositoryState>;
}

/** Recording fake for pure/service tests; no subprocess or filesystem effects. */
export class FakeRemoteTelemetryGit implements RemoteTelemetryGitPort {
  readonly calls: FakeRemoteTelemetryGitCall[] = [];

  constructor(private readonly state: FakeRemoteTelemetryGitState = {}) {}

  private stateFor(repositoryKey: string): FakeRemoteTelemetryGitRepositoryState {
    return this.state.byRepository?.[repositoryKey] ?? this.state;
  }

  async advertiseTelemetryRefs(repository: RemoteRepository): Promise<RemoteAdvertisementResult> {
    this.calls.push({ kind: 'advertise', repository: { ...repository } });
    return (
      this.stateFor(repository.key).advertisement ?? {
        ok: true,
        refs: [],
        malformedRefCount: 0,
      }
    );
  }

  async loadVerifiedTelemetrySnapshot(request: SnapshotRequest): Promise<TelemetrySnapshotResult> {
    this.calls.push({
      kind: 'snapshot',
      request: {
        repository: { ...request.repository },
        advertisedRefs: request.advertisedRefs.map((ref) => ({ ...ref })),
        candidateRefs: request.candidateRefs.map((ref) => ({ ...ref })),
      },
    });
    return (
      this.stateFor(request.repository.key).snapshot ?? {
        ok: true,
        snapshot: {
          repository: request.repository,
          refs: [],
          effects: {
            advertisedRefs: request.advertisedRefs.length,
            fetchedRefs: 0,
            telemetryBytes: 0,
            productGraphFetched: false,
            callerRepositoryMutated: false,
            disposableStoreRemoved: true,
          },
        },
      }
    );
  }

  async resolveProductCommitInterval(
    request: CommitRangeRequest,
  ): Promise<ProductCommitIntervalResult> {
    this.calls.push({
      kind: 'interval',
      request: {
        repository: { ...request.repository },
        from: request.from,
        to: request.to,
        candidates: [...request.candidates],
      },
    });
    return (
      this.stateFor(request.repository.key).interval ?? {
        ok: true,
        membership: Object.fromEntries(request.candidates.map((candidate) => [candidate, false])),
        unavailable: [],
      }
    );
  }
}
