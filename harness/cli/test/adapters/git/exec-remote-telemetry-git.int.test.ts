import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { devNull, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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

const HTTPS_CREDENTIAL_PROBE_URL = 'https://127.0.0.1:1/private.git';
const HTTPS_CREDENTIAL_PROBE_REPOSITORY: RemoteRepository = {
  key: 'repo-credential000000000',
  identity: HTTPS_CREDENTIAL_PROBE_URL,
  transportUrl: HTTPS_CREDENTIAL_PROBE_URL,
};
const CREDENTIAL_QUERY_REGEX = '^credential(\\..+)?\\.(helper|username|usehttppath)$';

interface ObservedGitCommand {
  readonly args: readonly string[];
  readonly env: Readonly<NodeJS.ProcessEnv> | undefined;
}

function credentialTempDirectories(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('harness-git-credential-'))
    .sort();
}

async function withProcessEnvironment<T>(
  values: Readonly<Record<string, string | undefined>>,
  operation: () => Promise<T>,
): Promise<T> {
  const before = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  ) as Record<string, string | undefined>;
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await operation();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function addGitConfig(file: string, key: string, value: string): void {
  execFileSync('git', ['config', '--file', file, '--add', key, value], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function credentialRecord(key: string, value: string): Buffer {
  return Buffer.concat([Buffer.from(`${key}\n${value}`, 'utf8'), Buffer.of(0)]);
}

function injectedCredentialQuery(stdout: Uint8Array, code = 0, stopped = null) {
  return async () => ({ ok: code === 0 && stopped === null, code, stdout, stopped });
}

const NEGATIVE_CREDENTIAL_QUERY_CASES: ReadonlyArray<{
  readonly label: string;
  readonly stdout: Uint8Array;
}> = [
  { label: 'missing terminal NUL', stdout: Buffer.from('credential.helper\nhelper') },
  {
    label: 'empty framed record',
    stdout: Buffer.concat([credentialRecord('credential.helper', 'helper'), Buffer.of(0)]),
  },
  {
    label: 'invalid UTF-8',
    stdout: Buffer.concat([Buffer.from('credential.helper\n'), Buffer.of(0xff, 0)]),
  },
  { label: 'key control', stdout: credentialRecord('credential.helper\t', 'helper') },
  { label: 'value control', stdout: credentialRecord('credential.helper', 'helper\targ') },
  { label: 'forbidden key', stdout: credentialRecord('credential.password', 'not-admitted') },
  {
    label: 'malformed authority subsection',
    stdout: credentialRecord('credential.https://[legacy-broken.helper', 'x'),
  },
  {
    label: 'URL subsection cap',
    stdout: credentialRecord(`credential.https://${'a'.repeat(2_001)}.helper`, 'x'),
  },
  { label: 'invalid useHttpPath', stdout: credentialRecord('credential.usehttppath', 'TRUE') },
  { label: 'empty username', stdout: credentialRecord('credential.username', '') },
  {
    label: 'username cap',
    stdout: credentialRecord('credential.username', 'u'.repeat(1_025)),
  },
  {
    label: 'helper cap',
    stdout: credentialRecord('credential.helper', 'h'.repeat(8_193)),
  },
  {
    label: 'entry count cap',
    stdout: Buffer.concat(
      Array.from({ length: 65 }, (_, index) =>
        credentialRecord('credential.helper', `helper-${index}`),
      ),
    ),
  },
  { label: 'discovery output cap', stdout: Buffer.alloc(65_537, 0x61) },
];

describe('ExecRemoteTelemetryGit — HTTPS credential discovery RED cluster A', () => {
  it('preserves helper chain/reset/include/order/scoped fields and excludes forbidden config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-credential-red-a-'));
    const globalConfig = join(root, '.gitconfig');
    const includedConfig = join(root, 'included credentials.gitconfig');
    const beforeTemps = credentialTempDirectories();
    let sanitizedPath: string | undefined;
    let sanitizedBytes: Buffer | undefined;
    const observed: ObservedGitCommand[] = [];
    try {
      addGitConfig(globalConfig, 'credential.helper', 'alpha helper --one');
      addGitConfig(globalConfig, 'credential.helper', '');
      addGitConfig(globalConfig, 'include.path', includedConfig);
      addGitConfig(globalConfig, 'credential.helper', 'omega helper');
      addGitConfig(globalConfig, 'credential.helper', 'omega helper');
      addGitConfig(
        includedConfig,
        'credential.https://match.example.invalid.helper',
        '!gh auth git-credential',
      );
      addGitConfig(
        includedConfig,
        'credential.https://match.example.invalid.username',
        'operator-name',
      );
      addGitConfig(includedConfig, 'credential.https://match.example.invalid.useHttpPath', 'true');
      addGitConfig(includedConfig, 'credential.https://match.example.invalid.useHttpPath', 'false');
      addGitConfig(includedConfig, 'credential.https://match.example.invalid.password', 'hidden');
      addGitConfig(includedConfig, 'credential.oauthRefreshToken', 'hidden-oauth');
      addGitConfig(includedConfig, 'credential.provider', 'hidden-provider');
      addGitConfig(includedConfig, 'credential.authority', 'hidden-authority');
      addGitConfig(includedConfig, 'credential.arbitrary', 'hidden-arbitrary');
      addGitConfig(includedConfig, 'http.extraHeader', 'Authorization: hidden');
      addGitConfig(includedConfig, 'url.ssh://git@example.invalid/.insteadOf', 'https://');

      const result = await withProcessEnvironment(
        {
          HOME: root,
          USERPROFILE: root,
          XDG_CONFIG_HOME: join(root, 'xdg config'),
          GIT_CONFIG_GLOBAL: join(root, 'must-not-be-inherited'),
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'credential.helper',
          GIT_CONFIG_VALUE_0: 'must-not-be-inherited',
        },
        async () =>
          await new ExecRemoteTelemetryGit({
            timeoutMs: 1_000,
            onGitCommand: (args: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => {
              observed.push({ args: [...args], env });
              const fileIndex = args.indexOf('--file');
              if (fileIndex >= 0 && args.includes('--add')) sanitizedPath = args[fileIndex + 1];
              if (args.includes('ls-remote') && sanitizedPath !== undefined) {
                sanitizedBytes = readFileSync(sanitizedPath);
              }
            },
          }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY),
      );

      expect(result).toMatchObject({ ok: false, kind: 'transport' });
      const discovery = observed.filter((item) => item.args.includes('--get-regexp'));
      expect(discovery).toHaveLength(1);
      expect(discovery[0]?.args).toEqual([
        'config',
        '--global',
        '--includes',
        '--null',
        '--get-regexp',
        CREDENTIAL_QUERY_REGEX,
      ]);
      const writers = observed
        .filter((item) => item.args.includes('--file') && item.args.includes('--add'))
        .map((item) => item.args.slice(-2));
      expect(writers).toEqual([
        ['credential.helper', 'alpha helper --one'],
        ['credential.helper', ''],
        ['credential.helper', 'omega helper'],
        ['credential.helper', 'omega helper'],
        ['credential.https://match.example.invalid.helper', '!gh auth git-credential'],
        ['credential.https://match.example.invalid.username', 'operator-name'],
        ['credential.https://match.example.invalid.usehttppath', 'true'],
        ['credential.https://match.example.invalid.usehttppath', 'false'],
      ]);
      expect(sanitizedBytes).toBeDefined();
      const materialized = sanitizedBytes?.toString('utf8') ?? '';
      expect(materialized).not.toContain('hidden');
      expect(materialized).not.toContain('extraHeader');
      expect(materialized).not.toContain('oauth');
      expect(materialized).not.toContain('provider');
      expect(materialized).not.toContain('authority');
      expect(materialized).not.toContain('arbitrary');
      expect(materialized).not.toContain('insteadOf');
      expect(materialized).not.toContain('must-not-be-inherited');
      expect(sanitizedPath).toBeDefined();
      expect(existsSync(sanitizedPath as string)).toBe(false);
      expect(credentialTempDirectories()).toEqual(beforeTemps);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('materializes URL scopes without matching them so real Git selects only the applicable helper', async () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-credential-red-a-scope-'));
    const globalConfig = join(root, '.gitconfig');
    const markerMatch = join(root, 'matched');
    const markerOther = join(root, 'other');
    const secretFile = join(root, 'helper-secret');
    const matchingHelper = join(root, 'matching-helper.sh');
    const otherHelper = join(root, 'other-helper.sh');
    const sentinel = 'fixture-secret-never-public';
    let sanitizedPath: string | undefined;
    let sanitizedBytesDuringNetwork: Buffer | undefined;
    let fillOutput = '';
    try {
      writeFileSync(secretFile, `${sentinel}\n`);
      writeFileSync(
        matchingHelper,
        `#!/bin/sh\nprintf matched > ${JSON.stringify(markerMatch)}\nprintf 'username=matched-user\\npassword='\ncat ${JSON.stringify(secretFile)}\n`,
      );
      writeFileSync(
        otherHelper,
        `#!/bin/sh\nprintf other > ${JSON.stringify(markerOther)}\nprintf 'username=other-user\\npassword=other\\n'\n`,
      );
      chmodSync(matchingHelper, 0o700);
      chmodSync(otherHelper, 0o700);
      addGitConfig(
        globalConfig,
        'credential.https://match.example.invalid.helper',
        `!${matchingHelper}`,
      );
      addGitConfig(
        globalConfig,
        'credential.https://other.example.invalid.helper',
        `!${otherHelper}`,
      );

      await withProcessEnvironment(
        { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: join(root, 'xdg') },
        async () => {
          await new ExecRemoteTelemetryGit({
            timeoutMs: 1_000,
            onGitCommand: (args: readonly string[]) => {
              const fileIndex = args.indexOf('--file');
              if (fileIndex >= 0 && args.includes('--add')) sanitizedPath = args[fileIndex + 1];
              if (args.includes('ls-remote') && sanitizedPath !== undefined) {
                sanitizedBytesDuringNetwork = readFileSync(sanitizedPath);
                fillOutput = execFileSync('git', ['credential', 'fill'], {
                  input: 'protocol=https\nhost=match.example.invalid\n\n',
                  encoding: 'utf8',
                  env: {
                    PATH: process.env.PATH,
                    HOME: root,
                    GIT_CONFIG_GLOBAL: sanitizedPath,
                    GIT_CONFIG_NOSYSTEM: '1',
                    GIT_TERMINAL_PROMPT: '0',
                  },
                });
              }
            },
          }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
        },
      );
      expect(fillOutput).toContain('username=matched-user');
      expect(fillOutput).toContain(`password=${sentinel}`);
      expect(existsSync(markerMatch)).toBe(true);
      expect(existsSync(markerOther)).toBe(false);
      expect(sanitizedBytesDuringNetwork?.toString('utf8')).not.toContain(sentinel);
      expect(existsSync(sanitizedPath as string)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts no matching entries and still creates an empty operation-scoped config', async () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-credential-red-a-empty-'));
    const globalConfig = join(root, '.gitconfig');
    let sanitizedPath: string | undefined;
    let bytesDuringNetwork: Buffer | undefined;
    try {
      addGitConfig(globalConfig, 'core.editor', 'must-not-be-copied');
      await withProcessEnvironment(
        { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: join(root, 'xdg') },
        async () => {
          await new ExecRemoteTelemetryGit({
            timeoutMs: 1_000,
            onGitCommand: (args: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => {
              const fileIndex = args.indexOf('--file');
              if (fileIndex >= 0) sanitizedPath = args[fileIndex + 1];
              if (args.includes('ls-remote')) {
                sanitizedPath ??= env?.GIT_CONFIG_GLOBAL;
                const configPath = sanitizedPath;
                if (configPath !== undefined) bytesDuringNetwork = readFileSync(configPath);
              }
            },
          }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
        },
      );
      expect(sanitizedPath).toBeDefined();
      expect(bytesDuringNetwork).toEqual(Buffer.alloc(0));
      expect(existsSync(sanitizedPath as string)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts the exact helper, username, URL-subsection, and 64-entry boundaries', async () => {
    const subsectionPrefix = 'https://example.invalid/';
    const subsection = `${subsectionPrefix}${'p'.repeat(2_000 - subsectionPrefix.length)}`;
    const boundaryOutputs = [
      Buffer.concat([
        credentialRecord('credential.helper', 'h'.repeat(8_192)),
        credentialRecord('credential.username', 'u'.repeat(1_024)),
        credentialRecord('credential.usehttppath', 'false'),
        credentialRecord(`credential.${subsection}.helper`, 'scoped'),
      ]),
      Buffer.concat(
        Array.from({ length: 64 }, (_, index) =>
          credentialRecord('credential.helper', `helper-${index}`),
        ),
      ),
    ];
    for (const [caseIndex, stdout] of boundaryOutputs.entries()) {
      const beforeTemps = credentialTempDirectories();
      let writerCommands = 0;
      let networkCommands = 0;
      const result = await new ExecRemoteTelemetryGit({
        timeoutMs: 1_000,
        credentialConfigQuery: injectedCredentialQuery(stdout),
        onGitCommand: (args: readonly string[]) => {
          if (args.includes('--file') && args.includes('--add')) writerCommands += 1;
          if (args.includes('ls-remote')) networkCommands += 1;
        },
      }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
      expect(result).toMatchObject({ ok: false, message: 'remote telemetry advertisement failed' });
      expect(writerCommands).toBe(caseIndex === 0 ? 4 : 64);
      expect(networkCommands).toBe(1);
      expect(credentialTempDirectories()).toEqual(beforeTemps);
    }
  });

  it.each(
    NEGATIVE_CREDENTIAL_QUERY_CASES,
  )('rejects $label before network and restores credential temp state', async ({ stdout }) => {
    const beforeTemps = credentialTempDirectories();
    let queries = 0;
    let networkCommands = 0;
    const result = await new ExecRemoteTelemetryGit({
      timeoutMs: 1_000,
      credentialConfigQuery: async () => {
        queries += 1;
        return await injectedCredentialQuery(stdout)();
      },
      onGitCommand: (args: readonly string[]) => {
        if (args.includes('ls-remote')) networkCommands += 1;
      },
    }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
    expect(result).toEqual({
      ok: false,
      kind: 'transport',
      message: 'HTTPS credential configuration failed',
      repositoryKey: HTTPS_CREDENTIAL_PROBE_REPOSITORY.key,
    });
    expect(queries).toBe(1);
    expect(networkCommands).toBe(0);
    expect(credentialTempDirectories()).toEqual(beforeTemps);
    for (const { label, stdout: privateBytes } of NEGATIVE_CREDENTIAL_QUERY_CASES) {
      expect(JSON.stringify(result)).not.toContain(label);
      expect(JSON.stringify(result)).not.toContain(Buffer.from(privateBytes).toString('utf8'));
    }
  });
});

describe('ExecRemoteTelemetryGit — HTTPS credential subsection correction RED', () => {
  const exerciseQuery = async (stdout: Uint8Array) => {
    const beforeTemps = credentialTempDirectories();
    const writers: string[][] = [];
    let networkCommands = 0;
    let sanitizedPath: string | undefined;
    let sanitizedBytes: Buffer | undefined;
    const result = await new ExecRemoteTelemetryGit({
      timeoutMs: 1_000,
      credentialConfigQuery: injectedCredentialQuery(stdout),
      onGitCommand: (args: readonly string[]) => {
        const fileIndex = args.indexOf('--file');
        if (fileIndex >= 0 && args.includes('--add')) {
          sanitizedPath = args[fileIndex + 1];
          writers.push(args.slice(-2) as string[]);
        }
        if (args.includes('ls-remote')) {
          networkCommands += 1;
          if (sanitizedPath !== undefined) sanitizedBytes = readFileSync(sanitizedPath);
        }
      },
    }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
    return { beforeTemps, writers, networkCommands, result, sanitizedBytes };
  };

  it.each([
    {
      label: 'configured username under an scp-style scope',
      subsection: 'account@example.invalid:tenant/project',
      field: 'username',
      value: 'synthetic-operator',
    },
    {
      label: 'helper under a provider-style scope',
      subsection: 'provider:tenant/project',
      field: 'helper',
      value: 'synthetic-helper',
    },
    {
      label: 'safe punctuation, Unicode letters, and spaces',
      subsection: 'provider.example:tenant/path@region-name_value α β',
      field: 'username',
      value: 'synthetic-user',
    },
    {
      label: 'the exact opaque subsection byte bound',
      subsection: `provider-${'p'.repeat(1_991)}`,
      field: 'helper',
      value: 'bounded-helper',
    },
  ])('admits $label without matching applicability', async ({ subsection, field, value }) => {
    const key = `credential.${subsection}.${field}`;
    const observed = await exerciseQuery(credentialRecord(key, value));
    expect(observed.result).toMatchObject({
      ok: false,
      message: 'remote telemetry advertisement failed',
    });
    expect(observed.writers).toEqual([[key, value]]);
    expect(observed.networkCommands).toBe(1);
    expect(observed.sanitizedBytes?.byteLength).toBeGreaterThan(0);
    expect(JSON.stringify(observed.result)).not.toContain(subsection);
    expect(JSON.stringify(observed.result)).not.toContain(value);
    expect(credentialTempDirectories()).toEqual(observed.beforeTemps);
  });

  it('preserves provider records, an empty reset, and the following helper chain in query order', async () => {
    const subsection = 'provider:tenant/project';
    const records = [
      ['credential.helper', 'first-helper'],
      [`credential.${subsection}.username`, 'synthetic-user'],
      [`credential.${subsection}.helper`, ''],
      [`credential.${subsection}.helper`, 'second-helper'],
      ['credential.helper', 'final-helper'],
    ] as const;
    const observed = await exerciseQuery(
      Buffer.concat(records.map(([key, value]) => credentialRecord(key, value))),
    );
    expect(observed.result).toMatchObject({
      ok: false,
      message: 'remote telemetry advertisement failed',
    });
    expect(observed.writers).toEqual(records.map(([key, value]) => [key, value]));
    expect(observed.networkCommands).toBe(1);
    expect(credentialTempDirectories()).toEqual(observed.beforeTemps);
  });

  it.each([
    'https://example.invalid',
    'https://example.invalid:8443/team/path',
    'custom://example.invalid/team/path',
  ])('retains prior strict host-bearing URL admission for %s', async (subsection) => {
    const key = `credential.${subsection}.helper`;
    const observed = await exerciseQuery(credentialRecord(key, 'url-helper'));
    expect(observed.writers).toEqual([[key, 'url-helper']]);
    expect(observed.networkCommands).toBe(1);
    expect(credentialTempDirectories()).toEqual(observed.beforeTemps);
  });

  it('keeps an unrelated opaque helper private and lets Git decide it is not applicable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-credential-correction-unrelated-'));
    const marker = join(root, 'unexpected-helper-execution');
    const helper = join(root, 'synthetic-helper.sh');
    const subsection = 'provider:unrelated/project';
    const key = `credential.${subsection}.helper`;
    const beforeTemps = credentialTempDirectories();
    let sanitizedPath: string | undefined;
    let sanitizedBytes: Buffer | undefined;
    let networkArgs: readonly string[] = [];
    try {
      writeFileSync(
        helper,
        `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\nprintf 'username=synthetic\\npassword=synthetic\\n'\n`,
      );
      chmodSync(helper, 0o700);
      const result = await new ExecRemoteTelemetryGit({
        timeoutMs: 1_000,
        credentialConfigQuery: injectedCredentialQuery(credentialRecord(key, `!${helper}`)),
        onGitCommand: (args: readonly string[]) => {
          const fileIndex = args.indexOf('--file');
          if (fileIndex >= 0 && args.includes('--add')) sanitizedPath = args[fileIndex + 1];
          if (args.includes('ls-remote') && sanitizedPath !== undefined) {
            networkArgs = [...args];
            sanitizedBytes = readFileSync(sanitizedPath);
            try {
              execFileSync('git', ['credential', 'fill'], {
                input: 'protocol=https\nhost=match.example.invalid\n\n',
                encoding: 'utf8',
                env: {
                  PATH: process.env.PATH,
                  GIT_CONFIG_GLOBAL: sanitizedPath,
                  GIT_CONFIG_NOSYSTEM: '1',
                  GIT_TERMINAL_PROMPT: '0',
                },
                stdio: ['pipe', 'pipe', 'pipe'],
              });
            } catch {
              // A nonmatching private scope leaves credential fill unsatisfied.
            }
          }
        },
      }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
      expect(result).toMatchObject({ ok: false, message: 'remote telemetry advertisement failed' });
      expect(sanitizedBytes?.byteLength).toBeGreaterThan(0);
      expect(networkArgs.join('\n')).not.toContain(subsection);
      expect(networkArgs.join('\n')).not.toContain(helper);
      expect(JSON.stringify(result)).not.toContain(subsection);
      expect(JSON.stringify(result)).not.toContain(helper);
      expect(existsSync(marker)).toBe(false);
      expect(existsSync(sanitizedPath as string)).toBe(false);
      expect(credentialTempDirectories()).toEqual(beforeTemps);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    { label: 'empty subsection', stdout: credentialRecord('credential..helper', 'x') },
    { label: 'C0 control', stdout: credentialRecord('credential.provider\u0001scope.helper', 'x') },
    { label: 'C1 control', stdout: credentialRecord('credential.provider\u0085scope.helper', 'x') },
    {
      label: 'DEL control',
      stdout: credentialRecord('credential.provider\u007fscope.helper', 'x'),
    },
    {
      label: 'bidi format control',
      stdout: credentialRecord('credential.provider\u202escope.helper', 'x'),
    },
    {
      label: 'zero-width format control',
      stdout: credentialRecord('credential.provider\u200bscope.helper', 'x'),
    },
    {
      label: 'line separator',
      stdout: credentialRecord('credential.provider\u2028scope.helper', 'x'),
    },
    {
      label: 'paragraph separator',
      stdout: credentialRecord('credential.provider\u2029scope.helper', 'x'),
    },
    {
      label: 'invalid UTF-8',
      stdout: Buffer.concat([
        Buffer.from('credential.provider.scope.helper\n'),
        Buffer.of(0xff, 0),
      ]),
    },
    {
      label: 'opaque subsection overflow',
      stdout: credentialRecord(`credential.${'p'.repeat(2_001)}.helper`, 'x'),
    },
    {
      label: 'host-bearing URL password',
      stdout: credentialRecord('credential.https://user:password@example.invalid.helper', 'x'),
    },
    {
      label: 'host-bearing URL query',
      stdout: credentialRecord('credential.https://example.invalid/path?query=value.helper', 'x'),
    },
    {
      label: 'host-bearing URL fragment',
      stdout: credentialRecord('credential.https://example.invalid/path#fragment.helper', 'x'),
    },
    {
      label: 'malformed RFC authority',
      stdout: credentialRecord('credential.https://[broken.helper', 'x'),
    },
    {
      label: 'forbidden terminal field',
      stdout: credentialRecord('credential.provider:scope.password', 'x'),
    },
    {
      label: 'entry count overflow',
      stdout: Buffer.concat(
        Array.from({ length: 65 }, (_, index) =>
          credentialRecord('credential.helper', `helper-${index}`),
        ),
      ),
    },
  ])('rejects $label before materialization or network', async ({ stdout }) => {
    const observed = await exerciseQuery(stdout);
    expect(observed.result).toEqual({
      ok: false,
      kind: 'transport',
      message: 'HTTPS credential configuration failed',
      repositoryKey: HTTPS_CREDENTIAL_PROBE_REPOSITORY.key,
    });
    expect(observed.writers).toHaveLength(0);
    expect(observed.networkCommands).toBe(0);
    expect(credentialTempDirectories()).toEqual(observed.beforeTemps);
  });
});

describe('repair RED 5 — scoped and unscoped credential value Unicode controls', () => {
  const exerciseValueQuery = async (stdout: Uint8Array) => {
    const beforeTemps = credentialTempDirectories();
    let writerCommands = 0;
    let networkCommands = 0;
    const result = await new ExecRemoteTelemetryGit({
      timeoutMs: 1_000,
      credentialConfigQuery: injectedCredentialQuery(stdout),
      onGitCommand: (args: readonly string[]) => {
        if (args.includes('--file') && args.includes('--add')) writerCommands += 1;
        if (args.includes('ls-remote')) networkCommands += 1;
      },
    }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
    return { beforeTemps, writerCommands, networkCommands, result };
  };

  const valueControlCases = [
    ['C1', '\u0085'],
    ['bidi format', '\u202e'],
    ['zero-width format', '\u200b'],
    ['line separator', '\u2028'],
    ['paragraph separator', '\u2029'],
  ].flatMap(([label, control]) =>
    [
      ['unscoped helper', 'credential.helper'],
      ['unscoped username', 'credential.username'],
      ['scoped helper', 'credential.provider:tenant/project.helper'],
      ['scoped username', 'credential.provider:tenant/project.username'],
    ].map(([scope, key]) => ({ label: `${scope} ${label}`, key, value: `safe${control}value` })),
  );

  it.each(valueControlCases)('rejects $label before writer/network and without echo', async ({
    key,
    value,
  }) => {
    const observed = await exerciseValueQuery(credentialRecord(key, value));
    expect(observed.result).toEqual({
      ok: false,
      kind: 'transport',
      message: 'HTTPS credential configuration failed',
      repositoryKey: HTTPS_CREDENTIAL_PROBE_REPOSITORY.key,
    });
    expect(observed.writerCommands).toBe(0);
    expect(observed.networkCommands).toBe(0);
    expect(JSON.stringify(observed.result)).not.toContain(value);
    expect(credentialTempDirectories()).toEqual(observed.beforeTemps);
  });

  it('preserves safe Unicode/spaces, empty helper reset, and exact lowercase bool', async () => {
    const records = [
      ['credential.helper', '!synthetic-helper α --flag value'],
      ['credential.username', 'synthetic α user'],
      ['credential.provider:tenant/project.helper', 'scoped helper β'],
      ['credential.provider:tenant/project.username', 'scoped β user'],
      ['credential.helper', ''],
      ['credential.usehttppath', 'true'],
    ] as const;
    const observed = await exerciseValueQuery(
      Buffer.concat(records.map(([key, value]) => credentialRecord(key, value))),
    );
    expect(observed.result).toMatchObject({
      ok: false,
      message: 'remote telemetry advertisement failed',
    });
    expect(observed.writerCommands).toBe(records.length);
    expect(observed.networkCommands).toBe(1);
    expect(credentialTempDirectories()).toEqual(observed.beforeTemps);
  });
});

describe('ExecRemoteTelemetryGit — HTTPS credential lease RED cluster B', () => {
  it('uses private 0700/0600 materialization, HTTPS-only network env, and complete cleanup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-credential-red-b-'));
    const globalConfig = join(root, '.gitconfig');
    const helperFile = join(root, 'trusted helper command');
    const sentinelSecret = 'fixture-helper-secret-never-exposed';
    const beforeCredentialTemps = credentialTempDirectories();
    const beforeHead = git(process.cwd(), ['rev-parse', 'HEAD']);
    const beforeIndex = git(process.cwd(), ['write-tree']);
    const beforeStatus = git(process.cwd(), ['status', '--porcelain=v1']);
    let sanitizedPath: string | undefined;
    let privateDirectoryMode: number | undefined;
    let privateFileMode: number | undefined;
    let sanitizedBytes: Buffer | undefined;
    let network: ObservedGitCommand | undefined;
    const observed: ObservedGitCommand[] = [];
    try {
      writeFileSync(helperFile, `private test material: ${sentinelSecret}\n`);
      addGitConfig(globalConfig, 'credential.helper', `!${helperFile}`);
      addGitConfig(globalConfig, 'credential.username', 'private-test-user');
      const poison = {
        GIT_DIR: join(root, 'hostile.git'),
        GIT_WORK_TREE: join(root, 'hostile-worktree'),
        GIT_INDEX_FILE: join(root, 'hostile-index'),
        GIT_OBJECT_DIRECTORY: join(root, 'hostile-objects'),
        GIT_ALTERNATE_OBJECT_DIRECTORIES: join(root, 'hostile-alternates'),
        GIT_COMMON_DIR: join(root, 'hostile-common'),
        GIT_CONFIG: join(root, 'hostile-config'),
        GIT_CONFIG_GLOBAL: join(root, 'hostile-global'),
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: 'Authorization: forbidden',
        GIT_NAMESPACE: 'hostile-namespace',
        GIT_REPLACE_REF_BASE: 'refs/hostile/',
        GIT_SHALLOW_FILE: join(root, 'hostile-shallow'),
        GIT_ASKPASS: join(root, 'hostile-askpass'),
        SSH_ASKPASS: join(root, 'hostile-ssh-askpass'),
        GIT_SSH_COMMAND: 'hostile-ssh-command',
      };
      const result = await withProcessEnvironment(
        {
          HOME: root,
          USERPROFILE: root,
          XDG_CONFIG_HOME: join(root, 'xdg'),
          ...poison,
        },
        async () =>
          await new ExecRemoteTelemetryGit({
            timeoutMs: 1_000,
            onGitCommand: (args: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => {
              const item = { args: [...args], env };
              observed.push(item);
              const fileIndex = args.indexOf('--file');
              if (fileIndex >= 0 && args.includes('--add')) sanitizedPath = args[fileIndex + 1];
              if (args.includes('ls-remote')) {
                network = item;
                if (sanitizedPath !== undefined) {
                  sanitizedBytes = readFileSync(sanitizedPath);
                  privateDirectoryMode = statSync(dirname(sanitizedPath)).mode & 0o777;
                  privateFileMode = statSync(sanitizedPath).mode & 0o777;
                }
              }
            },
          }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY),
      );

      expect(result).toMatchObject({ ok: false, kind: 'transport' });
      expect(sanitizedPath).toBeDefined();
      if (process.platform !== 'win32') {
        expect(privateDirectoryMode).toBe(0o700);
        expect(privateFileMode).toBe(0o600);
      }
      expect(sanitizedBytes?.toString('utf8')).toContain('credential');
      expect(sanitizedBytes?.toString('utf8')).not.toContain(sentinelSecret);
      expect(network?.args).toContain('credential.interactive=false');
      expect(network?.env?.GIT_CONFIG_GLOBAL).toBe(sanitizedPath);
      expect(network?.env).toMatchObject({
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'never',
      });
      expect(network?.args.join('\n')).not.toContain('private-test-user');
      expect(network?.args.join('\n')).not.toContain(helperFile);
      expect(Object.values(network?.env ?? {}).join('\n')).not.toContain('private-test-user');
      expect(Object.values(network?.env ?? {}).join('\n')).not.toContain(sentinelSecret);
      expect(JSON.stringify(result)).not.toContain('private-test-user');
      expect(JSON.stringify(result)).not.toContain(helperFile);
      expect(JSON.stringify(result)).not.toContain(sentinelSecret);
      const discovery = observed.find((item) => item.args.includes('--get-regexp'));
      for (const name of Object.keys(poison)) expect(discovery?.env?.[name]).toBeUndefined();
      for (const name of [
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_INDEX_FILE',
        'GIT_OBJECT_DIRECTORY',
        'GIT_COMMON_DIR',
        'GIT_CONFIG_COUNT',
        'GIT_CONFIG_KEY_0',
        'GIT_CONFIG_VALUE_0',
        'GIT_NAMESPACE',
        'GIT_REPLACE_REF_BASE',
        'GIT_SHALLOW_FILE',
        'GIT_ASKPASS',
        'SSH_ASKPASS',
        'GIT_SSH_COMMAND',
      ]) {
        expect(network?.env?.[name]).toBeUndefined();
      }
      expect(existsSync(sanitizedPath as string)).toBe(false);
      expect(credentialTempDirectories()).toEqual(beforeCredentialTemps);
      expect(git(process.cwd(), ['rev-parse', 'HEAD'])).toBe(beforeHead);
      expect(git(process.cwd(), ['write-tree'])).toBe(beforeIndex);
      expect(git(process.cwd(), ['status', '--porcelain=v1'])).toBe(beforeStatus);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never resolves or materializes credentials for SSH, scp-like SSH, or git transport', async () => {
    const beforeTemps = credentialTempDirectories();
    let queries = 0;
    const targets: RemoteRepository[] = [
      {
        key: 'repo-ssh00000000000000',
        identity: 'ssh://127.0.0.1:1/private.git',
        transportUrl: 'ssh://127.0.0.1:1/private.git',
      },
      {
        key: 'repo-scp00000000000000',
        identity: 'git@127.0.0.1:private.git',
        transportUrl: 'git@127.0.0.1:private.git',
      },
      {
        key: 'repo-git00000000000000',
        identity: 'git://127.0.0.1:1/private.git',
        transportUrl: 'git://127.0.0.1:1/private.git',
      },
    ];
    for (const repository of targets) {
      let network: ObservedGitCommand | undefined;
      await new ExecRemoteTelemetryGit({
        timeoutMs: 25,
        credentialConfigQuery: async () => {
          queries += 1;
          return await injectedCredentialQuery(Buffer.alloc(0), 1)();
        },
        onGitCommand: (args: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => {
          if (args.includes('ls-remote')) network = { args: [...args], env };
        },
      }).advertiseTelemetryRefs(repository);
      expect(network?.args).not.toContain('credential.interactive=false');
      expect(network?.env?.GIT_CONFIG_GLOBAL).toBe(devNull);
    }
    expect(queries).toBe(0);
    expect(credentialTempDirectories()).toEqual(beforeTemps);
  });

  it.each([
    {
      label: 'query nonzero',
      query: injectedCredentialQuery(Buffer.from('private query output'), 2),
    },
    {
      label: 'query timeout',
      query: injectedCredentialQuery(Buffer.alloc(0), null as unknown as number, 'timeout'),
    },
    {
      label: 'query throw',
      query: async () => {
        throw new Error('private query throw');
      },
    },
  ])('maps $label to one static pre-network failure and no residue', async ({ query }) => {
    const beforeTemps = credentialTempDirectories();
    let networkCommands = 0;
    const result = await new ExecRemoteTelemetryGit({
      timeoutMs: 1_000,
      credentialConfigQuery: query,
      onGitCommand: (args: readonly string[]) => {
        if (args.includes('ls-remote')) networkCommands += 1;
      },
    }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
    expect(result).toEqual({
      ok: false,
      kind: 'transport',
      message: 'HTTPS credential configuration failed',
      repositoryKey: HTTPS_CREDENTIAL_PROBE_REPOSITORY.key,
    });
    expect(networkCommands).toBe(0);
    expect(credentialTempDirectories()).toEqual(beforeTemps);
    expect(JSON.stringify(result)).not.toContain('private query');
  });

  it('enforces the shared preparation deadline and maps private creation failure before network', async () => {
    const beforeTemps = credentialTempDirectories();
    const ticks = [0, 30_001];
    let deadlineNetworkCommands = 0;
    const deadlineFailure = await new ExecRemoteTelemetryGit({
      nowMs: () => ticks.shift() ?? 30_001,
      credentialConfigQuery: injectedCredentialQuery(Buffer.alloc(0)),
      onGitCommand: (args: readonly string[]) => {
        if (args.includes('ls-remote')) deadlineNetworkCommands += 1;
      },
    }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
    expect(deadlineFailure).toEqual({
      ok: false,
      kind: 'transport',
      message: 'HTTPS credential configuration failed',
      repositoryKey: HTTPS_CREDENTIAL_PROBE_REPOSITORY.key,
    });
    expect(deadlineNetworkCommands).toBe(0);

    const root = mkdtempSync(join(tmpdir(), 'harness-credential-create-failure-'));
    const privateMissingRoot = join(root, 'missing parent');
    let creationNetworkCommands = 0;
    try {
      const creationFailure = await new ExecRemoteTelemetryGit({
        temporaryRoot: privateMissingRoot,
        credentialConfigQuery: injectedCredentialQuery(Buffer.alloc(0)),
        onGitCommand: (args: readonly string[]) => {
          if (args.includes('ls-remote')) creationNetworkCommands += 1;
        },
      }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
      expect(creationFailure).toEqual({
        ok: false,
        kind: 'transport',
        message: 'HTTPS credential configuration failed',
        repositoryKey: HTTPS_CREDENTIAL_PROBE_REPOSITORY.key,
      });
      expect(JSON.stringify(creationFailure)).not.toContain(privateMissingRoot);
      expect(creationNetworkCommands).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    expect(credentialTempDirectories()).toEqual(beforeTemps);
  });

  it('cleans partial materialization failure before network without exposing writer input', async () => {
    const beforeTemps = credentialTempDirectories();
    const privateHelper = '!private helper command';
    const stdout = Buffer.concat([
      credentialRecord('credential.helper', 'first-helper'),
      credentialRecord('credential.helper', privateHelper),
    ]);
    let writers = 0;
    let networkCommands = 0;
    const result = await new ExecRemoteTelemetryGit({
      timeoutMs: 1_000,
      credentialConfigQuery: injectedCredentialQuery(stdout),
      onGitCommand: (args: readonly string[]) => {
        if (args.includes('--file') && args.includes('--add') && ++writers === 2) {
          throw new Error(privateHelper);
        }
        if (args.includes('ls-remote')) networkCommands += 1;
      },
    }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
    expect(result).toEqual({
      ok: false,
      kind: 'transport',
      message: 'HTTPS credential configuration failed',
      repositoryKey: HTTPS_CREDENTIAL_PROBE_REPOSITORY.key,
    });
    expect(writers).toBe(2);
    expect(networkCommands).toBe(0);
    expect(JSON.stringify(result)).not.toContain(privateHelper);
    expect(credentialTempDirectories()).toEqual(beforeTemps);
  });

  it('honors an HTTPS-only injected lease and maps resolver/cleanup failures statically', async () => {
    const makeLease = (cleanup: () => void) => {
      const root = mkdtempSync(join(tmpdir(), 'harness-injected-credential-'));
      const configPath = join(root, 'credentials.gitconfig');
      writeFileSync(configPath, '', { mode: 0o600 });
      return { root, configPath, lease: { ok: true as const, configPath, cleanup } };
    };

    let cleanupCalls = 0;
    const first = makeLease(() => {
      cleanupCalls += 1;
    });
    try {
      let networkConfig: string | undefined;
      const result = await new ExecRemoteTelemetryGit({
        timeoutMs: 1_000,
        resolveHttpsCredentialConfig: async () => first.lease,
        onGitCommand: (args: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => {
          if (args.includes('ls-remote')) networkConfig = env?.GIT_CONFIG_GLOBAL;
        },
      }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
      expect(result).toMatchObject({ ok: false, message: 'remote telemetry advertisement failed' });
      expect(networkConfig).toBe(first.configPath);
      expect(cleanupCalls).toBe(1);
    } finally {
      rmSync(first.root, { recursive: true, force: true });
    }

    const second = makeLease(() => {
      throw new Error('private cleanup path');
    });
    try {
      const cleanupFailure = await new ExecRemoteTelemetryGit({
        timeoutMs: 1_000,
        resolveHttpsCredentialConfig: async () => second.lease,
      }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
      expect(cleanupFailure).toEqual({
        ok: false,
        kind: 'transport',
        message: 'HTTPS credential cleanup failed',
        repositoryKey: HTTPS_CREDENTIAL_PROBE_REPOSITORY.key,
      });
      expect(JSON.stringify(cleanupFailure)).not.toContain(second.configPath);
    } finally {
      rmSync(second.root, { recursive: true, force: true });
    }

    let networkCommands = 0;
    const resolverFailure = await new ExecRemoteTelemetryGit({
      resolveHttpsCredentialConfig: async () => ({
        ok: false as const,
        kind: 'transport' as const,
        message: 'HTTPS credential configuration failed',
        repositoryKey: HTTPS_CREDENTIAL_PROBE_REPOSITORY.key,
      }),
      onGitCommand: (args: readonly string[]) => {
        if (args.includes('ls-remote')) networkCommands += 1;
      },
    }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
    expect(resolverFailure).toMatchObject({
      ok: false,
      kind: 'transport',
      message: 'HTTPS credential configuration failed',
    });
    expect(networkCommands).toBe(0);

    const thrownFailure = await new ExecRemoteTelemetryGit({
      resolveHttpsCredentialConfig: async () => {
        throw new Error('private resolver throw');
      },
    }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
    expect(thrownFailure).toEqual({
      ok: false,
      kind: 'transport',
      message: 'HTTPS credential configuration failed',
      repositoryKey: HTTPS_CREDENTIAL_PROBE_REPOSITORY.key,
    });
    expect(JSON.stringify(thrownFailure)).not.toContain('private resolver');
  });

  it('keeps a Windows-shaped private config path one environment value and out of argv/output', async () => {
    const shapedPath = 'C:\\Private Git Config\\Agent One\\credentials.gitconfig';
    let cleanupCalls = 0;
    let network: ObservedGitCommand | undefined;
    const result = await new ExecRemoteTelemetryGit({
      timeoutMs: 1_000,
      resolveHttpsCredentialConfig: async () => ({
        ok: true as const,
        configPath: shapedPath,
        cleanup: () => {
          cleanupCalls += 1;
        },
      }),
      onGitCommand: (args: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => {
        if (args.includes('ls-remote')) network = { args: [...args], env };
      },
    }).advertiseTelemetryRefs(HTTPS_CREDENTIAL_PROBE_REPOSITORY);
    expect(network?.env?.GIT_CONFIG_GLOBAL).toBe(shapedPath);
    expect(network?.args).not.toContain(shapedPath);
    expect(network?.args.every((arg) => typeof arg === 'string')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(shapedPath);
    expect(cleanupCalls).toBe(1);
  });
});

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

  it('reuses one injected HTTPS lease within each successful public operation', async () => {
    const beforeTemps = credentialTempDirectories();
    const httpsIdentityOverLoopback: RemoteRepository = {
      ...repository,
      identity: 'https://fixture.example.invalid/private.git',
    };
    const leasePaths: string[] = [];
    const networkConfigPaths: string[] = [];
    let cleanupCalls = 0;
    const adapter = new ExecRemoteTelemetryGit({
      resolveHttpsCredentialConfig: async () => {
        const privateRoot = mkdtempSync(join(tmpdir(), 'harness-git-credential-'));
        const configPath = join(privateRoot, 'credentials.gitconfig');
        writeFileSync(configPath, '', { mode: 0o600 });
        leasePaths.push(configPath);
        return {
          ok: true,
          configPath,
          cleanup: () => {
            cleanupCalls += 1;
            rmSync(privateRoot, { recursive: true, force: true });
          },
        };
      },
      onGitCommand: (args: readonly string[], env?: Readonly<NodeJS.ProcessEnv>) => {
        if (args.includes('ls-remote') || args.includes('fetch')) {
          const path = env?.GIT_CONFIG_GLOBAL;
          if (path !== undefined) networkConfigPaths.push(path);
        }
      },
    });

    const advertisement = await adapter.advertiseTelemetryRefs(httpsIdentityOverLoopback);
    expect(advertisement.ok).toBe(true);
    if (!advertisement.ok) return;
    const loaded = await adapter.loadVerifiedTelemetrySnapshot({
      repository: httpsIdentityOverLoopback,
      advertisedRefs: advertisement.refs,
      candidateRefs: [advertisement.refs[0]],
    });
    expect(loaded.ok).toBe(true);
    const product = await adapter.resolveProductCommitInterval({
      repository: httpsIdentityOverLoopback,
      from: productStart,
      to: productEnd,
      candidates: [],
    });
    expect(product.ok).toBe(true);

    expect(leasePaths).toHaveLength(3);
    expect(new Set(leasePaths).size).toBe(3);
    expect(cleanupCalls).toBe(3);
    expect(networkConfigPaths[0]).toBe(leasePaths[0]);
    expect(networkConfigPaths.filter((path) => path === leasePaths[1])).toHaveLength(2);
    expect(networkConfigPaths.filter((path) => path === leasePaths[2]).length).toBeGreaterThan(1);
    expect(networkConfigPaths.every((path) => leasePaths.includes(path))).toBe(true);
    expect(credentialTempDirectories()).toEqual(beforeTemps);
  }, 30_000);

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
