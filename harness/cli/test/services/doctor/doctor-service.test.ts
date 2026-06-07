import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { exitCodeFor } from '../../../src/output/exit.js';
import {
  buildDoctorReport,
  type DoctorDeps,
  doctorEnvelope,
  renderDoctorText,
  runDoctor,
} from '../../../src/services/doctor/doctor-service.js';
import { loadSlotRegistry } from '../../../src/services/slots/slot-registry.js';

const ALL_TOOLS = { node: '/usr/bin/node', just: '/usr/bin/just', biome: '/usr/bin/biome' };
const BUILT_CLI = { 'harness/cli/dist/index.js': '// built' };

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    fs: over.fs ?? new FakeFs(BUILT_CLI),
    proc: over.proc ?? new FakeProcess(ALL_TOOLS),
    git: over.git ?? new FakeGit({ isRepo: true, branch: 'main' }),
    env: over.env ?? new FakeEnv(),
    clock: over.clock ?? new FakeClock('2026-06-08T07:20:00.000Z'),
  };
}

describe('buildDoctorReport', () => {
  it('given_healthy_tools_and_build_when_built_then_only_slots_layer_is_unconfigured', () => {
    /*
    Test Doc:
    - Why: doctor must report configured vs unconfigured layers with zero real I/O (AC-9).
    - Contract: buildDoctorReport returns toolchain/cli-build/command-slots layers + branch.
    - Usage Notes: inject FakeFs/FakeProcess/FakeGit; assert on layer ok + adapter call history.
    - Quality Contribution: proves the layered check is driven entirely through ports.
    - Worked Example: with all tools + dist present, only command-slots is not ok (all stubs).
    */
    const fs = new FakeFs(BUILT_CLI);
    const report = buildDoctorReport(deps({ fs }), loadSlotRegistry(fs));
    const byName = Object.fromEntries(report.layers.map((l) => [l.name, l]));
    expect(byName.toolchain?.ok).toBe(true);
    expect(byName['cli-build']?.ok).toBe(true);
    expect(byName['command-slots']?.ok).toBe(false); // all 8 are unconfigured stubs
    expect(byName['command-slots']?.next_action).toBeDefined();
    expect(report.branch).toBe('main');
    expect(fs.reads).toContain('harness/cli/dist/index.js'); // assert on call history
  });

  it('flags a missing tool with a next_action', () => {
    const proc = new FakeProcess({ node: '/usr/bin/node' }); // just + biome missing
    const report = buildDoctorReport(deps({ proc }), loadSlotRegistry(new FakeFs(BUILT_CLI)));
    const toolchain = report.layers.find((l) => l.name === 'toolchain');
    expect(toolchain?.ok).toBe(false);
    expect(toolchain?.detail).toContain('just');
    expect(toolchain?.next_action).toBeDefined();
  });

  it('flags an unbuilt CLI', () => {
    const fs = new FakeFs(); // no dist
    const report = buildDoctorReport(deps({ fs }), loadSlotRegistry(fs));
    expect(report.layers.find((l) => l.name === 'cli-build')?.ok).toBe(false);
  });

  it('reports null branch when not a repo (git.currentBranch not consulted)', () => {
    const git = new FakeGit({ isRepo: false });
    const report = buildDoctorReport(deps({ git }), loadSlotRegistry(new FakeFs(BUILT_CLI)));
    expect(report.branch).toBeNull();
    expect(git.calls).toEqual(['isRepo']); // short-circuits — no currentBranch call
  });

  it('reads HARNESS_JSON via the env port into json_env', () => {
    const env = new FakeEnv({ HARNESS_JSON: '1' });
    const report = buildDoctorReport(deps({ env }), loadSlotRegistry(new FakeFs(BUILT_CLI)));
    expect(report.json_env).toBe(true);
    expect(env.gets).toContain('HARNESS_JSON');
  });
});

describe('doctorEnvelope', () => {
  it('is degraded (exit 0) with a next_action when any layer is not ok', () => {
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    const env = runDoctor(deps({ clock }), loadSlotRegistry(new FakeFs(BUILT_CLI)));
    expect(env.status).toBe('degraded'); // slots are unconfigured
    expect(env.next_action).toBeDefined();
    expect(env.timestamp).toBe('2026-06-08T07:20:00.000Z');
    expect(env.evidence).toEqual([{ label: 'doctor report', none: true }]);
    expect(exitCodeFor(env)).toBe(0);
  });

  it('is ok (exit 0) when every layer is ready', () => {
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    const registry = loadSlotRegistry(new FakeFs(BUILT_CLI));
    for (const slot of registry) {
      slot.status = 'configured'; // simulate a fully-configured repo
    }
    const report = buildDoctorReport(deps({ clock }), registry);
    const env = doctorEnvelope(report, clock);
    expect(env.status).toBe('ok');
    expect(exitCodeFor(env)).toBe(0);
  });
});

describe('renderDoctorText', () => {
  it('lists each layer and the branch', () => {
    const report = buildDoctorReport(deps(), loadSlotRegistry(new FakeFs(BUILT_CLI)));
    const text = renderDoctorText(report);
    expect(text).toContain('toolchain');
    expect(text).toContain('cli-build');
    expect(text).toContain('command-slots');
    expect(text).toContain('branch:');
  });
});
