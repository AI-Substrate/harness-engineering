import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { ExecRemoteTelemetryGit } from '../../../src/adapters/git/exec-remote-telemetry-git.js';
import type { RemoteRepository } from '../../../src/adapters/git/remote-telemetry-git-port.js';
import { FakeHash } from '../../../src/adapters/hash/fake-hash.js';
import { listPublishedTelemetry } from '../../../src/services/telemetry/remote-telemetry-service.js';

const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') return reject(new Error('no port'));
      server.close(() => resolve(address.port));
    });
  });
}

interface GitProbeEvidence {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

const READINESS_EVIDENCE_BYTES = 4_096;

function appendBounded(current: string, chunk: string): string {
  return `${current}${chunk}`.slice(-READINESS_EVIDENCE_BYTES);
}

function safeReadinessEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    LC_ALL: 'C',
  };
}

async function runReadinessProbe(url: string): Promise<GitProbeEvidence> {
  return await new Promise((resolve) => {
    const child = spawn(
      'git',
      [
        '-c',
        'credential.interactive=false',
        'ls-remote',
        '--refs',
        url,
        'refs/harness-telemetry/*',
      ],
      {
        env: safeReadinessEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode, signal, stdout, stderr });
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once('error', (error) => {
      stderr = appendBounded(stderr, error.message);
      finish(null, null);
    });
    child.once('exit', finish);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 1_000);
  });
}

async function waitForDaemon(url: string, expectedRef: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let last: GitProbeEvidence | undefined;
  while (Date.now() < deadline) {
    last = await runReadinessProbe(url);
    const advertised = last.stdout.split('\n').some((line) => line.endsWith(`\t${expectedRef}`));
    if (last.exitCode === 0 && last.signal === null && advertised) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `git daemon protocol readiness failed (exit=${last?.exitCode ?? 'none'}; signal=${last?.signal ?? 'none'}; stderr=${last?.stderr ?? ''})`,
  );
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once('exit', onExit);
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(child.exitCode !== null || child.signalCode !== null);
    }, timeoutMs);
  });
}

interface DaemonStopEvidence {
  readonly generation: number;
  readonly url: string;
  readonly pid: number | undefined;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly sentSigterm: boolean;
  readonly sentSigkill: boolean;
}

interface ActiveDaemon {
  readonly generation: number;
  readonly url: string;
  readonly child: ChildProcess;
  stderr: string;
}

interface ActiveDaemonEvidence {
  readonly generation: number;
  readonly url: string;
  readonly pid: number | undefined;
  readonly running: boolean;
}

interface DaemonRestartEvidence {
  readonly stopped: DaemonStopEvidence;
  readonly replacement: ActiveDaemonEvidence;
}

function formatDaemonEvidence(evidence: DaemonStopEvidence): string {
  return JSON.stringify(evidence).slice(-READINESS_EVIDENCE_BYTES);
}

class TestGitDaemonManager {
  private active: ActiveDaemon | undefined;
  private currentRepository: RemoteRepository | undefined;
  private lastStopped: DaemonStopEvidence | undefined;
  private generation = 0;
  private lastPort: number | undefined;
  private completedRestarts = 0;

  constructor(
    private readonly root: string,
    private readonly expectedRef: string,
    private readonly publishRepository: (repository: RemoteRepository) => void,
  ) {}

  get repository(): RemoteRepository {
    if (this.currentRepository === undefined) throw new Error('git daemon is not ready');
    return this.currentRepository;
  }

  get activeEvidence(): ActiveDaemonEvidence {
    const active = this.active;
    if (active === undefined) throw new Error('git daemon has no active generation');
    return {
      generation: active.generation,
      url: active.url,
      pid: active.child.pid,
      running: active.child.exitCode === null && active.child.signalCode === null,
    };
  }

  get restartCount(): number {
    return this.completedRestarts;
  }

  private async nextPort(): Promise<number> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const port = await freePort();
      if (port !== this.lastPort) return port;
    }
    throw new Error('git daemon could not allocate a distinct replacement port');
  }

  async start(): Promise<void> {
    if (this.active !== undefined) throw new Error('git daemon already has an active generation');
    const port = await this.nextPort();
    this.lastPort = port;
    const generation = ++this.generation;
    const url = `git://127.0.0.1:${port}/remote.git`;
    const child = spawn(
      'git',
      [
        'daemon',
        '--reuseaddr',
        '--export-all',
        `--base-path=${this.root}`,
        '--listen=127.0.0.1',
        `--port=${port}`,
        this.root,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const active: ActiveDaemon = { generation, url, child, stderr: '' };
    this.active = active;
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      active.stderr = appendBounded(active.stderr, chunk);
    });
    child.once('error', (error) => {
      active.stderr = appendBounded(active.stderr, error.message);
    });
    try {
      await waitForDaemon(url, this.expectedRef);
    } catch (error) {
      const stopped = await this.stop();
      throw new Error(
        `git daemon generation ${generation} failed readiness: ${String(error)}; daemon=${formatDaemonEvidence(stopped)}`,
      );
    }
    const repository = { key: 'repo-real000000000', identity: url, transportUrl: url };
    this.currentRepository = repository;
    this.publishRepository(repository);
  }

  async stop(): Promise<DaemonStopEvidence> {
    const active = this.active;
    if (active === undefined) throw new Error('git daemon has no active generation to stop');
    let sentSigterm = false;
    let sentSigkill = false;
    if (active.child.exitCode === null && active.child.signalCode === null) {
      sentSigterm = active.child.kill('SIGTERM');
      if (!(await waitForExit(active.child, 2_000))) {
        sentSigkill = active.child.kill('SIGKILL');
        if (!(await waitForExit(active.child, 2_000))) {
          throw new Error(
            `git daemon did not exit after SIGKILL (generation=${active.generation}; stderr=${active.stderr})`,
          );
        }
      }
    }
    const evidence: DaemonStopEvidence = {
      generation: active.generation,
      url: active.url,
      pid: active.child.pid,
      exitCode: active.child.exitCode,
      signal: active.child.signalCode,
      stderr: active.stderr,
      sentSigterm,
      sentSigkill,
    };
    this.active = undefined;
    this.lastStopped = evidence;
    return evidence;
  }

  async restart(): Promise<DaemonRestartEvidence> {
    const stopped = await this.stop();
    try {
      await this.start();
    } catch (error) {
      throw new Error(
        `git daemon restart failed after ${formatDaemonEvidence(stopped)}: ${String(error)}`,
      );
    }
    this.completedRestarts += 1;
    return { stopped, replacement: this.activeEvidence };
  }

  async teardown(): Promise<DaemonStopEvidence> {
    let stopped = this.lastStopped;
    if (this.active !== undefined) stopped = await this.stop();
    if (stopped === undefined) throw new Error('git daemon has no lifecycle evidence for teardown');
    rmSync(this.root, { recursive: true, force: true });
    return stopped;
  }
}

interface TypedLoopbackResult {
  readonly ok: boolean;
  readonly kind?: string;
  readonly message?: string;
}

interface FixtureOperationEvent {
  readonly phase: 'failure' | 'recovery';
  readonly attempt: number;
  readonly line: string;
  readonly result: TypedLoopbackResult;
  readonly restart?: DaemonRestartEvidence;
}

class FixtureOperationRejected extends Error {
  constructor(
    message: string,
    readonly result: TypedLoopbackResult,
    readonly attempt: number,
  ) {
    super(message);
    this.name = 'FixtureOperationRejected';
  }
}

let fixtureRecoveryCount = 0;
const fixtureOperationAttempts = new Map<string, number>();

function formatResultEvidence(result: TypedLoopbackResult): string {
  return JSON.stringify({ ok: result.ok, kind: result.kind, message: result.message }).slice(
    -READINESS_EVIDENCE_BYTES,
  );
}

function tempFixtureRoots(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('harness-remote-git-'))
    .sort();
}

function assertFixtureState(
  label: string,
  storesBefore: readonly string[],
  fixtureRootsBefore: readonly string[],
  assertCallerStable: (() => void) | undefined,
): void {
  expect(tempStores(), `${label}: temporary-store inventory changed`).toEqual(storesBefore);
  expect(tempFixtureRoots(), `${label}: fixture-root inventory changed`).toEqual(
    fixtureRootsBefore,
  );
  assertCallerStable?.();
}

async function runSuccessfulFixtureOperation<T extends TypedLoopbackResult>(
  label: string,
  manager: TestGitDaemonManager,
  createAdapter: () => ExecRemoteTelemetryGit,
  operation: (adapter: ExecRemoteTelemetryGit, repository: RemoteRepository) => Promise<T>,
  assertCallerStable?: () => void,
  observe?: (event: FixtureOperationEvent) => void,
): Promise<T> {
  if (fixtureOperationAttempts.has(label)) {
    throw new Error(`fixture operation label was reused: ${label}`);
  }
  const storesBefore = tempStores();
  const fixtureRootsBefore = tempFixtureRoots();
  let firstTransport = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    fixtureOperationAttempts.set(label, attempt);
    const repository = manager.repository;
    if (!repository.transportUrl.startsWith('git://127.0.0.1:')) {
      throw new Error(`${label}: fixture recovery is limited to the loopback Git transport`);
    }
    let result: T;
    try {
      result = await operation(createAdapter(), repository);
    } catch (error) {
      assertFixtureState(label, storesBefore, fixtureRootsBefore, assertCallerStable);
      throw error;
    }
    assertFixtureState(label, storesBefore, fixtureRootsBefore, assertCallerStable);
    if (result.ok) return result;
    const resultEvidence = formatResultEvidence(result);
    const failureLine =
      `fixture_attempt_failure operation=${JSON.stringify(label)} attempt=${attempt} ` +
      `failure=${resultEvidence}`;
    console.info(failureLine);
    observe?.({ phase: 'failure', attempt, line: failureLine, result });
    if (result.kind !== 'transport') {
      throw new FixtureOperationRejected(
        `${label}: non-transport fixture result is not recoverable: ${resultEvidence}`,
        result,
        attempt,
      );
    }
    if (attempt === 2) {
      throw new FixtureOperationRejected(
        `${label}: second fixture transport is not recoverable: first=${firstTransport}; second=${resultEvidence}`,
        result,
        attempt,
      );
    }
    firstTransport = resultEvidence;
    const restart = await manager.restart();
    fixtureRecoveryCount += 1;
    const recoveryLine =
      `fixture_recovery operation=${JSON.stringify(label)} attempt=1 failure=${resultEvidence} ` +
      `daemon=${formatDaemonEvidence(restart.stopped)} replacement=${JSON.stringify(restart.replacement)}`;
    console.info(recoveryLine);
    observe?.({ phase: 'recovery', attempt, line: recoveryLine, result, restart });
  }
  throw new Error(`${label}: fixture operation exhausted its bounded attempts`);
}

function writeCommit(
  work: string,
  entries: Array<{ path: string; content: string }>,
  parents: readonly string[] = [],
): string {
  const treeInput = entries
    .map(({ path, content }) => {
      const object = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: work,
        input: content,
        encoding: 'utf8',
      }).trim();
      return `100644 blob ${object}\t${path}\n`;
    })
    .join('');
  const tree = execFileSync('git', ['mktree'], {
    cwd: work,
    input: treeInput,
    encoding: 'utf8',
  }).trim();
  return execFileSync(
    'git',
    ['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent])],
    {
      cwd: work,
      input: 'telemetry fixture\n',
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Harness',
        GIT_AUTHOR_EMAIL: 'h@example.invalid',
        GIT_COMMITTER_NAME: 'Harness',
        GIT_COMMITTER_EMAIL: 'h@example.invalid',
      },
    },
  ).trim();
}

function writeTelemetryCommit(
  work: string,
  session: string,
  marker: number,
  parents: readonly string[] = [],
): string {
  const segment = `${JSON.stringify({
    schema_version: '2.4',
    command: 'flow',
    harness: 'claude-code',
    harness_version: '0.12.0',
    harness_session_id: session,
    timecode: '2026-07-16T00:00:00.000Z',
    window: { since: 'session-start', from: 0, to: marker },
    branch: 'main',
    tokens: null,
    effort: null,
    event_stream: [],
    rollup: null,
  })}\n`;
  const file = join(work, `segment-${marker}.json`);
  writeFileSync(file, segment);
  return writeCommit(work, [{ path: `${marker}.json`, content: segment }], parents);
}

function tempStores(): string[] {
  return readdirSync(tmpdir())
    .filter(
      (name) =>
        name.startsWith('harness-telemetry-snapshot-') || name.startsWith('harness-product-graph-'),
    )
    .sort();
}

const FIXTURE_MANAGER_SYNTHETIC_FAULT = 'fixture-manager Dim0 synthetic fault';

function callerRepositoryState(cwd: string): Record<string, string> {
  return {
    head: git(cwd, ['rev-parse', 'HEAD']),
    index: git(cwd, ['write-tree']),
    status: git(cwd, ['status', '--porcelain=v1']),
    refs: git(cwd, ['for-each-ref', '--format=%(refname) %(objectname)']),
    objects: git(cwd, ['count-objects', '-v']),
    worktree: readFileSync(join(cwd, 'product.txt'), 'utf8'),
  };
}

describe('ExecRemoteTelemetryGit — real network-served Git', () => {
  let root: string;
  let work: string;
  let remote: string;
  let daemonManager: TestGitDaemonManager;
  let repository: RemoteRepository;
  let productStart: string;
  let productEnd: string;
  const session = 'session-real';
  const ref = `refs/harness-telemetry/2026/07/16/${session}`;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'harness-remote-git-'));
    work = join(root, 'work');
    remote = join(root, 'remote.git');
    mkdirSync(work);
    git(work, ['init', '-q']);
    git(work, ['config', 'user.name', 'Harness Test']);
    git(work, ['config', 'user.email', 'harness@example.invalid']);
    writeFileSync(join(work, 'product.txt'), 'one\n');
    git(work, ['add', 'product.txt']);
    git(work, ['commit', '-qm', 'product one']);
    productStart = git(work, ['rev-parse', 'HEAD']);
    writeFileSync(join(work, 'product.txt'), 'two\n');
    git(work, ['commit', '-qam', 'product two']);
    productEnd = git(work, ['rev-parse', 'HEAD']);

    git(root, ['init', '--bare', '-q', remote]);
    git(remote, ['config', 'uploadpack.allowFilter', 'true']);
    git(remote, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
    git(work, ['remote', 'add', 'origin-test', remote]);
    git(work, ['push', '-q', 'origin-test', `HEAD:refs/heads/main`]);
    git(work, ['tag', 'unrelated-product-tag']);
    git(work, ['push', '-q', 'origin-test', 'refs/tags/unrelated-product-tag']);
    git(work, ['update-ref', 'refs/private/unrelated', productEnd]);
    git(work, ['push', '-q', 'origin-test', 'refs/private/unrelated:refs/private/unrelated']);
    const telemetry = writeTelemetryCommit(work, session, 1);
    git(work, ['update-ref', ref, telemetry]);
    git(work, ['push', '-q', 'origin-test', `${ref}:${ref}`]);

    daemonManager = new TestGitDaemonManager(root, ref, (nextRepository) => {
      repository = nextRepository;
    });
    await daemonManager.start();
  }, 20_000);

  afterAll(async () => {
    const stopped = await daemonManager.teardown();
    console.info(
      `fixture_recoveries=${fixtureRecoveryCount} operations=${fixtureOperationAttempts.size} final_daemon=${formatDaemonEvidence(stopped)}`,
    );
  });

  it('first typed loopback transport recovers once, then real success', async () => {
    const label = `${FIXTURE_MANAGER_SYNTHETIC_FAULT}: first transport then real success`;
    const fault = {
      ok: false as const,
      kind: 'transport',
      message: `${FIXTURE_MANAGER_SYNTHETIC_FAULT}: injected first transport`,
    };
    const callerBefore = callerRepositoryState(work);
    const storesBefore = tempStores();
    const rootsBefore = tempFixtureRoots();
    const daemonBefore = daemonManager.activeEvidence;
    const restartBefore = daemonManager.restartCount;
    const recoveryBefore = fixtureRecoveryCount;
    const adapters: ExecRemoteTelemetryGit[] = [];
    const events: FixtureOperationEvent[] = [];
    let attempts = 0;
    let realSuccess = false;

    const loaded = await runSuccessfulFixtureOperation(
      label,
      daemonManager,
      () => {
        const adapter = new ExecRemoteTelemetryGit();
        adapters.push(adapter);
        return adapter;
      },
      async (adapter, currentRepository) => {
        attempts += 1;
        if (attempts === 1) return fault;
        const advertisement = await adapter.advertiseTelemetryRefs(currentRepository);
        if (!advertisement.ok) return advertisement;
        const result = await adapter.loadVerifiedTelemetrySnapshot({
          repository: currentRepository,
          advertisedRefs: advertisement.refs,
          candidateRefs: [advertisement.refs[0]],
        });
        realSuccess = result.ok;
        return result;
      },
      () => expect(callerRepositoryState(work)).toEqual(callerBefore),
      (event) => events.push(event),
    );

    const daemonAfter = daemonManager.activeEvidence;
    expect(loaded.ok).toBe(true);
    expect(realSuccess).toBe(true);
    expect(attempts).toBe(2);
    expect(fixtureOperationAttempts.get(label)).toBe(2);
    expect(adapters).toHaveLength(2);
    expect(adapters[0]).not.toBe(adapters[1]);
    expect(fixtureRecoveryCount - recoveryBefore).toBe(1);
    expect(daemonManager.restartCount - restartBefore).toBe(1);
    expect(events.map((event) => event.phase)).toEqual(['failure', 'recovery']);
    expect(events.every((event) => event.line.includes(FIXTURE_MANAGER_SYNTHETIC_FAULT))).toBe(
      true,
    );
    expect(events.filter((event) => event.phase === 'recovery')).toHaveLength(1);
    expect(events.every((event) => event.line.length <= READINESS_EVIDENCE_BYTES * 3)).toBe(true);
    const restart = events[1]?.restart;
    expect(restart?.stopped).toMatchObject({
      generation: daemonBefore.generation,
      url: daemonBefore.url,
      pid: daemonBefore.pid,
    });
    expect(restart?.stopped.sentSigterm).toBe(true);
    expect(restart?.stopped.exitCode !== null || restart?.stopped.signal !== null).toBe(true);
    expect(restart?.replacement).toEqual(daemonAfter);
    expect(daemonAfter).toMatchObject({ generation: daemonBefore.generation + 1, running: true });
    expect(daemonAfter.url).not.toBe(daemonBefore.url);
    expect(daemonAfter.pid).not.toBe(daemonBefore.pid);
    expect(tempStores()).toEqual(storesBefore);
    expect(tempFixtureRoots()).toEqual(rootsBefore);
    expect(callerRepositoryState(work)).toEqual(callerBefore);
  }, 20_000);

  it('second typed loopback transport is terminal', async () => {
    const label = `${FIXTURE_MANAGER_SYNTHETIC_FAULT}: second transport terminal`;
    const faults = [
      {
        ok: false as const,
        kind: 'transport',
        message: `${FIXTURE_MANAGER_SYNTHETIC_FAULT}: injected first transport`,
      },
      {
        ok: false as const,
        kind: 'transport',
        message: `${FIXTURE_MANAGER_SYNTHETIC_FAULT}: injected second transport`,
      },
    ];
    const callerBefore = callerRepositoryState(work);
    const storesBefore = tempStores();
    const rootsBefore = tempFixtureRoots();
    const daemonBefore = daemonManager.activeEvidence;
    const restartBefore = daemonManager.restartCount;
    const recoveryBefore = fixtureRecoveryCount;
    const adapters: ExecRemoteTelemetryGit[] = [];
    const events: FixtureOperationEvent[] = [];
    let attempts = 0;
    let rejection: FixtureOperationRejected | undefined;

    try {
      await runSuccessfulFixtureOperation(
        label,
        daemonManager,
        () => {
          const adapter = new ExecRemoteTelemetryGit();
          adapters.push(adapter);
          return adapter;
        },
        async () => {
          const fault = faults[attempts];
          attempts += 1;
          if (fault === undefined) throw new Error('unexpected third synthetic attempt');
          return fault;
        },
        () => expect(callerRepositoryState(work)).toEqual(callerBefore),
        (event) => events.push(event),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(FixtureOperationRejected);
      rejection = error as FixtureOperationRejected;
    }

    const daemonAfter = daemonManager.activeEvidence;
    expect(rejection).toBeDefined();
    expect(rejection?.result).toBe(faults[1]);
    expect(rejection?.attempt).toBe(2);
    expect(rejection?.message).toContain(faults[0]?.message);
    expect(rejection?.message).toContain(faults[1]?.message);
    expect(attempts).toBe(2);
    expect(fixtureOperationAttempts.get(label)).toBe(2);
    expect(adapters).toHaveLength(2);
    expect(adapters[0]).not.toBe(adapters[1]);
    expect(fixtureRecoveryCount - recoveryBefore).toBe(1);
    expect(daemonManager.restartCount - restartBefore).toBe(1);
    expect(events.map((event) => event.phase)).toEqual(['failure', 'recovery', 'failure']);
    expect(events.filter((event) => event.phase === 'recovery')).toHaveLength(1);
    expect(events.every((event) => event.line.includes(FIXTURE_MANAGER_SYNTHETIC_FAULT))).toBe(
      true,
    );
    expect(events.every((event) => event.line.length <= READINESS_EVIDENCE_BYTES * 3)).toBe(true);
    expect(daemonAfter).toMatchObject({ generation: daemonBefore.generation + 1, running: true });
    expect(daemonAfter.url).not.toBe(daemonBefore.url);
    expect(daemonAfter.pid).not.toBe(daemonBefore.pid);
    expect(tempStores()).toEqual(storesBefore);
    expect(tempFixtureRoots()).toEqual(rootsBefore);
    expect(callerRepositoryState(work)).toEqual(callerBefore);
  }, 20_000);

  it('non-transport semantic failure never recovers', async () => {
    const label = `${FIXTURE_MANAGER_SYNTHETIC_FAULT}: semantic failure terminal`;
    const fault = {
      ok: false as const,
      kind: 'invalid_telemetry',
      message: `${FIXTURE_MANAGER_SYNTHETIC_FAULT}: injected semantic failure`,
    };
    const callerBefore = callerRepositoryState(work);
    const storesBefore = tempStores();
    const rootsBefore = tempFixtureRoots();
    const daemonBefore = daemonManager.activeEvidence;
    const restartBefore = daemonManager.restartCount;
    const recoveryBefore = fixtureRecoveryCount;
    const adapters: ExecRemoteTelemetryGit[] = [];
    const events: FixtureOperationEvent[] = [];
    let attempts = 0;
    let rejection: FixtureOperationRejected | undefined;

    try {
      await runSuccessfulFixtureOperation(
        label,
        daemonManager,
        () => {
          const adapter = new ExecRemoteTelemetryGit();
          adapters.push(adapter);
          return adapter;
        },
        async () => {
          attempts += 1;
          return fault;
        },
        () => expect(callerRepositoryState(work)).toEqual(callerBefore),
        (event) => events.push(event),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(FixtureOperationRejected);
      rejection = error as FixtureOperationRejected;
    }

    expect(rejection).toBeDefined();
    expect(rejection?.result).toBe(fault);
    expect(rejection?.attempt).toBe(1);
    expect(rejection?.message).toContain(fault.message);
    expect(attempts).toBe(1);
    expect(fixtureOperationAttempts.get(label)).toBe(1);
    expect(adapters).toHaveLength(1);
    expect(fixtureRecoveryCount - recoveryBefore).toBe(0);
    expect(daemonManager.restartCount - restartBefore).toBe(0);
    expect(events.map((event) => event.phase)).toEqual(['failure']);
    expect(events[0]?.line).toContain(FIXTURE_MANAGER_SYNTHETIC_FAULT);
    expect(events[0]?.line.length).toBeLessThanOrEqual(READINESS_EVIDENCE_BYTES * 3);
    expect(daemonManager.activeEvidence).toEqual(daemonBefore);
    expect(tempStores()).toEqual(storesBefore);
    expect(tempFixtureRoots()).toEqual(rootsBefore);
    expect(callerRepositoryState(work)).toEqual(callerBefore);
  }, 20_000);

  it('uses exact telemetry-only argv/traffic and loads a verified byte-exact disposable snapshot', async () => {
    let commands: string[][] = [];
    const beforeHead = git(process.cwd(), ['rev-parse', 'HEAD']);
    const beforeIndex = git(process.cwd(), ['write-tree']);
    const loaded = await runSuccessfulFixtureOperation(
      'telemetry snapshot argv and bytes',
      daemonManager,
      () => {
        commands = [];
        return new ExecRemoteTelemetryGit({
          onGitCommand: (args) => commands.push([...args]),
        });
      },
      async (adapter, currentRepository) => {
        const advertisement = await adapter.advertiseTelemetryRefs(currentRepository);
        if (!advertisement.ok) return advertisement;
        expect(advertisement.refs).toHaveLength(1);
        expect(advertisement.refs[0]?.name).toBe(ref);
        const advertisementArgv = commands.find((args) => args.includes('ls-remote')) ?? [];
        expect(advertisementArgv).toContain('refs/harness-telemetry/*');
        expect(advertisementArgv).not.toContain('refs/*');
        const result = await adapter.loadVerifiedTelemetrySnapshot({
          repository: currentRepository,
          advertisedRefs: advertisement.refs,
          candidateRefs: advertisement.refs,
        });
        if (!result.ok) return result;
        expect(result.snapshot.refs[0]?.advertisedOid).toBe(advertisement.refs[0]?.oid);
        return result;
      },
      () => {
        expect(git(process.cwd(), ['rev-parse', 'HEAD'])).toBe(beforeHead);
        expect(git(process.cwd(), ['write-tree'])).toBe(beforeIndex);
      },
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const entry = loaded.snapshot.refs[0]?.history[0]?.entries[0];
    expect(entry?.path).toBe('1.json');
    expect(new TextDecoder().decode(entry?.bytes)).toBe(
      readFileSync(join(work, 'segment-1.json'), 'utf8'),
    );
    expect(loaded.snapshot.effects).toMatchObject({
      callerRepositoryMutated: false,
      disposableStoreRemoved: true,
      advertisedRefs: 1,
      fetchedRefs: 1,
    });
    const fetchArgv = commands.find((args) => args.includes('fetch')) ?? [];
    expect(fetchArgv.some((arg) => arg.startsWith(`+${ref}:refs/harness-pull/`))).toBe(true);
    expect(fetchArgv.join(' ')).not.toContain('refs/heads/main');
    expect(fetchArgv.join(' ')).not.toContain('refs/tags/unrelated-product-tag');
  }, 20_000);

  it('detects whole-namespace movement so the service can restart the complete transaction', async () => {
    let next = '';
    const loaded = await runSuccessfulFixtureOperation(
      'whole namespace movement then refreshed load',
      daemonManager,
      () => new ExecRemoteTelemetryGit(),
      async (adapter, currentRepository) => {
        const first = await adapter.advertiseTelemetryRefs(currentRepository);
        if (!first.ok) return first;
        next = writeTelemetryCommit(work, session, 2);
        git(work, ['update-ref', ref, next]);
        git(work, ['push', '-q', '--force', 'origin-test', `${ref}:${ref}`]);
        const moved = await adapter.loadVerifiedTelemetrySnapshot({
          repository: currentRepository,
          advertisedRefs: first.refs,
          candidateRefs: first.refs,
        });
        if (!moved.ok && moved.kind === 'transport') return moved;
        expect(moved).toMatchObject({ ok: false, kind: 'namespace_moved' });
        const refreshed = await adapter.advertiseTelemetryRefs(currentRepository);
        if (!refreshed.ok) return refreshed;
        const result = await adapter.loadVerifiedTelemetrySnapshot({
          repository: currentRepository,
          advertisedRefs: refreshed.refs,
          candidateRefs: refreshed.refs,
        });
        return result;
      },
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.snapshot.refs[0]?.advertisedOid).toBe(next);
    expect(loaded.snapshot.refs[0]?.history[0]?.entries[0]?.path).toBe('2.json');
  }, 20_000);

  it('rejects a source-shaped parent tree before content admission and removes the store', async () => {
    const sourceRef = 'refs/harness-telemetry/2026/07/16/source-parent';
    const sourceParent = writeCommit(work, [
      { path: 'package.json', content: '{"private":"source-shaped"}\n' },
    ]);
    const safeTip = writeTelemetryCommit(work, 'source-parent', 31, [sourceParent]);
    git(work, ['update-ref', sourceRef, safeTip]);
    git(work, ['push', '-q', 'origin-test', `${sourceRef}:${sourceRef}`]);
    const before = tempStores();
    try {
      const adapter = new ExecRemoteTelemetryGit();
      const advertisement = await adapter.advertiseTelemetryRefs(repository);
      expect(advertisement.ok).toBe(true);
      if (!advertisement.ok) return;
      const candidate = advertisement.refs.filter((item) => item.name === sourceRef);
      await expect(
        adapter.loadVerifiedTelemetrySnapshot({
          repository,
          advertisedRefs: advertisement.refs,
          candidateRefs: candidate,
        }),
      ).resolves.toMatchObject({ ok: false, kind: 'invalid_telemetry' });
      expect(tempStores()).toEqual(before);
    } finally {
      git(work, ['push', '-q', 'origin-test', `:${sourceRef}`]);
    }
  }, 20_000);

  it('orders a telemetry merge DAG child-before-parent with an OID tie-break', async () => {
    const mergeRef = 'refs/harness-telemetry/2026/07/16/merge-session';
    const left = writeTelemetryCommit(work, 'merge-session', 41);
    const right = writeTelemetryCommit(work, 'merge-session', 42);
    const merge = writeTelemetryCommit(work, 'merge-session', 43, [left, right]);
    git(work, ['update-ref', mergeRef, merge]);
    git(work, ['push', '-q', 'origin-test', `${mergeRef}:${mergeRef}`]);
    try {
      const loaded = await runSuccessfulFixtureOperation(
        'merge DAG load',
        daemonManager,
        () => new ExecRemoteTelemetryGit(),
        async (adapter, currentRepository) => {
          const advertisement = await adapter.advertiseTelemetryRefs(currentRepository);
          if (!advertisement.ok) return advertisement;
          const candidate = advertisement.refs.filter((item) => item.name === mergeRef);
          return await adapter.loadVerifiedTelemetrySnapshot({
            repository: currentRepository,
            advertisedRefs: advertisement.refs,
            candidateRefs: candidate,
          });
        },
      );
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.snapshot.refs[0]?.history.map((item) => item.oid)).toEqual([
        merge,
        ...[left, right].sort(),
      ]);
    } finally {
      git(work, ['push', '-q', 'origin-test', `:${mergeRef}`]);
    }
  }, 20_000);

  it('restarts a real whole transaction once for an added same-session ref and fails the second movement', async () => {
    const duplicateRef = `refs/harness-telemetry/2026/07/15/${session}`;
    let moveCount = 0;
    try {
      const first = await runSuccessfulFixtureOperation(
        'service whole-transaction restart',
        daemonManager,
        () =>
          new ExecRemoteTelemetryGit({
            beforePostFetchAdvertisement: () => {
              if (moveCount++ !== 0) return;
              const duplicate = writeTelemetryCommit(work, session, 51);
              git(work, ['update-ref', duplicateRef, duplicate]);
              git(work, ['push', '-q', 'origin-test', `${duplicateRef}:${duplicateRef}`]);
            },
          }),
        async (adapter, currentRepository) =>
          await listPublishedTelemetry(
            { repositories: [currentRepository], selector: { kind: 'session', session } },
            { git: adapter, fs: new FakeFs(), hash: new FakeHash() },
          ),
      );
      expect(first).toMatchObject({ ok: true, rows: [{ sessionId: session, refCount: 2 }] });

      const alwaysMoves = new ExecRemoteTelemetryGit({
        beforePostFetchAdvertisement: () => {
          const moved = writeTelemetryCommit(work, session, 60 + moveCount++);
          git(work, ['update-ref', ref, moved]);
          git(work, ['push', '-q', '--force', 'origin-test', `${ref}:${ref}`]);
        },
      });
      const second = await listPublishedTelemetry(
        { repositories: [repository], selector: { kind: 'session', session } },
        { git: alwaysMoves, fs: new FakeFs(), hash: new FakeHash() },
      );
      expect(second).toMatchObject({ ok: false, kind: 'namespace_moved' });
    } finally {
      git(work, ['push', '-q', 'origin-test', `:${duplicateRef}`]);
    }
  }, 30_000);

  it('fails closed for filter rejection, timeout/output/object bounds, and injected cleanup failure', async () => {
    git(remote, ['config', 'uploadpack.allowFilter', 'false']);
    try {
      await expect(
        new ExecRemoteTelemetryGit().resolveProductCommitInterval({
          repository,
          from: productStart,
          to: productEnd,
          candidates: [],
        }),
      ).resolves.toMatchObject({ ok: false, kind: 'transport' });
    } finally {
      git(remote, ['config', 'uploadpack.allowFilter', 'true']);
    }

    await expect(
      new ExecRemoteTelemetryGit({ maxCommandOutputBytes: 1 }).advertiseTelemetryRefs(repository),
    ).resolves.toMatchObject({ ok: false, kind: 'transport' });
    await expect(
      new ExecRemoteTelemetryGit({ timeoutMs: 0 }).advertiseTelemetryRefs(repository),
    ).resolves.toMatchObject({ ok: false, kind: 'transport' });

    const advertisement = await new ExecRemoteTelemetryGit().advertiseTelemetryRefs(repository);
    expect(advertisement.ok).toBe(true);
    if (!advertisement.ok) return;
    await expect(
      new ExecRemoteTelemetryGit({ maxTelemetryObjectBytes: 1 }).loadVerifiedTelemetrySnapshot({
        repository,
        advertisedRefs: advertisement.refs,
        candidateRefs: [advertisement.refs[0]],
      }),
    ).resolves.toMatchObject({ ok: false, kind: 'transport' });
    const beforeCleanupFailure = tempStores();
    let createdStore: string | undefined;
    let attemptedRemoval: string | undefined;
    let injectedRemovalThrew = false;
    try {
      const cleanupFailure = await new ExecRemoteTelemetryGit({
        createStore: (prefix) => {
          createdStore = mkdtempSync(prefix);
          return createdStore;
        },
        removeStore: (path) => {
          attemptedRemoval = path;
          injectedRemovalThrew = true;
          throw new Error('injected cleanup failure');
        },
      }).loadVerifiedTelemetrySnapshot({
        repository,
        advertisedRefs: advertisement.refs,
        candidateRefs: [advertisement.refs[0]],
      });
      expect(cleanupFailure).toMatchObject({
        ok: false,
        kind: 'transport',
        message: 'telemetry snapshot cleanup failed',
      });
      expect(injectedRemovalThrew).toBe(true);
      expect(createdStore).toBeDefined();
      expect(attemptedRemoval).toBe(createdStore);
      if (createdStore === undefined) throw new Error('cleanup-failure store was not created');
      expect(tempStores()).toEqual([...beforeCleanupFailure, basename(createdStore)].sort());
    } finally {
      if (createdStore !== undefined) rmSync(createdStore, { recursive: true, force: true });
    }
    expect(tempStores()).toEqual(beforeCleanupFailure);
  }, 30_000);

  it('keeps Windows-shaped store/hook paths as single argv values and remote refs logical POSIX', async () => {
    let commands: string[][] = [];
    let storePrefixes: string[] = [];
    const hookPath = 'C:\\Harness Temp\\Agent One\\no hooks';
    const loaded = await runSuccessfulFixtureOperation(
      'Windows-shaped telemetry load',
      daemonManager,
      () => {
        commands = [];
        storePrefixes = [];
        return new ExecRemoteTelemetryGit({
          temporaryRoot: 'C:\\Harness Temp\\Agent One',
          createStore: (prefix) => {
            storePrefixes.push(prefix);
            return mkdtempSync(join(tmpdir(), 'harness-windows-shaped-'));
          },
          hooksPath: () => hookPath,
          onGitCommand: (args) => commands.push([...args]),
        });
      },
      async (adapter, currentRepository) => {
        const advertisement = await adapter.advertiseTelemetryRefs(currentRepository);
        if (!advertisement.ok) return advertisement;
        return await adapter.loadVerifiedTelemetrySnapshot({
          repository: currentRepository,
          advertisedRefs: advertisement.refs,
          candidateRefs: [advertisement.refs[0]],
        });
      },
    );
    expect(loaded.ok).toBe(true);
    expect(storePrefixes).toEqual([expect.stringContaining('C:\\Harness Temp\\Agent One')]);
    expect(commands.some((args) => args.includes(`core.hooksPath=${hookPath}`))).toBe(true);
    expect(commands.flat()).not.toContain('sh');
    expect(
      commands
        .flat()
        .filter((arg) => arg.startsWith('refs/'))
        .every((arg) => !arg.includes('\\')),
    ).toBe(true);
    expect(commands.every((args) => args.every((arg) => typeof arg === 'string'))).toBe(true);
  });

  it('resolves inclusive product commit membership without opening product trees', async () => {
    const result = await runSuccessfulFixtureOperation(
      'inclusive product membership',
      daemonManager,
      () => new ExecRemoteTelemetryGit(),
      async (adapter, currentRepository) => {
        const advertisement = await adapter.advertiseTelemetryRefs(currentRepository);
        if (!advertisement.ok) return advertisement;
        return await adapter.resolveProductCommitInterval({
          repository: currentRepository,
          from: productStart,
          to: productEnd,
          candidates: [productStart, productEnd],
        });
      },
    );
    expect(result).toEqual({
      ok: true,
      membership: { [productStart]: true, [productEnd]: true },
      unavailable: [],
    });
  }, 20_000);

  it('returns true divergence and records an unavailable candidate without borrowing membership', async () => {
    const divergent = writeCommit(work, [{ path: 'other.txt', content: 'other branch\n' }]);
    git(work, ['push', '-q', 'origin-test', `${divergent}:refs/heads/divergent`]);
    try {
      await expect(
        new ExecRemoteTelemetryGit().resolveProductCommitInterval({
          repository,
          from: productEnd,
          to: divergent,
          candidates: [],
        }),
      ).resolves.toMatchObject({ ok: false, kind: 'range_diverged' });
      const unavailable = 'f'.repeat(40);
      const unavailableResult = await runSuccessfulFixtureOperation(
        'unavailable product candidate',
        daemonManager,
        () => new ExecRemoteTelemetryGit(),
        async (adapter, currentRepository) => {
          const advertisement = await adapter.advertiseTelemetryRefs(currentRepository);
          if (!advertisement.ok) return advertisement;
          return await adapter.resolveProductCommitInterval({
            repository: currentRepository,
            from: productStart,
            to: productEnd,
            candidates: [productStart, unavailable],
          });
        },
      );
      expect(unavailableResult).toEqual({
        ok: true,
        membership: { [productStart]: true },
        unavailable: [unavailable],
      });
    } finally {
      git(work, ['push', '-q', 'origin-test', ':refs/heads/divergent']);
    }
  }, 30_000);

  it('enforces one total product deadline, never falls back, and cleans the created store', async () => {
    const commands: string[][] = [];
    const created: string[] = [];
    const removed: string[] = [];
    const ticks = [0, 0, 0, 1_001];
    const adapter = new ExecRemoteTelemetryGit({
      productTimeoutMs: 1_000,
      nowMs: () => ticks.shift() ?? 1_001,
      createStore: (prefix) => {
        created.push(prefix);
        return mkdtempSync(join(tmpdir(), 'harness-deadline-store-'));
      },
      removeStore: (path) => {
        removed.push(path);
        rmSync(path, { recursive: true, force: true });
      },
      onGitCommand: (args) => commands.push([...args]),
    });
    await expect(
      adapter.resolveProductCommitInterval({
        repository,
        from: productStart,
        to: productEnd,
        candidates: [productStart],
      }),
    ).resolves.toMatchObject({ ok: false, kind: 'transport' });
    expect(created).toHaveLength(1);
    expect(removed).toEqual([expect.stringContaining('harness-deadline-store-')]);
    const fetches = commands.filter((args) => args.includes('fetch'));
    expect(fetches.every((args) => args.includes('--filter=tree:0'))).toBe(true);
    expect(
      commands.some((args) => args.includes('fetch') && !args.includes('--filter=tree:0')),
    ).toBe(false);
  }, 20_000);

  it('maps disposable-store creation failure safely without leaking the shaped path', async () => {
    const shaped = 'C:\\Private User\\Telemetry Store';
    const result = await new ExecRemoteTelemetryGit({
      temporaryRoot: shaped,
      createStore: () => {
        throw new Error(shaped);
      },
    }).resolveProductCommitInterval({
      repository,
      from: productStart,
      to: productEnd,
      candidates: [],
    });
    expect(result).toMatchObject({ ok: false, kind: 'transport' });
    expect(JSON.stringify(result)).not.toContain(shaped);
  });

  it('strips inherited Git redirection and pins every post-init repository command to its disposable git-dir', async () => {
    const caller = join(root, 'poison-caller.git');
    git(root, ['init', '--bare', '-q', caller]);
    const beforeRefs = git(caller, ['for-each-ref', '--format=%(refname) %(objectname)']);
    const beforeObjects = git(caller, ['count-objects', '-v']);
    let commands: string[][] = [];
    const loaded = await runSuccessfulFixtureOperation(
      'inherited Git-dir isolation',
      daemonManager,
      () => {
        commands = [];
        return new ExecRemoteTelemetryGit({
          onGitCommand: (args) => commands.push([...args]),
        });
      },
      async (adapter, currentRepository) => {
        const prior = process.env.GIT_DIR;
        process.env.GIT_DIR = caller;
        try {
          const advertisement = await adapter.advertiseTelemetryRefs(currentRepository);
          if (!advertisement.ok) return advertisement;
          return await adapter.loadVerifiedTelemetrySnapshot({
            repository: currentRepository,
            advertisedRefs: advertisement.refs,
            candidateRefs: [advertisement.refs[0]],
          });
        } finally {
          if (prior === undefined) delete process.env.GIT_DIR;
          else process.env.GIT_DIR = prior;
        }
      },
      () => {
        expect(git(caller, ['for-each-ref', '--format=%(refname) %(objectname)'])).toBe(beforeRefs);
        expect(git(caller, ['count-objects', '-v'])).toBe(beforeObjects);
      },
    );
    expect(loaded).toMatchObject({
      ok: true,
      snapshot: { effects: { callerRepositoryMutated: false, disposableStoreRemoved: true } },
    });
    const postInitRepositoryCommands = commands.filter(
      (args) => !args.includes('ls-remote') && !args.includes('init'),
    );
    expect(postInitRepositoryCommands.length).toBeGreaterThan(0);
    expect(
      postInitRepositoryCommands.every((args) => args.some((arg) => arg.startsWith('--git-dir='))),
    ).toBe(true);
  }, 20_000);

  it('neutralizes repository/config/namespace/askpass/SSH redirects independently and jointly', async () => {
    const caller = join(root, 'poison-worktree');
    mkdirSync(caller);
    git(caller, ['init', '-q']);
    git(caller, ['config', 'user.name', 'Harness Test']);
    git(caller, ['config', 'user.email', 'harness@example.invalid']);
    writeFileSync(join(caller, 'owned.txt'), 'caller-owned\n');
    git(caller, ['add', 'owned.txt']);
    git(caller, ['commit', '-qm', 'caller baseline']);
    const callerGit = join(caller, '.git');
    const identity = () => ({
      head: git(caller, ['rev-parse', 'HEAD']),
      index: git(caller, ['write-tree']),
      status: git(caller, ['status', '--porcelain=v1']),
      refs: git(caller, ['for-each-ref', '--format=%(refname) %(objectname)']),
      objects: git(caller, ['count-objects', '-v']),
      worktree: readFileSync(join(caller, 'owned.txt'), 'utf8'),
    });
    const before = identity();
    const poison: Record<string, string> = {
      GIT_DIR: callerGit,
      GIT_WORK_TREE: caller,
      GIT_INDEX_FILE: join(callerGit, 'index'),
      GIT_OBJECT_DIRECTORY: join(callerGit, 'objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(callerGit, 'objects'),
      GIT_COMMON_DIR: callerGit,
      GIT_CONFIG: join(callerGit, 'config'),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.worktree',
      GIT_CONFIG_VALUE_0: caller,
      GIT_NAMESPACE: 'hostile-namespace',
      GIT_REPLACE_REF_BASE: 'refs/hostile-replacements/',
      GIT_SHALLOW_FILE: join(callerGit, 'hostile-shallow'),
      GIT_ASKPASS: join(caller, 'hostile-askpass'),
      SSH_ASKPASS: join(caller, 'hostile-ssh-askpass'),
      GIT_SSH_COMMAND: 'hostile-ssh-command --private-argument',
    };
    const cases = [...Object.entries(poison).map(([key, value]) => ({ [key]: value })), poison];
    for (const injected of cases) {
      const caseName = Object.keys(injected).join(',');
      const loaded = await runSuccessfulFixtureOperation(
        `poison isolation ${caseName}`,
        daemonManager,
        () => new ExecRemoteTelemetryGit(),
        async (adapter, currentRepository) => {
          const prior = Object.fromEntries(
            Object.keys(injected).map((key) => [key, process.env[key]]),
          ) as Record<string, string | undefined>;
          for (const [key, value] of Object.entries(injected)) process.env[key] = value;
          try {
            const advertisement = await adapter.advertiseTelemetryRefs(currentRepository);
            if (!advertisement.ok) return advertisement;
            return await adapter.loadVerifiedTelemetrySnapshot({
              repository: currentRepository,
              advertisedRefs: advertisement.refs,
              candidateRefs: [advertisement.refs[0]],
            });
          } finally {
            for (const [key, value] of Object.entries(prior)) {
              if (value === undefined) delete process.env[key];
              else process.env[key] = value;
            }
          }
        },
        () => {
          expect(identity(), caseName).toEqual(before);
        },
      );
      expect(loaded, caseName).toMatchObject({
        ok: true,
        snapshot: { effects: { callerRepositoryMutated: false, disposableStoreRemoved: true } },
      });
    }
  }, 60_000);

  it('fails closed on endpoint absence, candidate preflight, and an injected object cap', async () => {
    const adapter = new ExecRemoteTelemetryGit({ maxCandidates: 1 });
    await expect(
      adapter.resolveProductCommitInterval({
        repository,
        from: productStart,
        to: productEnd,
        candidates: [productStart, productEnd],
      }),
    ).resolves.toMatchObject({ ok: false, kind: 'invalid_telemetry' });

    await expect(
      new ExecRemoteTelemetryGit().resolveProductCommitInterval({
        repository,
        from: 'f'.repeat(40),
        to: productEnd,
        candidates: [],
      }),
    ).resolves.toMatchObject({ ok: false, kind: 'endpoint_unknown' });

    await expect(
      new ExecRemoteTelemetryGit({ maxProductObjectBytes: 1 }).resolveProductCommitInterval({
        repository,
        from: productStart,
        to: productEnd,
        candidates: [],
      }),
    ).resolves.toMatchObject({ ok: false, kind: 'transport' });
  }, 20_000);
});
