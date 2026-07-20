import { spawn } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AdvertisedTelemetryRef,
  CommitRangeRequest,
  ProductCommitIntervalResult,
  RemoteAdvertisementResult,
  RemoteRepository,
  RemoteTelemetryBlob,
  RemoteTelemetryCommit,
  RemoteTelemetryFailure,
  RemoteTelemetryGitPort,
  SnapshotRequest,
  TelemetrySnapshotResult,
} from './remote-telemetry-git-port.js';

const FULL_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const TELEMETRY_NAMESPACE = 'refs/harness-telemetry/*';
const SAFE_TELEMETRY_PATH =
  /^(?:manifest\.json|session\.(?:logs|metrics)\.jsonl|\d+\.(?:json|logs\.jsonl|metrics\.jsonl))$/;
const CREDENTIAL_QUERY_REGEX = '^credential(\\..+)?\\.(helper|username|usehttppath)$';
const CREDENTIAL_PREPARATION_TIMEOUT_MS = 30_000;
const CREDENTIAL_DISCOVERY_OUTPUT_BYTES = 65_536;
const CREDENTIAL_ENTRY_COUNT = 64;
const CREDENTIAL_TOTAL_BYTES = 65_536;
const CREDENTIAL_KEY_BYTES = 2_048;
const CREDENTIAL_URL_SUBSECTION_BYTES = 2_000;
const CREDENTIAL_HELPER_BYTES = 8_192;
const CREDENTIAL_USERNAME_BYTES = 1_024;
const CREDENTIAL_TEMP_PREFIX = 'harness-git-credential-';
const CREDENTIAL_CONFIG_NAME = 'credentials.gitconfig';

const SAFE_INHERITED_ENV = [
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'CURL_CA_BUNDLE',
] as const;

const SAFE_CREDENTIAL_CONFIG_ENV = [
  'PATH',
  'Path',
  'PATHEXT',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'XDG_CONFIG_HOME',
] as const;

function safeGitEnvironment(credentialConfigPath?: string): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const name of SAFE_INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined) inherited[name] = value;
  }
  return {
    ...inherited,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: credentialConfigPath ?? devNull,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PROTOCOL_FROM_USER: '0',
    GIT_ALLOW_PROTOCOL: 'https:ssh:git',
    ...(credentialConfigPath === undefined ? {} : { GCM_INTERACTIVE: 'never' }),
  };
}

function safeCredentialConfigEnvironment(materializing = false): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const name of SAFE_CREDENTIAL_CONFIG_ENV) {
    const value = process.env[name];
    if (value !== undefined) inherited[name] = value;
  }
  return {
    ...inherited,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    ...(materializing ? { GIT_CONFIG_GLOBAL: devNull } : {}),
  };
}

function inDisposableStore(store: string, args: readonly string[]): string[] {
  return [`--git-dir=${store}`, ...args];
}

export interface HttpsCredentialConfigQueryResult {
  readonly ok: boolean;
  readonly code: number | null;
  readonly stdout: Uint8Array;
  readonly stopped: 'timeout' | 'output_cap' | null;
}

export interface HttpsCredentialConfigLease {
  readonly ok: true;
  readonly configPath: string;
  readonly cleanup: () => void | Promise<void>;
}

export interface ExecRemoteTelemetryGitLimits {
  timeoutMs?: number;
  productTimeoutMs?: number;
  maxTelemetryObjectBytes?: number;
  maxProductObjectBytes?: number;
  maxCommandOutputBytes?: number;
  maxCandidates?: number;
  /** Test evidence hook: receives exact argv and the child environment. */
  onGitCommand?: (args: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => void;
  /** HTTPS-only parser seam for malformed/bounded query output proof. */
  credentialConfigQuery?: () => Promise<HttpsCredentialConfigQueryResult>;
  /** HTTPS-only operation-lease seam for lifecycle and shaped-path proof. */
  resolveHttpsCredentialConfig?: (
    repository: RemoteRepository,
  ) => Promise<HttpsCredentialConfigLease | RemoteTelemetryFailure>;
  /** Test evidence hook: allows a real namespace move immediately before verification. */
  beforePostFetchAdvertisement?: () => void | Promise<void>;
  /** Test evidence hook for safe cleanup-failure behavior. */
  removeStore?: (path: string) => void;
  /** Injectable disposable-store root/creator for creation-failure and shaped-path proof. */
  temporaryRoot?: string;
  createStore?: (prefix: string) => string;
  /** Monotonic operation clock used to enforce one total product deadline. */
  nowMs?: () => number;
  /** Injectable hooks path keeps Windows-shaped values observable as one argv element. */
  hooksPath?: (cwd: string) => string;
}

interface ResolvedLimits {
  timeoutMs: number;
  productTimeoutMs: number;
  maxTelemetryObjectBytes: number;
  maxProductObjectBytes: number;
  maxCommandOutputBytes: number;
  maxCandidates: number;
}

interface GitResult {
  ok: boolean;
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
  stopped: 'timeout' | 'object_cap' | 'output_cap' | null;
}

function failure(
  repositoryKey: string,
  kind: RemoteTelemetryFailure['kind'],
  message: string,
): RemoteTelemetryFailure {
  return { ok: false, kind, message, repositoryKey };
}

function directoryBytes(path: string): number {
  let total = 0;
  try {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      const stat = statSync(child, { throwIfNoEntry: false });
      if (stat === undefined) continue;
      if (stat.isDirectory()) total += directoryBytes(child);
      else if (stat.isFile()) total += stat.size;
    }
  } catch {
    return total;
  }
  return total;
}

function decodeUtf8(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasCredentialValueControl(value: string): boolean {
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

interface CredentialConfigEntry {
  readonly key: string;
  readonly value: string;
}

function validCredentialSubsection(value: string): boolean {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > CREDENTIAL_URL_SUBSECTION_BYTES ||
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    if (url.hostname.length === 0) return true;
    return (
      url.protocol.length > 1 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
  }
}

function parseCredentialConfig(bytes: Uint8Array): CredentialConfigEntry[] | null {
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength > CREDENTIAL_DISCOVERY_OUTPUT_BYTES) return null;
  if (buffer.byteLength === 0) return [];
  const entries: CredentialConfigEntry[] = [];
  let totalBytes = 0;
  let start = 0;
  while (start < buffer.byteLength) {
    const end = buffer.indexOf(0, start);
    if (end < 0 || end === start) return null;
    const record = decodeUtf8(buffer.subarray(start, end));
    if (record === null) return null;
    const separator = record.indexOf('\n');
    if (separator <= 0) return null;
    const key = record.slice(0, separator);
    const value = record.slice(separator + 1);
    if (hasControlCharacter(key) || hasControlCharacter(value)) return null;
    const keyBytes = Buffer.byteLength(key, 'utf8');
    const valueBytes = Buffer.byteLength(value, 'utf8');
    if (keyBytes > CREDENTIAL_KEY_BYTES) return null;

    let field: 'helper' | 'username' | 'usehttppath';
    if (/^credential\.(?:helper|username|usehttppath)$/.test(key)) {
      field = key.slice('credential.'.length) as typeof field;
    } else {
      const scoped = /^credential\.(.+)\.(helper|username|usehttppath)$/.exec(key);
      if (scoped === null || !validCredentialSubsection(scoped[1] as string)) return null;
      field = scoped[2] as typeof field;
    }
    if ((field === 'helper' || field === 'username') && hasCredentialValueControl(value)) {
      return null;
    }
    if (field === 'helper') {
      if (valueBytes > CREDENTIAL_HELPER_BYTES) return null;
    } else if (field === 'username') {
      if (value.length === 0 || valueBytes > CREDENTIAL_USERNAME_BYTES) return null;
    } else if (value !== 'true' && value !== 'false') {
      return null;
    }
    totalBytes += keyBytes + valueBytes;
    if (totalBytes > CREDENTIAL_TOTAL_BYTES || entries.length >= CREDENTIAL_ENTRY_COUNT)
      return null;
    entries.push({ key, value });
    start = end + 1;
  }
  return start === buffer.byteLength ? entries : null;
}

function unsignedText(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Real arbitrary-remote telemetry reader. Every network/object/process effect is
 * confined to a command-owned disposable bare repository; callers receive only
 * normalized evidence and safe typed failures.
 */
export class ExecRemoteTelemetryGit implements RemoteTelemetryGitPort {
  private readonly limits: ResolvedLimits;
  private readonly onGitCommand:
    | ((args: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => void)
    | undefined;
  private readonly credentialConfigQuery:
    | (() => Promise<HttpsCredentialConfigQueryResult>)
    | undefined;
  private readonly resolveHttpsCredentialConfigOverride:
    | ((
        repository: RemoteRepository,
      ) => Promise<HttpsCredentialConfigLease | RemoteTelemetryFailure>)
    | undefined;
  private readonly beforePostFetchAdvertisement: (() => void | Promise<void>) | undefined;
  private readonly removeStore: (path: string) => void;
  private readonly temporaryRoot: string;
  private readonly createStore: (prefix: string) => string;
  private readonly nowMs: () => number;
  private readonly hooksPath: (cwd: string) => string;

  constructor(limits: ExecRemoteTelemetryGitLimits = {}) {
    this.onGitCommand = limits.onGitCommand;
    this.credentialConfigQuery = limits.credentialConfigQuery;
    this.resolveHttpsCredentialConfigOverride = limits.resolveHttpsCredentialConfig;
    this.beforePostFetchAdvertisement = limits.beforePostFetchAdvertisement;
    this.removeStore =
      limits.removeStore ?? ((path) => rmSync(path, { recursive: true, force: true }));
    this.temporaryRoot = limits.temporaryRoot ?? tmpdir();
    this.createStore = limits.createStore ?? ((prefix) => mkdtempSync(prefix));
    this.nowMs = limits.nowMs ?? (() => Date.now());
    this.hooksPath = limits.hooksPath ?? ((cwd) => join(cwd, '.harness-no-hooks'));
    this.limits = {
      timeoutMs: limits.timeoutMs ?? 30_000,
      productTimeoutMs: limits.productTimeoutMs ?? 120_000,
      maxTelemetryObjectBytes: limits.maxTelemetryObjectBytes ?? 256 * 1024 * 1024,
      maxProductObjectBytes: limits.maxProductObjectBytes ?? 256 * 1024 * 1024,
      maxCommandOutputBytes: limits.maxCommandOutputBytes ?? 64 * 1024 * 1024,
      maxCandidates: limits.maxCandidates ?? 10_000,
    };
  }

  async advertiseTelemetryRefs(repository: RemoteRepository): Promise<RemoteAdvertisementResult> {
    return await this.withHttpsCredentialConfig(
      repository,
      async (credentialConfigPath) =>
        await this.advertiseTelemetryRefsWithConfig(repository, credentialConfigPath),
    );
  }

  private async advertiseTelemetryRefsWithConfig(
    repository: RemoteRepository,
    credentialConfigPath?: string,
  ): Promise<RemoteAdvertisementResult> {
    const result = await this.runGit(
      ['ls-remote', '--refs', repository.transportUrl, TELEMETRY_NAMESPACE],
      tmpdir(),
      this.limits.timeoutMs,
      undefined,
      undefined,
      credentialConfigPath,
    );
    if (!result.ok) {
      return failure(repository.key, 'transport', 'remote telemetry advertisement failed');
    }
    const text = decodeUtf8(result.stdout);
    if (text === null) {
      return failure(
        repository.key,
        'invalid_telemetry',
        'remote telemetry advertisement was invalid',
      );
    }

    const refs: AdvertisedTelemetryRef[] = [];
    let malformedRefCount = 0;
    const names = new Set<string>();
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      const tab = line.indexOf('\t');
      const oid = tab < 0 ? '' : line.slice(0, tab).toLowerCase();
      const name = tab < 0 ? '' : line.slice(tab + 1);
      if (
        !FULL_OID.test(oid) ||
        !name.startsWith('refs/harness-telemetry/') ||
        names.has(name) ||
        hasControlCharacter(name)
      ) {
        malformedRefCount++;
        continue;
      }
      names.add(name);
      refs.push({ name, oid });
    }
    refs.sort((a, b) => unsignedText(a.name, b.name) || unsignedText(a.oid, b.oid));
    return { ok: true, refs, malformedRefCount };
  }

  async loadVerifiedTelemetrySnapshot(request: SnapshotRequest): Promise<TelemetrySnapshotResult> {
    const advertised = new Map(request.advertisedRefs.map((ref) => [ref.name, ref.oid]));
    if (
      advertised.size !== request.advertisedRefs.length ||
      request.candidateRefs.some((ref) => advertised.get(ref.name) !== ref.oid)
    ) {
      return failure(
        request.repository.key,
        'invalid_telemetry',
        'telemetry snapshot candidates were invalid',
      );
    }
    return await this.withHttpsCredentialConfig(
      request.repository,
      async (credentialConfigPath) =>
        await this.snapshotAttempt(
          request.repository,
          request.advertisedRefs,
          request.candidateRefs,
          credentialConfigPath,
        ),
    );
  }

  async resolveProductCommitInterval(
    request: CommitRangeRequest,
  ): Promise<ProductCommitIntervalResult> {
    if (request.candidates.length > this.limits.maxCandidates) {
      return failure(
        request.repository.key,
        'invalid_telemetry',
        'published product provenance exceeds the supported candidate bound',
      );
    }
    if (!FULL_OID.test(request.from) || !FULL_OID.test(request.to)) {
      return failure(request.repository.key, 'endpoint_unknown', 'product endpoint is unavailable');
    }

    return await this.withHttpsCredentialConfig(
      request.repository,
      async (credentialConfigPath) =>
        await this.resolveProductCommitIntervalWithConfig(request, credentialConfigPath),
    );
  }

  private async resolveProductCommitIntervalWithConfig(
    request: CommitRangeRequest,
    credentialConfigPath?: string,
  ): Promise<ProductCommitIntervalResult> {
    const deadline = this.nowMs() + this.limits.productTimeoutMs;
    let store: string;
    try {
      store = this.createStore(join(this.temporaryRoot, 'harness-product-graph-'));
    } catch {
      return failure(request.repository.key, 'transport', 'product metadata store creation failed');
    }
    const runProductGit = async (
      args: readonly string[],
      commandLimitMs: number,
      objectRoot?: string,
      objectCap?: number,
    ): Promise<GitResult> => {
      const remainingMs = deadline - this.nowMs();
      if (remainingMs <= 0) {
        return {
          ok: false,
          code: null,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          stopped: 'timeout',
        };
      }
      return await this.runGit(
        inDisposableStore(store, args),
        store,
        Math.min(commandLimitMs, remainingMs),
        objectRoot,
        objectCap,
        args[0] === 'fetch' ? credentialConfigPath : undefined,
      );
    };
    return await this.withStoreCleanup(
      store,
      failure(request.repository.key, 'transport', 'product metadata cleanup failed'),
      async () => {
        const initialized = await this.runGit(
          ['init', '--bare', '-q'],
          store,
          Math.min(this.limits.timeoutMs, Math.max(0, deadline - this.nowMs())),
        );
        if (!initialized.ok) {
          return failure(request.repository.key, 'transport', 'product metadata store failed');
        }

        const fetchOid = async (oid: string): Promise<'ok' | 'missing' | 'transport'> => {
          const fetched = await runProductGit(
            [
              'fetch',
              '--no-tags',
              '--no-write-fetch-head',
              '--filter=tree:0',
              request.repository.transportUrl,
              oid,
            ],
            this.limits.productTimeoutMs,
            join(store, 'objects'),
            this.limits.maxProductObjectBytes,
          );
          if (fetched.stopped !== null) return 'transport';
          const stderr = fetched.stderr.toString('utf8').toLowerCase();
          if (
            /filtering not recognized|filtering not supported|does not support filter/.test(stderr)
          ) {
            return 'transport';
          }
          if (!fetched.ok) return 'missing';
          if (directoryBytes(join(store, 'objects')) > this.limits.maxProductObjectBytes) {
            return 'transport';
          }
          const exists = await runProductGit(
            ['cat-file', '-e', `${oid}^{commit}`],
            this.limits.timeoutMs,
          );
          if (exists.stopped !== null) return 'transport';
          return exists.ok ? 'ok' : 'missing';
        };

        for (const endpoint of [...new Set([request.from, request.to])]) {
          const fetched = await fetchOid(endpoint);
          if (fetched === 'transport') {
            return failure(
              request.repository.key,
              'transport',
              'metadata-only product graph unavailable',
            );
          }
          if (fetched !== 'ok') {
            return failure(
              request.repository.key,
              'endpoint_unknown',
              'product endpoint is unavailable',
            );
          }
        }

        const orderedCandidates = [
          ...new Set(request.candidates.map((oid) => oid.toLowerCase())),
        ].sort();
        const unavailable: string[] = [];
        for (const candidate of orderedCandidates) {
          if (!FULL_OID.test(candidate)) {
            unavailable.push(candidate);
            continue;
          }
          const fetched = await fetchOid(candidate);
          if (fetched === 'transport') {
            return failure(
              request.repository.key,
              'transport',
              'metadata-only product graph unavailable',
            );
          }
          if (fetched !== 'ok') unavailable.push(candidate);
        }

        const endpointRelation = await runProductGit(
          ['merge-base', '--is-ancestor', request.from, request.to],
          this.limits.timeoutMs,
        );
        if (endpointRelation.code === 1) {
          return failure(request.repository.key, 'range_diverged', 'product commit range diverged');
        }
        if (!endpointRelation.ok) {
          return failure(request.repository.key, 'transport', 'product commit graph query failed');
        }

        const unavailableSet = new Set(unavailable);
        const membership: Record<string, boolean> = {};
        for (const candidate of orderedCandidates) {
          if (unavailableSet.has(candidate)) continue;
          const fromRelation = await runProductGit(
            ['merge-base', '--is-ancestor', request.from, candidate],
            this.limits.timeoutMs,
          );
          const toRelation = await runProductGit(
            ['merge-base', '--is-ancestor', candidate, request.to],
            this.limits.timeoutMs,
          );
          if (fromRelation.stopped !== null || toRelation.stopped !== null) {
            return failure(
              request.repository.key,
              'transport',
              'product commit graph query timed out',
            );
          }
          if (
            ![0, 1].includes(fromRelation.code ?? -1) ||
            ![0, 1].includes(toRelation.code ?? -1)
          ) {
            unavailable.push(candidate);
            continue;
          }
          membership[candidate] = fromRelation.code === 0 && toRelation.code === 0;
        }
        unavailable.sort();
        return { ok: true, membership, unavailable };
      },
    );
  }

  private async snapshotAttempt(
    repository: RemoteRepository,
    advertisedRefs: readonly AdvertisedTelemetryRef[],
    candidateRefs: readonly AdvertisedTelemetryRef[],
    credentialConfigPath?: string,
  ): Promise<TelemetrySnapshotResult> {
    let store: string;
    try {
      store = this.createStore(join(this.temporaryRoot, 'harness-telemetry-snapshot-'));
    } catch {
      return failure(repository.key, 'transport', 'telemetry snapshot store creation failed');
    }
    return await this.withStoreCleanup(
      store,
      failure(repository.key, 'transport', 'telemetry snapshot cleanup failed'),
      async () => {
        const initialized = await this.runGit(
          ['init', '--bare', '-q'],
          store,
          this.limits.timeoutMs,
        );
        if (!initialized.ok) {
          return failure(repository.key, 'transport', 'telemetry snapshot store failed');
        }
        const localRefs = candidateRefs.map((_ref, index) => `refs/harness-pull/${index}`);
        const refspecs = candidateRefs.map((ref, index) => `+${ref.name}:${localRefs[index]}`);
        const fetched = await this.runGit(
          inDisposableStore(store, [
            'fetch',
            '--no-tags',
            '--force',
            '--no-write-fetch-head',
            repository.transportUrl,
            ...refspecs,
          ]),
          store,
          this.limits.timeoutMs,
          join(store, 'objects'),
          this.limits.maxTelemetryObjectBytes,
          credentialConfigPath,
        );
        if (
          !fetched.ok ||
          directoryBytes(join(store, 'objects')) > this.limits.maxTelemetryObjectBytes
        ) {
          return failure(repository.key, 'transport', 'remote telemetry fetch failed');
        }

        for (let index = 0; index < candidateRefs.length; index++) {
          const resolved = await this.runGit(
            inDisposableStore(store, ['rev-parse', '--verify', `${localRefs[index]}^{commit}`]),
            store,
            this.limits.timeoutMs,
          );
          const oid = decodeUtf8(resolved.stdout)?.trim().toLowerCase();
          if (!resolved.ok || oid !== candidateRefs[index]?.oid.toLowerCase()) {
            return failure(repository.key, 'namespace_moved', 'remote telemetry namespace moved');
          }
        }

        try {
          await this.beforePostFetchAdvertisement?.();
        } catch {
          return failure(repository.key, 'transport', 'telemetry snapshot verification failed');
        }
        const after = await this.advertiseTelemetryRefsWithConfig(repository, credentialConfigPath);
        if (!after.ok) return after;
        if (
          after.refs.length !== advertisedRefs.length ||
          after.refs.some(
            (ref, index) =>
              ref.name !== advertisedRefs[index]?.name || ref.oid !== advertisedRefs[index]?.oid,
          )
        ) {
          return failure(repository.key, 'namespace_moved', 'remote telemetry namespace moved');
        }

        const snapshots = [];
        let telemetryBytes = 0;
        for (let index = 0; index < candidateRefs.length; index++) {
          const history = await this.readHistory(store, localRefs[index] as string);
          if (history === null) {
            return failure(
              repository.key,
              'invalid_telemetry',
              'remote telemetry history is invalid',
            );
          }
          telemetryBytes += history.reduce(
            (commitSum, commit) =>
              commitSum +
              commit.entries.reduce((entrySum, entry) => entrySum + entry.bytes.byteLength, 0),
            0,
          );
          snapshots.push({
            name: candidateRefs[index]?.name as string,
            advertisedOid: candidateRefs[index]?.oid.toLowerCase() as string,
            history,
          });
        }
        return {
          ok: true,
          snapshot: {
            repository,
            refs: snapshots,
            effects: {
              advertisedRefs: advertisedRefs.length,
              fetchedRefs: candidateRefs.length,
              telemetryBytes,
              productGraphFetched: false,
              callerRepositoryMutated: false,
              disposableStoreRemoved: true,
            },
          },
        };
      },
    );
  }

  private async withHttpsCredentialConfig<T>(
    repository: RemoteRepository,
    operation: (credentialConfigPath?: string) => Promise<T>,
  ): Promise<T | RemoteTelemetryFailure> {
    if (!repository.identity.startsWith('https://')) return await operation(undefined);

    let resolved: HttpsCredentialConfigLease | RemoteTelemetryFailure;
    try {
      resolved =
        this.resolveHttpsCredentialConfigOverride === undefined
          ? await this.resolveHttpsCredentialConfig(repository)
          : await this.resolveHttpsCredentialConfigOverride(repository);
    } catch {
      return failure(repository.key, 'transport', 'HTTPS credential configuration failed');
    }
    if (!resolved.ok) return resolved;

    let value: T | RemoteTelemetryFailure;
    try {
      value = await operation(resolved.configPath);
    } catch {
      value = failure(repository.key, 'transport', 'HTTPS Git operation failed');
    }
    try {
      await resolved.cleanup();
    } catch {
      return failure(repository.key, 'transport', 'HTTPS credential cleanup failed');
    }
    return value;
  }

  private async resolveHttpsCredentialConfig(
    repository: RemoteRepository,
  ): Promise<HttpsCredentialConfigLease | RemoteTelemetryFailure> {
    const configurationFailure = (): RemoteTelemetryFailure =>
      failure(repository.key, 'transport', 'HTTPS credential configuration failed');
    const cleanupFailure = (): RemoteTelemetryFailure =>
      failure(repository.key, 'transport', 'HTTPS credential cleanup failed');
    const deadline = this.nowMs() + CREDENTIAL_PREPARATION_TIMEOUT_MS;
    let query: HttpsCredentialConfigQueryResult;
    try {
      if (this.credentialConfigQuery !== undefined) {
        query = await this.credentialConfigQuery();
      } else {
        const remainingMs = deadline - this.nowMs();
        if (remainingMs <= 0) return configurationFailure();
        const result = await this.runGitCommand(
          ['config', '--global', '--includes', '--null', '--get-regexp', CREDENTIAL_QUERY_REGEX],
          tmpdir(),
          remainingMs,
          safeCredentialConfigEnvironment(),
          CREDENTIAL_DISCOVERY_OUTPUT_BYTES,
        );
        query = {
          ok: result.ok,
          code: result.code,
          stdout: result.stdout,
          stopped:
            result.stopped === null
              ? null
              : result.stopped === 'timeout'
                ? 'timeout'
                : 'output_cap',
        };
      }
    } catch {
      return configurationFailure();
    }

    const queryBytes = Buffer.from(query.stdout);
    const noMatches = query.code === 1 && queryBytes.byteLength === 0 && query.stopped === null;
    if (
      queryBytes.byteLength > CREDENTIAL_DISCOVERY_OUTPUT_BYTES ||
      query.stopped !== null ||
      (!query.ok && !noMatches)
    ) {
      return configurationFailure();
    }
    const entries = parseCredentialConfig(queryBytes);
    if (entries === null || deadline - this.nowMs() <= 0) return configurationFailure();

    let directory: string | undefined;
    const removePartial = (): boolean => {
      if (directory === undefined) return true;
      try {
        rmSync(directory, { recursive: true, force: true });
        return true;
      } catch {
        return false;
      }
    };
    try {
      directory = mkdtempSync(join(this.temporaryRoot, CREDENTIAL_TEMP_PREFIX));
      if (process.platform !== 'win32') chmodSync(directory, 0o700);
      const configPath = join(directory, CREDENTIAL_CONFIG_NAME);
      const descriptor = openSync(configPath, 'wx', 0o600);
      closeSync(descriptor);
      for (const entry of entries) {
        const remainingMs = deadline - this.nowMs();
        if (remainingMs <= 0) {
          return removePartial() ? configurationFailure() : cleanupFailure();
        }
        const written = await this.runGitCommand(
          ['config', '--file', configPath, '--add', entry.key, entry.value],
          directory,
          remainingMs,
          safeCredentialConfigEnvironment(true),
          CREDENTIAL_DISCOVERY_OUTPUT_BYTES,
        );
        if (!written.ok) return removePartial() ? configurationFailure() : cleanupFailure();
      }
      return {
        ok: true,
        configPath,
        cleanup: () => rmSync(directory as string, { recursive: true, force: true }),
      };
    } catch {
      return removePartial() ? configurationFailure() : cleanupFailure();
    }
  }

  private async withStoreCleanup<T>(
    store: string,
    cleanupFailure: T,
    operation: () => Promise<T>,
  ): Promise<T> {
    let completed = false;
    let value: T | undefined;
    let operationError: unknown;
    try {
      value = await operation();
      completed = true;
    } catch (error) {
      operationError = error;
    }
    try {
      this.removeStore(store);
    } catch {
      return cleanupFailure;
    }
    if (!completed) throw operationError;
    return value as T;
  }

  private async readHistory(store: string, ref: string): Promise<RemoteTelemetryCommit[] | null> {
    const listed = await this.runGit(
      inDisposableStore(store, ['rev-list', '--parents', ref]),
      store,
      this.limits.timeoutMs,
    );
    const text = decodeUtf8(listed.stdout);
    if (!listed.ok || text === null) return null;
    const parents = new Map<string, string[]>();
    for (const line of text.split('\n')) {
      if (line.length === 0) continue;
      const [oid, ...parentOids] = line.split(' ');
      if (
        oid === undefined ||
        !FULL_OID.test(oid) ||
        parentOids.some((parent) => !FULL_OID.test(parent))
      ) {
        return null;
      }
      parents.set(oid, parentOids);
    }

    const ordered = this.childBeforeParent(parents);
    if (ordered === null) return null;
    const commits: RemoteTelemetryCommit[] = [];
    for (const oid of ordered) {
      const tree = await this.readTree(store, oid);
      if (tree === null) return null;
      commits.push({ oid, parents: parents.get(oid) ?? [], entries: tree });
    }
    return commits;
  }

  private childBeforeParent(parents: ReadonlyMap<string, readonly string[]>): string[] | null {
    const childCounts = new Map<string, number>([...parents.keys()].map((oid) => [oid, 0]));
    for (const parentOids of parents.values()) {
      for (const parent of parentOids) {
        if (childCounts.has(parent)) childCounts.set(parent, (childCounts.get(parent) ?? 0) + 1);
      }
    }
    const eligible = [...childCounts.entries()]
      .filter(([, count]) => count === 0)
      .map(([oid]) => oid)
      .sort();
    const out: string[] = [];
    while (eligible.length > 0) {
      const oid = eligible.shift() as string;
      out.push(oid);
      for (const parent of parents.get(oid) ?? []) {
        if (!childCounts.has(parent)) continue;
        const remaining = (childCounts.get(parent) ?? 0) - 1;
        childCounts.set(parent, remaining);
        if (remaining === 0) {
          eligible.push(parent);
          eligible.sort();
        }
      }
    }
    return out.length === parents.size ? out : null;
  }

  private async readTree(store: string, commit: string): Promise<RemoteTelemetryBlob[] | null> {
    const listed = await this.runGit(
      inDisposableStore(store, ['ls-tree', '-rz', '--full-tree', commit]),
      store,
      this.limits.timeoutMs,
    );
    if (!listed.ok) return null;
    const entries: RemoteTelemetryBlob[] = [];
    for (const raw of listed.stdout
      .subarray(0, listed.stdout.length)
      .toString('binary')
      .split('\0')) {
      if (raw.length === 0) continue;
      const bytes = Buffer.from(raw, 'binary');
      const text = decodeUtf8(bytes);
      if (text === null) return null;
      const match = /^(\d+) ([^ ]+) ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/.exec(text);
      if (match === null) return null;
      const [, mode, type, oid, path] = match;
      if (mode !== '100644' || type !== 'blob' || !SAFE_TELEMETRY_PATH.test(path as string)) {
        return null;
      }
      const content = await this.runGit(
        inDisposableStore(store, ['cat-file', 'blob', oid as string]),
        store,
        this.limits.timeoutMs,
      );
      if (!content.ok) return null;
      entries.push({
        path: path as string,
        mode,
        type: 'blob',
        oid: oid as string,
        bytes: new Uint8Array(content.stdout),
      });
    }
    entries.sort(
      (a, b) =>
        unsignedText(a.path, b.path) ||
        unsignedText(a.mode, b.mode) ||
        unsignedText(a.type, b.type) ||
        unsignedText(a.oid, b.oid),
    );
    return entries;
  }

  private async runGit(
    args: readonly string[],
    cwd: string,
    timeoutMs: number,
    objectRoot?: string,
    objectCap?: number,
    credentialConfigPath?: string,
  ): Promise<GitResult> {
    const command = [
      '-c',
      `core.hooksPath=${this.hooksPath(cwd)}`,
      '-c',
      'protocol.version=2',
      ...(credentialConfigPath === undefined ? [] : ['-c', 'credential.interactive=false']),
      ...args,
    ];
    return await this.runGitCommand(
      command,
      cwd,
      timeoutMs,
      safeGitEnvironment(credentialConfigPath),
      this.limits.maxCommandOutputBytes,
      objectRoot,
      objectCap,
    );
  }

  private async runGitCommand(
    command: readonly string[],
    cwd: string,
    timeoutMs: number,
    env: Readonly<NodeJS.ProcessEnv>,
    maxOutputBytes: number,
    objectRoot?: string,
    objectCap?: number,
  ): Promise<GitResult> {
    return await new Promise((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        this.onGitCommand?.(command, env);
        child = spawn('git', command, {
          cwd,
          shell: false,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        resolve({
          ok: false,
          code: null,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
          stopped: null,
        });
        return;
      }
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let stopped: GitResult['stopped'] = null;
      const stop = (reason: NonNullable<GitResult['stopped']>): void => {
        if (stopped !== null) return;
        stopped = reason;
        child.kill('SIGKILL');
      };
      const collect =
        (target: Buffer[]) =>
        (chunk: Buffer): void => {
          outputBytes += chunk.length;
          if (outputBytes > maxOutputBytes) {
            stop('output_cap');
            return;
          }
          target.push(Buffer.from(chunk));
        };
      child.stdout?.on('data', collect(stdout));
      child.stderr?.on('data', collect(stderr));
      const timeout = setTimeout(() => stop('timeout'), Math.max(0, timeoutMs));
      const monitor =
        objectRoot !== undefined && objectCap !== undefined
          ? setInterval(() => {
              if (directoryBytes(objectRoot) > objectCap) stop('object_cap');
            }, 20)
          : null;
      child.once('error', () => {
        clearTimeout(timeout);
        if (monitor !== null) clearInterval(monitor);
        resolve({
          ok: false,
          code: null,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
          stopped,
        });
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (monitor !== null) clearInterval(monitor);
        if (
          objectRoot !== undefined &&
          objectCap !== undefined &&
          directoryBytes(objectRoot) > objectCap
        ) {
          stopped ??= 'object_cap';
        }
        resolve({
          ok: code === 0 && stopped === null,
          code,
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr),
          stopped,
        });
      });
    });
  }
}
