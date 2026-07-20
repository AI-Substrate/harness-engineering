import type { BundleFsPort } from '../../adapters/fs/fs-port.js';
import type {
  RemoteEffects,
  RemoteRepository,
  RemoteTelemetryFailure,
  RemoteTelemetryFailureKind,
  RemoteTelemetryGitPort,
  TelemetrySnapshot,
} from '../../adapters/git/remote-telemetry-git-port.js';
import type { HashPort } from '../../adapters/hash/hash-port.js';
import { publishTelemetryBundle } from './bundle-publisher.js';
import {
  decodePublishedTelemetrySession,
  type PublishedTelemetrySession,
} from './published-telemetry.js';
import type { RemoteSelector } from './remote-input.js';
import {
  groupTelemetryAdvertisements,
  parseTelemetryAdvertisement,
  type SelectableTelemetrySession,
  type SelectionResult,
  selectTelemetrySessionGroups,
  selectTelemetrySnapshotCandidates,
  type TelemetrySessionGroup,
} from './remote-selection.js';
import { buildTelemetryBundle, type TelemetryBundle } from './telemetry-bundle.js';

export interface RemoteTelemetryServiceDeps {
  git: RemoteTelemetryGitPort;
  fs: BundleFsPort;
  hash: HashPort;
}

export interface ListPublishedTelemetryRequest {
  repositories: RemoteRepository[];
  selector: RemoteSelector | null;
}

export interface PullPublishedTelemetryRequest {
  repositories: RemoteRepository[];
  selector: RemoteSelector;
  out: string;
}

export interface RemoteTelemetryListRow {
  repositoryKey: string;
  repository: string;
  sessionId: string;
  refCount: number;
  refs: Array<{ name: string; oid: string }>;
  date: string | null;
  shapes: PublishedTelemetrySession['shapes'];
  fidelity: PublishedTelemetrySession['fidelity'];
  coverage: PublishedTelemetrySession['coverage'];
  logicalBytes: number;
  product: PublishedTelemetrySession['product'];
  gaps: string[];
}

export interface RemoteServiceError {
  repositoryKey: string;
  kind: RemoteTelemetryFailureKind;
  message: string;
}

export interface AggregateRemoteEffects {
  repositoriesConsulted: number;
  refsAdvertised: number;
  refsFetched: number;
  telemetryBytes: number;
  productGraphFetched: boolean;
  callerRepositoryMutated: false;
  disposableStoresRemoved: boolean;
}

export type RemoteServiceFailure =
  | (RemoteTelemetryFailure & { ok: false })
  | { ok: false; kind: 'session_not_found' }
  | { ok: false; kind: 'bundle_conflict' }
  | { ok: false; kind: 'bundle_write' };

export type ListPublishedTelemetryResult =
  | {
      ok: true;
      status: 'ok' | 'degraded';
      rows: RemoteTelemetryListRow[];
      completeness: 'complete' | 'partial';
      gaps: SelectionResult['gaps'];
      errors: RemoteServiceError[];
      effects: AggregateRemoteEffects;
    }
  | RemoteServiceFailure;

export type PullPublishedTelemetryResult =
  | {
      ok: true;
      status: 'ok' | 'degraded';
      data: {
        repositories: number;
        sessions: number;
        refs: number;
        blobs: number;
        full: number;
        partial: number;
        identityOnly: number;
        completeness: 'complete' | 'partial';
        gaps: number;
        out: string;
        written: boolean;
        reused: boolean;
      };
      bundle: TelemetryBundle;
      effects: AggregateRemoteEffects;
    }
  | RemoteServiceFailure;

interface LoadedRepository {
  repository: RemoteRepository;
  advertisedRefs: number;
  snapshot: TelemetrySnapshot | null;
  sessions: PublishedTelemetrySession[];
  selectionGroups: SelectableTelemetrySession[];
  warnings: RemoteServiceError[];
}

function safeFailure(failure: RemoteTelemetryFailure): RemoteServiceError {
  return {
    repositoryKey: failure.repositoryKey,
    kind: failure.kind,
    message: failure.message,
  };
}

function identityOnlySession(group: TelemetrySessionGroup): PublishedTelemetrySession {
  return {
    repository: group.repository,
    sessionId: group.sessionId,
    fidelity: 'identity-only',
    coverage: {
      events: { state: 'unavailable', count: null },
      measurements: { state: 'unavailable', count: null },
      gaps: ['events_unavailable', 'measurements_unavailable'],
    },
    product: { state: 'unavailable', commits: null },
    shapes: ['identity-only'],
    gaps: [...group.gaps],
    refs: group.refs.map((ref) => ({
      name: ref.name,
      advertisedOid: ref.oid,
      history: [],
    })),
    refEvidence: group.refs.map((ref) => ({
      name: ref.name,
      shape: 'identity-only',
      product: { state: 'unavailable', commits: null },
    })),
    blobs: [],
    sessionExport: null,
  };
}

async function loadRepository(
  repository: RemoteRepository,
  selector: RemoteSelector | null,
  deps: RemoteTelemetryServiceDeps,
): Promise<LoadedRepository | RemoteTelemetryFailure> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const advertisement = await deps.git.advertiseTelemetryRefs(repository);
    if (!advertisement.ok) return advertisement;
    const warnings: RemoteServiceError[] = [];
    if (advertisement.malformedRefCount > 0) {
      warnings.push({
        repositoryKey: repository.key,
        kind: 'invalid_telemetry',
        message: 'one or more advertised telemetry refs were malformed',
      });
    }
    const grouped = groupTelemetryAdvertisements(
      advertisement.refs.map((ref) => ({ repository, ...ref })),
    );
    const candidateSelection = selectTelemetrySnapshotCandidates(grouped, selector);
    const candidateRefs = candidateSelection.candidates.flatMap((group) =>
      group.refs.map(({ name, oid }) => ({ name, oid })),
    );
    const baseSelectionGroups: SelectableTelemetrySession[] = grouped.map((group) => ({
      ...group,
      product: { state: 'unavailable', commits: null },
    }));

    if (candidateRefs.length === 0) {
      return {
        repository,
        advertisedRefs: advertisement.refs.length,
        snapshot: null,
        sessions: candidateSelection.unresolved.map(identityOnlySession),
        selectionGroups: baseSelectionGroups,
        warnings,
      };
    }

    const loaded = await deps.git.loadVerifiedTelemetrySnapshot({
      repository,
      advertisedRefs: advertisement.refs,
      candidateRefs,
    });
    if (!loaded.ok) {
      if (loaded.kind === 'namespace_moved' && attempt === 0) continue;
      return loaded;
    }

    const expectedNames = new Set(candidateRefs.map((ref) => ref.name));
    if (
      loaded.snapshot.refs.length !== expectedNames.size ||
      loaded.snapshot.refs.some((ref) => !expectedNames.has(ref.name))
    ) {
      return {
        ok: false,
        kind: 'invalid_telemetry',
        message: 'selected published telemetry snapshot was incomplete',
        repositoryKey: repository.key,
      };
    }

    const sessions: PublishedTelemetrySession[] =
      candidateSelection.unresolved.map(identityOnlySession);
    const products = new Map<string, PublishedTelemetrySession['product']>();
    for (const group of candidateSelection.candidates) {
      const selectable: SelectableTelemetrySession = {
        ...group,
        product: { state: 'unavailable', commits: null },
      };
      const refNames = new Set(group.refs.map((ref) => ref.name));
      const decoded = decodePublishedTelemetrySession({
        group: selectable,
        refs: loaded.snapshot.refs.filter((ref) => refNames.has(ref.name)),
      });
      if (!decoded.ok) {
        return {
          ok: false,
          kind: 'invalid_telemetry',
          message: 'selected published telemetry was malformed or unsafe',
          repositoryKey: repository.key,
        };
      }
      sessions.push(decoded.session);
      products.set(group.sessionId, decoded.session.product);
    }
    return {
      repository,
      advertisedRefs: advertisement.refs.length,
      snapshot: loaded.snapshot,
      sessions,
      selectionGroups: baseSelectionGroups.map((group) => ({
        ...group,
        product: products.get(group.sessionId) ?? group.product,
      })),
      warnings,
    };
  }
  return {
    ok: false,
    kind: 'namespace_moved',
    message: 'remote telemetry namespace moved twice',
    repositoryKey: repository.key,
  };
}

async function loadRepositories(
  repositories: readonly RemoteRepository[],
  selector: RemoteSelector | null,
  deps: RemoteTelemetryServiceDeps,
): Promise<{ loaded: LoadedRepository[]; failures: RemoteTelemetryFailure[] }> {
  const loaded: LoadedRepository[] = [];
  const failures: RemoteTelemetryFailure[] = [];
  for (const repository of repositories) {
    const result = await loadRepository(repository, selector, deps);
    if ('ok' in result && result.ok === false) failures.push(result);
    else loaded.push(result as LoadedRepository);
  }
  return { loaded, failures };
}

async function resolveCommitSelection(
  loaded: LoadedRepository[],
  selector: Extract<RemoteSelector, { kind: 'commit' }>,
  deps: RemoteTelemetryServiceDeps,
): Promise<RemoteTelemetryFailure[]> {
  const failures: RemoteTelemetryFailure[] = [];
  for (const repository of loaded) {
    const candidates = [
      ...new Set(repository.selectionGroups.flatMap((group) => group.product.commits ?? [])),
    ];
    const result = await deps.git.resolveProductCommitInterval({
      repository: repository.repository,
      from: selector.from,
      to: selector.to,
      candidates,
    });
    if (!result.ok) {
      failures.push(result);
      continue;
    }
    const unavailable = new Set(result.unavailable);
    for (const oid of unavailable) delete result.membership[oid];
    for (const group of repository.selectionGroups) {
      const commits = group.product.commits ?? [];
      if (commits.some((commit) => unavailable.has(commit))) {
        group.product = { state: 'partial', commits };
        const session = repository.sessions.find(
          (candidate) => candidate.sessionId === group.sessionId,
        );
        if (session !== undefined) {
          session.product = { state: 'partial', commits: [...commits] };
          // Selection preserves the whole logical session. A graph-unavailable
          // candidate therefore degrades every ref-level claim participating in
          // that group; the bundle's per-ref gaps make the projection explicit.
          session.refEvidence = session.refEvidence.map((evidence) =>
            evidence.product.state === 'known'
              ? {
                  ...evidence,
                  product: { state: 'partial', commits: [...evidence.product.commits] },
                }
              : evidence,
          );
        }
      }
    }
    for (const group of repository.selectionGroups) {
      (group as SelectableTelemetrySession & { membership?: Record<string, boolean> }).membership =
        result.membership;
    }
  }
  return failures;
}

function selectionFor(
  loaded: readonly LoadedRepository[],
  selector: RemoteSelector | null,
): SelectionResult {
  const membership: Record<string, Record<string, boolean>> = {};
  for (const repository of loaded) {
    const repositoryMembership: Record<string, boolean> = {};
    for (const group of repository.selectionGroups) {
      Object.assign(
        repositoryMembership,
        (group as SelectableTelemetrySession & { membership?: Record<string, boolean> }).membership,
      );
    }
    membership[repository.repository.key] = repositoryMembership;
  }
  return selectTelemetrySessionGroups(
    loaded.flatMap((repository) => repository.selectionGroups),
    selector,
    membership,
  );
}

function sessionKey(repositoryKey: string, sessionId: string): string {
  return `${repositoryKey}\u0000${sessionId}`;
}

function selectedSessions(
  loaded: readonly LoadedRepository[],
  selection: SelectionResult,
): PublishedTelemetrySession[] {
  const selected = new Set(
    selection.selected.map((group) => sessionKey(group.repository.key, group.sessionId)),
  );
  return loaded.flatMap((repository) =>
    repository.sessions.filter((session) =>
      selected.has(sessionKey(session.repository.key, session.sessionId)),
    ),
  );
}

function visibleSessions(
  loaded: readonly LoadedRepository[],
  selection: SelectionResult,
): PublishedTelemetrySession[] {
  const visible = new Set(
    [...selection.selected, ...selection.unresolved].map((group) =>
      sessionKey(group.repository.key, group.sessionId),
    ),
  );
  return loaded.flatMap((repository) =>
    repository.sessions.filter((session) =>
      visible.has(sessionKey(session.repository.key, session.sessionId)),
    ),
  );
}

function row(session: PublishedTelemetrySession): RemoteTelemetryListRow {
  const parsedRefs = session.refs.map((ref) =>
    parseTelemetryAdvertisement({ name: ref.name, oid: ref.advertisedOid }),
  );
  const dates = parsedRefs.flatMap((parsed) =>
    parsed.ok && parsed.value.refDate !== null ? [parsed.value.refDate] : [],
  );
  const dateUnavailable = parsedRefs.some((parsed) => !parsed.ok || parsed.value.refDate === null);
  const gaps = [...session.gaps, ...session.coverage.gaps];
  if (dateUnavailable && !gaps.includes('date_provenance_unavailable')) {
    gaps.push('date_provenance_unavailable');
  }
  return {
    repositoryKey: session.repository.key,
    repository: session.repository.identity,
    sessionId: session.sessionId,
    refCount: session.refs.length,
    refs: session.refs.map((ref) => ({ name: ref.name, oid: ref.advertisedOid })),
    date: dates.length > 0 ? (dates.sort()[0] ?? null) : null,
    shapes: session.shapes,
    fidelity: session.fidelity,
    coverage: session.coverage,
    logicalBytes: session.blobs.reduce((sum, blob) => sum + blob.bytes.byteLength, 0),
    product: session.product,
    gaps,
  };
}

function effects(
  repositoriesConsulted: number,
  loaded: readonly LoadedRepository[],
  productGraphFetched: boolean,
): AggregateRemoteEffects {
  const snapshots = loaded.flatMap((repository) =>
    repository.snapshot === null ? [] : [repository.snapshot.effects],
  );
  return {
    repositoriesConsulted,
    refsAdvertised: loaded.reduce((sum, repository) => sum + repository.advertisedRefs, 0),
    refsFetched: snapshots.reduce((sum, value) => sum + value.fetchedRefs, 0),
    telemetryBytes: snapshots.reduce((sum, value) => sum + value.telemetryBytes, 0),
    productGraphFetched,
    callerRepositoryMutated: false,
    disposableStoresRemoved: snapshots.every(
      (value: RemoteEffects) => value.disposableStoreRemoved,
    ),
  };
}

export async function listPublishedTelemetry(
  request: ListPublishedTelemetryRequest,
  deps: RemoteTelemetryServiceDeps,
): Promise<ListPublishedTelemetryResult> {
  const state = await loadRepositories(request.repositories, request.selector, deps);
  if (state.loaded.length === 0 && state.failures.length > 0)
    return state.failures[0] as RemoteTelemetryFailure;
  if (request.selector?.kind === 'commit') {
    state.failures.push(...(await resolveCommitSelection(state.loaded, request.selector, deps)));
    if (state.loaded.length === 0 && state.failures.length > 0)
      return state.failures[0] as RemoteTelemetryFailure;
  }
  const failedKeys = new Set(state.failures.map((failure) => failure.repositoryKey));
  const successful = state.loaded.filter(
    (repository) => !failedKeys.has(repository.repository.key),
  );
  if (successful.length === 0 && state.failures.length > 0)
    return state.failures[0] as RemoteTelemetryFailure;
  const selection = selectionFor(successful, request.selector);
  const visible = visibleSessions(successful, selection);
  const errors = [
    ...state.failures.map(safeFailure),
    ...successful.flatMap((repository) => repository.warnings),
  ];
  const rows = visible.map(row);
  const degraded =
    errors.length > 0 ||
    selection.completeness === 'partial' ||
    selection.gaps.length > 0 ||
    rows.some((item) => item.fidelity !== 'full' || item.gaps.length > 0);
  return {
    ok: true,
    status: degraded ? 'degraded' : 'ok',
    rows,
    completeness: selection.completeness,
    gaps: selection.gaps,
    errors,
    effects: effects(request.repositories.length, successful, request.selector?.kind === 'commit'),
  };
}

export async function pullPublishedTelemetry(
  request: PullPublishedTelemetryRequest,
  deps: RemoteTelemetryServiceDeps,
): Promise<PullPublishedTelemetryResult> {
  const state = await loadRepositories(request.repositories, request.selector, deps);
  if (state.failures.length > 0) return state.failures[0] as RemoteTelemetryFailure;
  if (state.loaded.some((repository) => repository.warnings.length > 0)) {
    return {
      ok: false,
      kind: 'invalid_telemetry',
      message: 'one or more advertised telemetry refs were malformed',
      repositoryKey:
        state.loaded.find((repository) => repository.warnings.length > 0)?.repository.key ?? '',
    };
  }
  if (request.selector.kind === 'commit') {
    const failures = await resolveCommitSelection(state.loaded, request.selector, deps);
    if (failures.length > 0) return failures[0] as RemoteTelemetryFailure;
  }
  const selection = selectionFor(state.loaded, request.selector);
  const sessions = selectedSessions(state.loaded, selection);
  if (request.selector.kind === 'session' && sessions.length === 0) {
    return { ok: false, kind: 'session_not_found' };
  }
  let bundle: TelemetryBundle;
  try {
    bundle = buildTelemetryBundle(
      {
        selector: request.selector,
        completeness: selection.completeness,
        selectionGaps: selection.gaps,
        sessions,
        repositorySnapshots: state.loaded.map((repository) => ({
          key: repository.repository.key,
          identity: repository.repository.identity,
          advertisedRefs: repository.advertisedRefs,
          selectedRefs: sessions
            .filter((session) => session.repository.key === repository.repository.key)
            .reduce((sum, session) => sum + session.refs.length, 0),
        })),
      },
      deps.hash,
    );
  } catch {
    return {
      ok: false,
      kind: 'invalid_telemetry',
      message: 'selected telemetry could not form a consistent bundle',
      repositoryKey: state.loaded[0]?.repository.key ?? '',
    };
  }
  const published = publishTelemetryBundle(bundle, request.out, deps);
  if (!published.ok) {
    return {
      ok: false,
      kind: published.kind === 'target_conflict' ? 'bundle_conflict' : 'bundle_write',
    };
  }
  const status =
    selection.completeness === 'partial' ||
    selection.gaps.length > 0 ||
    sessions.some((session) => session.fidelity !== 'full' || session.gaps.length > 0)
      ? 'degraded'
      : 'ok';
  return {
    ok: true,
    status,
    data: {
      repositories: state.loaded.length,
      sessions: sessions.length,
      refs: sessions.reduce((sum, session) => sum + session.refs.length, 0),
      blobs: bundle.manifest.integrity.blobs.length,
      full: sessions.filter((session) => session.fidelity === 'full').length,
      partial: sessions.filter((session) => session.fidelity === 'partial').length,
      identityOnly: sessions.filter((session) => session.fidelity === 'identity-only').length,
      completeness: selection.completeness,
      gaps: selection.gaps.length + sessions.reduce((sum, session) => sum + session.gaps.length, 0),
      out: request.out,
      written: published.written,
      reused: published.reused,
    },
    bundle,
    effects: effects(request.repositories.length, state.loaded, request.selector.kind === 'commit'),
  };
}
