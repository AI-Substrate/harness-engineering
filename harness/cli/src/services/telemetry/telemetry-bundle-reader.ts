import type { BundleFsPort } from '../../adapters/fs/fs-port.js';
import type {
  RemoteRepository,
  RemoteTelemetryRefSnapshot,
} from '../../adapters/git/remote-telemetry-git-port.js';
import type { HashPort } from '../../adapters/hash/hash-port.js';
import {
  decodePublishedTelemetrySession,
  parseJsonWithoutDuplicateKeys,
} from './published-telemetry.js';
import { canonicalizeRemoteRepository } from './remote-input.js';
import {
  compareUnsignedUtf8,
  type ProductProvenance,
  parseTelemetryAdvertisement,
} from './remote-selection.js';
import type { TelemetryReportInput } from './report.js';
import {
  type BundleDataCoverageGap,
  type BundleSelectionGap,
  TELEMETRY_BUNDLE_SCHEMA_VERSION,
  type TelemetryBundleManifest,
} from './telemetry-bundle.js';

export type ReadTelemetryBundleResult =
  | {
      ok: true;
      inputs: TelemetryReportInput[];
      repositories: Array<{ key: string; identity: string }>;
      selection: TelemetryBundleManifest['selection'];
      source: string;
    }
  | { ok: false; reason: 'invalid_bundle' };

export interface TelemetryBundleReaderDeps {
  fs: Pick<BundleFsPort, 'readBytesNoFollow' | 'listRegularFilesNoFollow'>;
  hash: HashPort;
}

const MANAGED_BLOB = /^repositories\/(repo-[0-9a-f]{16})\/blobs\/([0-9a-f]{64})\.blob$/;
const FULL_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SAFE_SESSION = /^[A-Za-z0-9._-]{1,256}$/;
const SAFE_TREE_PATH =
  /^(?:manifest\.json|session\.(?:logs|metrics)\.jsonl|\d+\.(?:json|logs\.jsonl|metrics\.jsonl))$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHAPES = new Set([
  'canonical-pair',
  'pair-plus-fallback',
  'fallback-only',
  'legacy-history',
  'metrics-only',
  'identity-only',
]);
const SESSION_GAPS = new Set([
  'duplicate_session_identity',
  'date_provenance_unavailable',
  'commit_provenance_unavailable',
  'manifest_date_conflict',
]);
const COVERAGE_GAP_REASONS = new Set(['field_not_recorded', 'signal_unavailable', 'identity_only']);
const COVERAGE_FIELDS = new Set(['events', 'measurements']);

function rootOf(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.endsWith('/bundle.json')
    ? normalized.slice(0, -'/bundle.json'.length)
    : normalized;
}

function under(root: string, relative: string): string {
  return `${root.replace(/\/+$/, '')}/${relative}`;
}

function equalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key))
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function compareSelectionGaps(a: BundleSelectionGap, b: BundleSelectionGap): number {
  return (
    compareUnsignedUtf8(a.repository_key, b.repository_key) ||
    compareUnsignedUtf8(a.session_id ?? '', b.session_id ?? '') ||
    compareUnsignedUtf8(a.ref ?? '', b.ref ?? '') ||
    compareUnsignedUtf8(a.reason, b.reason)
  );
}

function orderedUniqueGaps(gaps: readonly BundleSelectionGap[]): boolean {
  const identities = gaps.map(
    (gap) => `${gap.repository_key}\0${gap.session_id ?? ''}\0${gap.ref ?? ''}\0${gap.reason}`,
  );
  return (
    new Set(identities).size === identities.length &&
    gaps.every((gap, index) => index === 0 || compareSelectionGaps(gaps[index - 1], gap) <= 0)
  );
}

function validSelection(value: unknown): value is TelemetryBundleManifest['selection'] {
  const selection = object(value);
  if (
    selection === null ||
    !exactKeys(selection, [
      'mode',
      'session_id',
      'from_date',
      'to_date',
      'from_commit',
      'to_commit',
      'completeness',
      'matched_repositories',
      'matched_sessions',
      'matched_refs',
      'gaps',
    ]) ||
    typeof selection.mode !== 'string' ||
    !['session', 'date', 'product-commit'].includes(selection.mode) ||
    typeof selection.completeness !== 'string' ||
    !['complete', 'partial'].includes(selection.completeness) ||
    !nonNegativeInteger(selection.matched_repositories) ||
    !nonNegativeInteger(selection.matched_sessions) ||
    !nonNegativeInteger(selection.matched_refs) ||
    !Array.isArray(selection.gaps)
  ) {
    return false;
  }
  if (selection.mode === 'session') {
    if (
      typeof selection.session_id !== 'string' ||
      selection.session_id.length === 0 ||
      !SAFE_SESSION.test(selection.session_id) ||
      selection.from_date !== null ||
      selection.to_date !== null ||
      selection.from_commit !== null ||
      selection.to_commit !== null
    ) {
      return false;
    }
  } else if (selection.mode === 'date') {
    if (
      selection.session_id !== null ||
      typeof selection.from_date !== 'string' ||
      typeof selection.to_date !== 'string' ||
      !validDate(selection.from_date) ||
      !validDate(selection.to_date) ||
      selection.from_date > selection.to_date ||
      selection.from_commit !== null ||
      selection.to_commit !== null
    ) {
      return false;
    }
  } else if (
    selection.session_id !== null ||
    selection.from_date !== null ||
    selection.to_date !== null ||
    typeof selection.from_commit !== 'string' ||
    typeof selection.to_commit !== 'string' ||
    !FULL_OID.test(selection.from_commit) ||
    !FULL_OID.test(selection.to_commit) ||
    selection.from_commit.length !== selection.to_commit.length
  ) {
    return false;
  }
  return (
    selection.gaps.every((gap) => validSelectionGap(gap)) &&
    orderedUniqueGaps(selection.gaps as BundleSelectionGap[])
  );
}

function validSelectionGap(value: unknown): value is BundleSelectionGap {
  const gap = object(value);
  return (
    gap !== null &&
    exactKeys(gap, ['repository_key', 'session_id', 'ref', 'reason']) &&
    typeof gap.repository_key === 'string' &&
    /^repo-[0-9a-f]{16}$/.test(gap.repository_key) &&
    (gap.session_id === null ||
      (typeof gap.session_id === 'string' && SAFE_SESSION.test(gap.session_id))) &&
    (gap.ref === null ||
      (typeof gap.ref === 'string' && gap.ref.startsWith('refs/harness-telemetry/'))) &&
    typeof gap.reason === 'string' &&
    SESSION_GAPS.has(gap.reason)
  );
}

function validCoverageGap(value: unknown): value is BundleDataCoverageGap {
  const gap = object(value);
  if (
    gap === null ||
    !exactKeys(gap, ['field', 'reason', 'refs']) ||
    typeof gap.field !== 'string' ||
    !COVERAGE_FIELDS.has(gap.field) ||
    typeof gap.reason !== 'string' ||
    !COVERAGE_GAP_REASONS.has(gap.reason) ||
    !Array.isArray(gap.refs)
  ) {
    return false;
  }
  const refs = gap.refs;
  return (
    refs.every((ref) => typeof ref === 'string' && ref.startsWith('refs/harness-telemetry/')) &&
    new Set(refs).size === refs.length &&
    [...refs].sort(compareUnsignedUtf8).every((ref, index) => ref === refs[index])
  );
}

function validCoverage(value: unknown): boolean {
  const coverage = object(value);
  return (
    coverage !== null &&
    exactKeys(coverage, ['events', 'measurements', 'gaps']) &&
    ['full', 'partial', 'unavailable'].includes(coverage.events as string) &&
    ['complete', 'partial', 'unavailable'].includes(coverage.measurements as string) &&
    Array.isArray(coverage.gaps) &&
    coverage.gaps.every(validCoverageGap) &&
    new Set(coverage.gaps.map((gap) => `${gap.field}\0${gap.reason}\0${gap.refs.join('\0')}`))
      .size === coverage.gaps.length
  );
}

function validProduct(value: unknown): boolean {
  const product = object(value);
  if (
    product === null ||
    !exactKeys(product, ['state', 'values']) ||
    !['known', 'partial', 'unavailable'].includes(product.state as string)
  ) {
    return false;
  }
  if (product.state === 'unavailable') return product.values === null;
  if (!Array.isArray(product.values)) return false;
  const values = product.values;
  return (
    values.length > 0 &&
    values.every((oid) => typeof oid === 'string' && FULL_OID.test(oid)) &&
    new Set(values).size === values.length &&
    [...values].sort(compareUnsignedUtf8).every((oid, index) => oid === values[index])
  );
}

function validRefDate(value: unknown, parsedDate: string | null): boolean {
  const date = object(value);
  if (date === null || !exactKeys(date, ['state', 'value'])) return false;
  return parsedDate === null
    ? date.state === 'unavailable' && date.value === null
    : date.state === 'known' && date.value === parsedDate;
}

function inferredShape(paths: readonly string[]): string {
  const set = new Set(paths);
  const pair = set.has('session.logs.jsonl') && set.has('session.metrics.jsonl');
  const loose = paths.some((path) => /^\d+\.json$/.test(path));
  if (pair && loose) return 'pair-plus-fallback';
  if (pair) return 'canonical-pair';
  if (loose && set.has('manifest.json')) return 'fallback-only';
  if (set.has('session.metrics.jsonl') && !set.has('session.logs.jsonl')) return 'metrics-only';
  if (paths.some((path) => /^\d+\.logs\.jsonl$/.test(path))) return 'legacy-history';
  return 'identity-only';
}

function aggregateProduct(
  values: Array<
    TelemetryBundleManifest['provenance']['repositories'][number]['sessions'][number]['refs'][number]['product_commits']
  >,
): ProductProvenance {
  const commits = [...new Set(values.flatMap((value) => value.values ?? []))].sort(
    compareUnsignedUtf8,
  );
  if (commits.length === 0) return { state: 'unavailable', commits: null };
  return values.every((value) => value.state === 'known')
    ? { state: 'known', commits }
    : { state: 'partial', commits };
}

function projectedCoverage(
  session: ReturnType<typeof decodePublishedTelemetrySession> & { ok: true },
): TelemetryBundleManifest['provenance']['repositories'][number]['sessions'][number]['coverage'] {
  const refs = session.session.refs.map((ref) => ref.name).sort(compareUnsignedUtf8);
  return {
    events:
      session.session.coverage.events.state === 'full'
        ? 'full'
        : session.session.coverage.events.state === 'observed'
          ? 'partial'
          : 'unavailable',
    measurements:
      session.session.coverage.measurements.state === 'complete'
        ? 'complete'
        : session.session.coverage.measurements.state === 'measured'
          ? 'partial'
          : 'unavailable',
    gaps: session.session.coverage.gaps
      .map(
        (gap): BundleDataCoverageGap => ({
          field: gap === 'events_unavailable' ? 'events' : 'measurements',
          reason:
            session.session.fidelity === 'identity-only' ? 'identity_only' : 'signal_unavailable',
          refs,
        }),
      )
      .sort(
        (a, b) => compareUnsignedUtf8(a.field, b.field) || compareUnsignedUtf8(a.reason, b.reason),
      ),
  };
}

type ValidAdvertisement = Extract<ReturnType<typeof parseTelemetryAdvertisement>, { ok: true }>;
interface DeclaredRefEvidence {
  advertisement: ValidAdvertisement;
  product: TelemetryBundleManifest['provenance']['repositories'][number]['sessions'][number]['refs'][number]['product_commits'];
}
interface DeclaredSessionEvidence {
  refs: Map<string, DeclaredRefEvidence>;
  decodedGaps: Set<string>;
}

/** Verify exact bytes/paths/hashes, then reconstruct repository-tagged report inputs. */
export function readTelemetryBundle(
  path: string,
  deps: TelemetryBundleReaderDeps,
): ReadTelemetryBundleResult {
  try {
    return readUnsafe(path, deps);
  } catch {
    return { ok: false, reason: 'invalid_bundle' };
  }
}

function readUnsafe(path: string, deps: TelemetryBundleReaderDeps): ReadTelemetryBundleResult {
  const root = rootOf(path);
  const bundleBytes = deps.fs.readBytesNoFollow(under(root, 'bundle.json'));
  if (bundleBytes === null) return { ok: false, reason: 'invalid_bundle' };
  let parsed: unknown;
  try {
    parsed = parseJsonWithoutDuplicateKeys(
      new TextDecoder('utf-8', { fatal: true }).decode(bundleBytes),
    );
  } catch {
    return { ok: false, reason: 'invalid_bundle' };
  }
  const top = object(parsed);
  const provenance = object(top?.provenance);
  const integrity = object(top?.integrity);
  if (
    top === null ||
    !exactKeys(top, ['schema_version', 'selection', 'provenance', 'integrity']) ||
    top.schema_version !== TELEMETRY_BUNDLE_SCHEMA_VERSION ||
    !validSelection(top.selection) ||
    provenance === null ||
    !exactKeys(provenance, ['repositories']) ||
    !Array.isArray(provenance.repositories) ||
    integrity === null ||
    !exactKeys(integrity, ['algorithm', 'blobs']) ||
    integrity.algorithm !== 'sha256' ||
    !Array.isArray(integrity.blobs)
  ) {
    return { ok: false, reason: 'invalid_bundle' };
  }
  const manifest = top as unknown as TelemetryBundleManifest;

  const bytesByPath = new Map<string, Uint8Array>();
  const integrityByPath = new Map<string, TelemetryBundleManifest['integrity']['blobs'][number]>();
  for (const unknownRow of manifest.integrity.blobs) {
    const row = object(unknownRow);
    const match = typeof row?.path === 'string' ? MANAGED_BLOB.exec(row.path) : null;
    if (
      row === null ||
      !exactKeys(row, ['repository_key', 'path', 'sha256', 'bytes']) ||
      match === null ||
      row.repository_key !== match[1] ||
      row.sha256 !== match[2] ||
      !nonNegativeInteger(row.bytes) ||
      integrityByPath.has(row.path as string)
    ) {
      return { ok: false, reason: 'invalid_bundle' };
    }
    const bytes = deps.fs.readBytesNoFollow(under(root, row.path as string));
    if (
      bytes === null ||
      bytes.byteLength !== row.bytes ||
      deps.hash.sha256Hex(bytes).toLowerCase() !== row.sha256
    ) {
      return { ok: false, reason: 'invalid_bundle' };
    }
    bytesByPath.set(row.path as string, bytes);
    integrityByPath.set(row.path as string, unknownRow);
  }
  const integrityPaths = [...integrityByPath.keys()].sort();
  const listed = deps.fs.listRegularFilesNoFollow(root);
  const expected = ['bundle.json', ...integrityPaths].sort();
  if (
    listed === null ||
    listed.length !== expected.length ||
    listed.some((entry, index) => entry !== expected[index])
  ) {
    return { ok: false, reason: 'invalid_bundle' };
  }

  const inputs: TelemetryReportInput[] = [];
  const repositories: Array<{ key: string; identity: string }> = [];
  const repositoryKeys = new Set<string>();
  const sessionEvidence = new Map<string, DeclaredSessionEvidence>();
  const referencedIntegrity = new Set<string>();
  let matchedRepositories = 0;
  let matchedSessions = 0;
  let matchedRefs = 0;
  for (const unknownRepository of manifest.provenance.repositories) {
    const repositoryRow = object(unknownRepository);
    if (
      repositoryRow === null ||
      !exactKeys(repositoryRow, [
        'key',
        'url',
        'advertised_ref_count',
        'selected_ref_count',
        'sessions',
      ]) ||
      typeof repositoryRow.key !== 'string' ||
      !/^repo-[0-9a-f]{16}$/.test(repositoryRow.key) ||
      repositoryKeys.has(repositoryRow.key) ||
      typeof repositoryRow.url !== 'string' ||
      canonicalizeRemoteRepository(repositoryRow.url) !== repositoryRow.url ||
      `repo-${deps.hash.sha256Hex(repositoryRow.url).slice(0, 16)}` !== repositoryRow.key ||
      !nonNegativeInteger(repositoryRow.advertised_ref_count) ||
      !nonNegativeInteger(repositoryRow.selected_ref_count) ||
      repositoryRow.selected_ref_count > repositoryRow.advertised_ref_count ||
      !Array.isArray(repositoryRow.sessions)
    ) {
      return { ok: false, reason: 'invalid_bundle' };
    }
    repositoryKeys.add(repositoryRow.key);
    repositories.push({ key: repositoryRow.key, identity: repositoryRow.url });
    const repository: RemoteRepository = {
      key: repositoryRow.key,
      identity: repositoryRow.url,
      transportUrl: repositoryRow.url,
    };
    const sessionIds = new Set<string>();
    let repositoryRefCount = 0;
    if (repositoryRow.sessions.length > 0) matchedRepositories++;
    for (const unknownSession of repositoryRow.sessions) {
      const sessionRow = object(unknownSession);
      if (
        sessionRow === null ||
        !exactKeys(sessionRow, ['session_id', 'fidelity', 'coverage', 'refs', 'gaps']) ||
        typeof sessionRow.session_id !== 'string' ||
        !SAFE_SESSION.test(sessionRow.session_id) ||
        sessionIds.has(sessionRow.session_id) ||
        !['full', 'partial', 'identity-only'].includes(sessionRow.fidelity as string) ||
        !validCoverage(sessionRow.coverage) ||
        !Array.isArray(sessionRow.refs) ||
        !Array.isArray(sessionRow.gaps) ||
        sessionRow.gaps.some((gap) => !validSelectionGap(gap)) ||
        new Set(
          sessionRow.gaps.map((gap) => {
            const row = gap as BundleSelectionGap;
            return `${row.repository_key}\0${row.session_id ?? ''}\0${row.ref ?? ''}\0${row.reason}`;
          }),
        ).size !== sessionRow.gaps.length
      ) {
        return { ok: false, reason: 'invalid_bundle' };
      }
      sessionIds.add(sessionRow.session_id);
      matchedSessions++;
      repositoryRefCount += sessionRow.refs.length;
      matchedRefs += sessionRow.refs.length;
      const refs: RemoteTelemetryRefSnapshot[] = [];
      const advertisements = [];
      const products: Array<
        TelemetryBundleManifest['provenance']['repositories'][number]['sessions'][number]['refs'][number]['product_commits']
      > = [];
      const manifestRefEvidence: Array<{
        name: string;
        shape: string;
        product: ProductProvenance;
      }> = [];
      const refNames = new Set<string>();
      const refEvidence = new Map<string, DeclaredRefEvidence>();
      for (const unknownRef of sessionRow.refs) {
        const refRow = object(unknownRef);
        if (
          refRow === null ||
          !exactKeys(refRow, [
            'name',
            'advertised_oid',
            'date',
            'shape',
            'product_commits',
            'commits',
          ]) ||
          typeof refRow.name !== 'string' ||
          typeof refRow.advertised_oid !== 'string' ||
          refNames.has(refRow.name) ||
          typeof refRow.shape !== 'string' ||
          !SHAPES.has(refRow.shape) ||
          !validProduct(refRow.product_commits) ||
          !Array.isArray(refRow.commits) ||
          refRow.commits.length === 0
        ) {
          return { ok: false, reason: 'invalid_bundle' };
        }
        refNames.add(refRow.name);
        const advertisement = parseTelemetryAdvertisement({
          name: refRow.name,
          oid: refRow.advertised_oid,
        });
        if (
          !advertisement.ok ||
          advertisement.value.sessionId !== sessionRow.session_id ||
          !validRefDate(refRow.date, advertisement.value.refDate)
        ) {
          return { ok: false, reason: 'invalid_bundle' };
        }
        advertisements.push(advertisement.value);
        const refProduct = refRow.product_commits as (typeof products)[number];
        refEvidence.set(refRow.name, { advertisement, product: refProduct });
        products.push(refProduct);
        manifestRefEvidence.push({
          name: refRow.name,
          shape: refRow.shape,
          product:
            refProduct.state === 'unavailable'
              ? { state: 'unavailable', commits: null }
              : { state: refProduct.state, commits: [...refProduct.values] },
        });
        const commitIds = new Set<string>();
        const history = refRow.commits.map((unknownCommit) => {
          const commit = object(unknownCommit);
          if (
            commit === null ||
            !exactKeys(commit, ['oid', 'tree']) ||
            typeof commit.oid !== 'string' ||
            !FULL_OID.test(commit.oid) ||
            commitIds.has(commit.oid) ||
            !Array.isArray(commit.tree)
          ) {
            throw new Error('invalid commit');
          }
          commitIds.add(commit.oid);
          const treeIdentities = new Set<string>();
          const entries = commit.tree.map((unknownEntry) => {
            const entry = object(unknownEntry);
            const integrityRow =
              typeof entry?.bundle_path === 'string'
                ? integrityByPath.get(entry.bundle_path)
                : undefined;
            if (
              entry === null ||
              !exactKeys(entry, [
                'logical_path',
                'git_blob_oid',
                'content_sha256',
                'bytes',
                'bundle_path',
              ]) ||
              typeof entry.logical_path !== 'string' ||
              !SAFE_TREE_PATH.test(entry.logical_path) ||
              typeof entry.git_blob_oid !== 'string' ||
              !FULL_OID.test(entry.git_blob_oid) ||
              typeof entry.content_sha256 !== 'string' ||
              typeof entry.bundle_path !== 'string' ||
              !nonNegativeInteger(entry.bytes) ||
              treeIdentities.has(`${entry.logical_path}\0${entry.git_blob_oid}`) ||
              integrityRow === undefined ||
              integrityRow.repository_key !== repository.key ||
              integrityRow.sha256 !== entry.content_sha256 ||
              integrityRow.bytes !== entry.bytes ||
              entry.bundle_path !==
                `repositories/${repository.key}/blobs/${entry.content_sha256}.blob`
            ) {
              throw new Error('invalid tree entry');
            }
            treeIdentities.add(`${entry.logical_path}\0${entry.git_blob_oid}`);
            referencedIntegrity.add(entry.bundle_path);
            return {
              path: entry.logical_path,
              mode: '100644',
              type: 'blob' as const,
              oid: entry.git_blob_oid,
              bytes: bytesByPath.get(entry.bundle_path) as Uint8Array,
            };
          });
          return { oid: commit.oid, parents: [], entries };
        });
        if (
          history[0]?.oid !== refRow.advertised_oid ||
          inferredShape(history.flatMap((commit) => commit.entries.map((entry) => entry.path))) !==
            refRow.shape
        ) {
          return { ok: false, reason: 'invalid_bundle' };
        }
        refs.push({ name: refRow.name, advertisedOid: refRow.advertised_oid, history });
      }
      const typedSessionGaps = sessionRow.gaps as BundleSelectionGap[];
      if (!orderedUniqueGaps(typedSessionGaps)) {
        return { ok: false, reason: 'invalid_bundle' };
      }
      const sessionGapReasons: BundleSelectionGap['reason'][] = [];
      for (const gap of typedSessionGaps) {
        if (
          gap.repository_key !== repository.key ||
          gap.session_id !== sessionRow.session_id ||
          (gap.ref !== null && !refNames.has(gap.ref)) ||
          (gap.reason !== 'duplicate_session_identity' &&
            gap.reason !== 'manifest_date_conflict') ||
          (gap.reason === 'duplicate_session_identity' &&
            (sessionRow.refs.length < 2 || gap.ref !== null)) ||
          (gap.reason === 'manifest_date_conflict' && gap.ref === null)
        ) {
          return { ok: false, reason: 'invalid_bundle' };
        }
        sessionGapReasons.push(gap.reason);
      }
      const declaredProduct = aggregateProduct(products);
      const decoded = decodePublishedTelemetrySession({
        group: {
          repository,
          sessionId: sessionRow.session_id,
          refs: advertisements,
          gaps: [],
          product: declaredProduct,
        },
        refs,
      });
      const decodedRefEvidence = decoded.ok
        ? decoded.session.refEvidence.map((evidence) => ({
            name: evidence.name,
            shape: evidence.shape,
            product:
              evidence.product.state === 'unavailable'
                ? { state: 'unavailable', commits: null }
                : {
                    state: evidence.product.state,
                    commits: [...evidence.product.commits].sort(compareUnsignedUtf8),
                  },
          }))
        : [];
      const expectedRefEvidence = manifestRefEvidence.map((evidence) => ({
        ...evidence,
        product:
          evidence.product.state === 'unavailable'
            ? evidence.product
            : {
                state: evidence.product.state,
                commits: [...evidence.product.commits].sort(compareUnsignedUtf8),
              },
      }));
      const derivedGapReasons = decoded.ok
        ? [
            ...(sessionRow.refs.length > 1 ? ['duplicate_session_identity' as const] : []),
            ...(decoded.session.gaps.includes('manifest_date_conflict')
              ? ['manifest_date_conflict' as const]
              : []),
          ].sort(compareUnsignedUtf8)
        : [];
      const graphGapRefs = new Set(
        manifest.selection.gaps.flatMap((gap) =>
          gap.repository_key === repository.key &&
          gap.session_id === sessionRow.session_id &&
          gap.reason === 'commit_provenance_unavailable' &&
          gap.ref !== null
            ? [gap.ref]
            : [],
        ),
      );
      const refEvidenceConsistent =
        decodedRefEvidence.length === expectedRefEvidence.length &&
        decodedRefEvidence.every((actual, index) => {
          const declared = expectedRefEvidence[index];
          if (
            declared === undefined ||
            actual.name !== declared.name ||
            actual.shape !== declared.shape
          ) {
            return false;
          }
          if (equalJson(actual.product, declared.product)) return true;
          return (
            graphGapRefs.has(declared.name) &&
            actual.product.state === 'known' &&
            declared.product.state === 'partial' &&
            equalJson(actual.product.commits, declared.product.commits)
          );
        });
      const productConsistent =
        decoded.ok &&
        (equalJson(decoded.session.product, declaredProduct) ||
          (graphGapRefs.size > 0 &&
            decoded.session.product.state === 'known' &&
            declaredProduct.state === 'partial' &&
            equalJson(decoded.session.product.commits, declaredProduct.commits)));
      if (
        !decoded.ok ||
        !equalJson([...new Set(sessionGapReasons)].sort(compareUnsignedUtf8), derivedGapReasons) ||
        decoded.session.fidelity !== sessionRow.fidelity ||
        !equalJson(projectedCoverage(decoded), sessionRow.coverage) ||
        !productConsistent ||
        !refEvidenceConsistent
      ) {
        return { ok: false, reason: 'invalid_bundle' };
      }
      sessionEvidence.set(`${repository.key}\0${sessionRow.session_id}`, {
        refs: refEvidence,
        decodedGaps: new Set(derivedGapReasons),
      });
      inputs.push({
        origin: 'bundle',
        kind: decoded.session.fidelity,
        repositoryKey: repository.key,
        repository: repository.identity,
        sessionId: decoded.session.sessionId,
        sessionExport: decoded.session.sessionExport,
        coverage: decoded.session.coverage,
        gaps: [...derivedGapReasons, ...decoded.session.coverage.gaps],
      });
    }
    if (repositoryRefCount !== repositoryRow.selected_ref_count) {
      return { ok: false, reason: 'invalid_bundle' };
    }
  }
  let unresolvedAvailabilityGaps = 0;
  const invalidSelectionGap = manifest.selection.gaps.some((gap) => {
    if (!repositoryKeys.has(gap.repository_key) || gap.session_id === null) return true;
    const selected = sessionEvidence.get(`${gap.repository_key}\0${gap.session_id}`);
    const parsedRef =
      gap.ref === null ? null : parseTelemetryAdvertisement({ name: gap.ref, oid: '0'.repeat(40) });
    if (parsedRef !== null && (!parsedRef.ok || parsedRef.value.sessionId !== gap.session_id)) {
      return true;
    }
    const selectedRef = gap.ref === null ? undefined : selected?.refs.get(gap.ref);
    if (selected !== undefined && gap.ref !== null && selectedRef === undefined) return true;
    if (gap.reason === 'date_provenance_unavailable') {
      unresolvedAvailabilityGaps++;
      return (
        manifest.selection.mode !== 'date' ||
        parsedRef === null ||
        !parsedRef.ok ||
        parsedRef.value.refDate !== null
      );
    }
    if (gap.reason === 'commit_provenance_unavailable') {
      unresolvedAvailabilityGaps++;
      return (
        manifest.selection.mode !== 'product-commit' ||
        parsedRef === null ||
        !parsedRef.ok ||
        (selectedRef !== undefined && selectedRef.product.state === 'known')
      );
    }
    if (gap.reason === 'duplicate_session_identity') {
      return selected === undefined || selected.refs.size < 2 || gap.ref !== null;
    }
    return (
      selected === undefined ||
      gap.ref === null ||
      selectedRef === undefined ||
      !selected.decodedGaps.has('manifest_date_conflict')
    );
  });
  const inconsistentCompleteness =
    (manifest.selection.completeness === 'complete' && unresolvedAvailabilityGaps > 0) ||
    (manifest.selection.completeness === 'partial' && unresolvedAvailabilityGaps === 0);
  if (
    manifest.selection.matched_repositories !== matchedRepositories ||
    manifest.selection.matched_sessions !== matchedSessions ||
    manifest.selection.matched_refs !== matchedRefs ||
    referencedIntegrity.size !== integrityByPath.size ||
    [...referencedIntegrity].some((value) => !integrityByPath.has(value)) ||
    invalidSelectionGap ||
    inconsistentCompleteness
  ) {
    return { ok: false, reason: 'invalid_bundle' };
  }
  return { ok: true, inputs, repositories, selection: manifest.selection, source: root };
}
