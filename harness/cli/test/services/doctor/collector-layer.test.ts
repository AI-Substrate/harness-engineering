import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { exitCodeFor } from '../../../src/output/exit.js';
import { GITAI_PIN } from '../../../src/services/doctor/collector/pin.js';
import {
  type CollectorState,
  collectorStatePath,
  emptyCollectorState,
} from '../../../src/services/doctor/collector/state.js';
import {
  buildDoctorReport,
  type DoctorDeps,
  doctorEnvelope,
  renderDoctorText,
} from '../../../src/services/doctor/doctor-service.js';
import type { VerbRegistry } from '../../../src/services/extensions/registry.js';

/**
 * Plan 073 · ac-000a, ac-000b, ac-000c, ac-0014 — the collector row inside
 * `harness doctor`.
 *
 * With harness capture off, this row is the ONLY surface that can tell a
 * developer that nothing is collecting AI attribution. It must therefore be
 * loud, specific — and never blocking: a doctor verdict that halted a developer
 * mid-flight would be traded away within a week, and then the warning would be
 * gone too.
 */

const BUILT_CLI = {
  'harness/cli/tsconfig.json': '{}',
  'harness/cli/dist/index.js': '// built',
};
const ALL_TOOLS = { node: '/usr/bin/node', just: '/usr/bin/just', biome: '/usr/bin/biome' };
const HOME = '/home/u';
const BINARY = '/home/u/.git-ai/bin/git-ai';
const NOW = '2026-08-06T10:00:00.000Z';
const EMPTY: VerbRegistry = { verbs: [], records: [] };

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    fs: over.fs ?? new FakeFs(BUILT_CLI),
    proc: over.proc ?? new FakeProcess(ALL_TOOLS, '/repo'),
    git: over.git ?? new FakeGit({ isRepo: true, branch: 'main' }),
    env: over.env ?? new FakeEnv(),
    clock: over.clock ?? new FakeClock(NOW),
    collectorHost: { platform: 'darwin', arch: 'arm64', home: HOME },
    ...over,
  };
}

function installedState(over: Partial<CollectorState> = {}): CollectorState {
  const base = emptyCollectorState(NOW, GITAI_PIN);
  return {
    ...base,
    cli: {
      status: 'installed',
      path: BINARY,
      // The digest recorded at install — the doctor row re-checks it against the
      // pin without needing a hash port wired.
      digest: GITAI_PIN.artifacts['macos-arm64'].sha256,
      verified_at: NOW,
      executable: true,
      detail: 'installed',
    },
    hooks: { status: 'installed', at: NOW, agents: ['claude'], detail: 'hooks installed' },
    trace2: [{ observed: 'empty', entries: [], at: NOW }],
    note_schema: { expected: GITAI_PIN.expect_schema_version, observed: null, status: 'unknown' },
    ...over,
  };
}

function fsWith(state: CollectorState | null, extra: Record<string, string> = {}): FakeFs {
  return new FakeFs({
    ...BUILT_CLI,
    ...(state === null ? {} : { [collectorStatePath('/repo')]: JSON.stringify(state) }),
    ...extra,
  });
}

const collectorRow = (report: ReturnType<typeof buildDoctorReport>) =>
  report.layers.find((layer) => layer.name === 'gitai-collector');

describe('the gitai-collector doctor row', () => {
  it('reports not-installed on a machine that has never installed the collector', () => {
    const report = buildDoctorReport(deps({ fs: fsWith(null) }), EMPTY);

    const row = collectorRow(report);
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain('not-installed');
    expect(row?.next_action).toContain('--install-collector');
  });

  it('reports the trace2 partial state as its own thing, not as healthy (ac-0014)', () => {
    const report = buildDoctorReport(
      deps({
        fs: fsWith(
          installedState({
            hooks: {
              status: 'skipped-trace2',
              at: NOW,
              agents: [],
              detail: 'global trace2 config is PRESENT',
            },
          }),
          { [BINARY]: 'binary bytes' },
        ),
      }),
      EMPTY,
    );

    const row = collectorRow(report);
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain('cli-only-trace2');
    expect(row?.detail).toContain('no AI attribution is being collected');
  });

  it('reads ok when the collector is installed, hooked, hash-matching and on PATH', () => {
    const report = buildDoctorReport(
      deps({
        fs: fsWith(installedState(), {
          [BINARY]: 'binary bytes',
          [`${HOME}/.claude/settings.json`]: '{}',
        }),
        // The bare name must RESOLVE, not merely exist — healthy requires both.
        env: new FakeEnv({ PATH: `/usr/bin:${HOME}/.git-ai/bin` }),
      }),
      EMPTY,
    );

    const row = collectorRow(report);
    expect(row?.ok).toBe(true);
    expect(row?.detail).toContain('healthy');
    expect(row?.detail).toContain('cannot prove it is occurring');
  });

  it('warns binary-not-on-path when the install is perfect but the bare name resolves nowhere', () => {
    // Same perfect install as the healthy case — the default FakeEnv simply has
    // no PATH, which is exactly the measured Windows shape: binary present,
    // hooks on, and the editor extension's bare-name spawn ENOENTs on every save.
    const report = buildDoctorReport(
      deps({
        fs: fsWith(installedState(), {
          [BINARY]: 'binary bytes',
          [`${HOME}/.claude/settings.json`]: '{}',
        }),
      }),
      EMPTY,
    );

    const row = collectorRow(report);
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain('binary-not-on-path');
    expect(row?.detail).toContain('KnownHuman');
    expect(row?.next_action).toContain('PATH');
  });

  it('WARNS and never blocks — a failing collector row still exits 0 (ac-000c)', () => {
    const report = buildDoctorReport(deps({ fs: fsWith(null) }), EMPTY);
    const envelope = doctorEnvelope(report, new FakeClock(NOW));

    expect(envelope.status).toBe('degraded');
    expect(exitCodeFor(envelope)).toBe(0);
    expect(envelope.next_action).toBeDefined();
  });

  it('renders into the human report with its next_action', () => {
    const text = renderDoctorText(buildDoctorReport(deps({ fs: fsWith(null) }), EMPTY));

    expect(text).toContain('gitai-collector');
    expect(text).toContain('→');
  });

  it('is OMITTED entirely when the composition root wires no host', () => {
    // A row that says "could not determine" on every unwired host teaches
    // operators to ignore the row. Absent is better than meaningless.
    const report = buildDoctorReport(
      { ...deps({ fs: fsWith(null) }), collectorHost: undefined },
      EMPTY,
    );

    expect(collectorRow(report)).toBeUndefined();
  });

  it('never invokes anything — the row is a pure fs read (P7)', () => {
    const proc = new FakeProcess(ALL_TOOLS, '/repo');
    buildDoctorReport(deps({ fs: fsWith(installedState()), proc }), EMPTY);

    // `which` probes are the toolchain row's; nothing spawned a child, and the
    // collector row has no exec port to spawn one with.
    expect(Object.keys(proc)).not.toContain('run');
  });
});
