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
import type { ExtensionRecord, HarnessVerb } from '../../../src/services/extensions/contract.js';
import type { VerbRegistry } from '../../../src/services/extensions/registry.js';
import { buildRecordRegistry, coreRecordTypes } from '../../../src/services/record/registry.js';

const ALL_TOOLS = { node: '/usr/bin/node', just: '/usr/bin/just', biome: '/usr/bin/biome' };
// Dev-mode seed (FX001): the tsconfig marker makes checkCliBuild treat the fake tree as
// the harness's home; dist present → built. Without the marker the tree reads as a consumer.
const BUILT_CLI = {
  'harness/cli/tsconfig.json': '{}',
  'harness/cli/dist/index.js': '// built',
};

const mkVerb = (name: string): HarnessVerb => ({
  name,
  summary: `${name} verb`,
  run: () => ({ status: 'ok' }),
});

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    fs: over.fs ?? new FakeFs(BUILT_CLI),
    proc: over.proc ?? new FakeProcess(ALL_TOOLS),
    git: over.git ?? new FakeGit({ isRepo: true, branch: 'main' }),
    env: over.env ?? new FakeEnv(),
    clock: over.clock ?? new FakeClock('2026-06-08T07:20:00.000Z'),
  };
}

function registry(records: ExtensionRecord[]): VerbRegistry {
  return { verbs: records.flatMap((r) => r.verbs), records };
}

const EMPTY: VerbRegistry = { verbs: [], records: [] };

describe('buildDoctorReport', () => {
  it('given_healthy_tools_and_loaded_extensions_when_built_then_all_layers_ok', () => {
    /*
    Test Doc:
    - Why: doctor enumerates installed extensions (loaded/failed/conflict) WITHOUT invoking any
      handler (P7, AC-5), alongside the toolchain + cli-build layers, with zero real I/O.
    - Contract: buildDoctorReport returns toolchain/cli-build/extensions layers + branch; the
      extensions layer is ok when nothing failed/conflicted.
    - Usage Notes: inject fakes + the assembled VerbRegistry; assert on layer ok + extension detail.
    - Quality Contribution: proves the extension provenance surface doctor exposes.
    - Worked Example: 2 loaded extensions, all tools present, dist built → every layer ok.
    */
    const reg = registry([
      {
        entryPath: '/repo/.harness/extensions/hello/extension.ts',
        status: 'loaded',
        verbs: [mkVerb('hello')],
      },
      {
        entryPath: '/repo/.harness/extensions/build/extension.ts',
        status: 'loaded',
        verbs: [mkVerb('build')],
      },
    ]);
    const fs = new FakeFs({
      ...BUILT_CLI,
      '/repo/.harness/extensions/hello/instructions.md': '# Hello',
      '/repo/.harness/extensions/build/instructions.md': '# Build',
    });
    const report = buildDoctorReport(deps({ fs }), reg);
    const byName = Object.fromEntries(report.layers.map((l) => [l.name, l]));
    expect(byName.toolchain?.ok).toBe(true);
    expect(byName['cli-build']?.ok).toBe(true);
    expect(byName.extensions?.ok).toBe(true);
    expect(byName.extensions?.detail).toContain('2 loaded');
    expect(report.branch).toBe('main');
  });

  it('cli-build: dev repo without dist → not-ok with the npm run build next_action', () => {
    const fs = new FakeFs({ 'harness/cli/tsconfig.json': '{}' });
    const report = buildDoctorReport(deps({ fs }), EMPTY);
    const layer = report.layers.find((l) => l.name === 'cli-build');
    expect(layer?.ok).toBe(false);
    expect(layer?.detail).toContain('not built');
    expect(layer?.next_action).toContain('npm run build');
  });

  it('cli-build: consumer install (no dev marker) → ok with honest consumer detail (FX001)', () => {
    /*
    Test Doc:
    - Why: plan-013 dogfood finding FIND-2 — every installed consumer saw a false
      `cli-build` degraded because doctor checked the dev-repo dist path relative to cwd.
      FX001 gates the check on the dev-tree marker (harness/cli/tsconfig.json) so the very
      first diagnostic a consumer runs tells the truth.
    - Contract: marker absent → layer ok:true, detail mentions `consumer`, no next_action;
      with healthy tools the whole envelope is ok (not falsely degraded).
    - Quality Contribution: pins consumer-mode honesty without changing dev-repo behaviour.
    */
    const fs = new FakeFs(); // empty tree = consumer clone, no harness/cli/
    const report = buildDoctorReport(deps({ fs }), EMPTY);
    const layer = report.layers.find((l) => l.name === 'cli-build');
    expect(layer?.ok).toBe(true);
    expect(layer?.detail).toMatch(/consumer/);
    expect(layer?.next_action).toBeUndefined();
    const env = doctorEnvelope(report, new FakeClock('2026-06-08T07:20:00.000Z'));
    expect(env.status).toBe('ok');
  });

  it('extensions layer is honest about no extensions installed (ok, with guidance)', () => {
    const report = buildDoctorReport(deps(), EMPTY);
    const ext = report.layers.find((l) => l.name === 'extensions');
    expect(ext?.ok).toBe(true);
    expect(ext?.detail).toMatch(/no extensions/i);
    expect(ext?.next_action).toMatch(/\.harness\/extensions/);
  });

  it('reports a failed extension (E140) without invoking it — not fatal, others still load', () => {
    const reg = registry([
      { entryPath: '/x/hello.ts', status: 'loaded', verbs: [mkVerb('hello')] },
      {
        entryPath: '/x/seed/index.ts',
        status: 'failed',
        verbs: [],
        error: 'E140: SyntaxError boom',
      },
    ]);
    const report = buildDoctorReport(deps(), reg);
    const ext = report.layers.find((l) => l.name === 'extensions');
    expect(ext?.ok).toBe(false);
    expect(ext?.detail).toContain('1 failed');
    expect(ext?.next_action).toBeDefined();
    expect(report.extensions?.map((e) => e.status)).toEqual(['loaded', 'failed']);
    const failed = report.extensions?.find((e) => e.status === 'failed');
    expect(failed?.error).toContain('E140');
  });

  it('reports a verb conflict (E142)', () => {
    const reg = registry([
      { entryPath: '/x/a.ts', status: 'loaded', verbs: [mkVerb('dup')] },
      { entryPath: '/x/b.ts', status: 'conflict', verbs: [], shadows: ['dup'] },
    ]);
    const report = buildDoctorReport(deps(), reg);
    const ext = report.layers.find((l) => l.name === 'extensions');
    expect(ext?.ok).toBe(false);
    expect(ext?.detail).toContain('1 conflict');
  });

  it('flags a missing tool with a next_action', () => {
    const proc = new FakeProcess({ node: '/usr/bin/node' });
    const report = buildDoctorReport(deps({ proc }), EMPTY);
    const toolchain = report.layers.find((l) => l.name === 'toolchain');
    expect(toolchain?.ok).toBe(false);
    expect(toolchain?.detail).toContain('just');
  });

  it('reads HARNESS_JSON via the env port into json_env', () => {
    const env = new FakeEnv({ HARNESS_JSON: '1' });
    const report = buildDoctorReport(deps({ env }), EMPTY);
    expect(report.json_env).toBe(true);
    expect(env.gets).toContain('HARNESS_JSON');
  });
});

describe('doctorEnvelope', () => {
  it('is degraded (exit 0) when an extension failed', () => {
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    const reg = registry([
      { entryPath: '/x/bad.ts', status: 'failed', verbs: [], error: 'E140: boom' },
    ]);
    const env = runDoctor(deps({ clock }), reg);
    expect(env.status).toBe('degraded');
    expect(env.next_action).toBeDefined();
    expect(exitCodeFor(env)).toBe(0);
  });

  it('is ok (exit 0) when every layer is ready', () => {
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    const reg = registry([
      { entryPath: '/x/hello/extension.ts', status: 'loaded', verbs: [mkVerb('hello')] },
    ]);
    const fs = new FakeFs({ ...BUILT_CLI, '/x/hello/instructions.md': '# Hello' });
    const env = doctorEnvelope(buildDoctorReport(deps({ clock, fs }), reg), clock);
    expect(env.status).toBe('ok');
    expect(exitCodeFor(env)).toBe(0);
  });
});

describe('renderDoctorText', () => {
  it('lists each layer, the extensions, and the branch', () => {
    const reg = registry([
      {
        entryPath: '/repo/.harness/extensions/hello.ts',
        status: 'loaded',
        verbs: [mkVerb('hello')],
      },
    ]);
    const text = renderDoctorText(buildDoctorReport(deps(), reg));
    expect(text).toContain('toolchain');
    expect(text).toContain('cli-build');
    expect(text).toContain('extensions');
    expect(text).toContain('hello');
    expect(text).toContain('branch:');
  });
});

describe('package-convention validation (plan 014 D2)', () => {
  const FLOW = '/repo/.harness/extensions/flow';

  it('an extension carrying instructions.md gets a clean bill — layer ok, envelope ok', () => {
    const reg = registry([
      { entryPath: `${FLOW}/extension.ts`, status: 'loaded', verbs: [mkVerb('flow')] },
    ]);
    const fs = new FakeFs({ ...BUILT_CLI, [`${FLOW}/instructions.md`]: '# Flow briefing' });
    const report = buildDoctorReport(deps({ fs }), reg);
    expect(report.conventions).toEqual([]);
    expect(report.layers.find((l) => l.name === 'extensions')?.ok).toBe(true);
    expect(doctorEnvelope(report, new FakeClock('2026-06-10T00:00:00.000Z')).status).toBe('ok');
  });

  it('missing instructions.md → per-extension E144 complaint + next_action + overall degraded, exit 0 (the wail, AC-5/AC-9)', () => {
    /*
    Test Doc:
    - Why: extensions are little packages with convention-required files; doctor must WAIL
      about a missing briefing while the verb keeps running (plan 014 D2 — degraded exits 0,
      a complaint, never a refusal).
    - Contract: a loaded record whose folder lacks instructions.md yields a conventions[]
      entry (E144 detail + author-this next_action), flips the extensions layer !ok and the
      envelope to degraded (exit 0); the record itself STAYS status 'loaded'.
    - Quality Contribution: pins the wail semantics consumers (CI, skills) rely on being
      consequence-free.
    */
    const reg = registry([
      { entryPath: `${FLOW}/extension.ts`, status: 'loaded', verbs: [mkVerb('flow')] },
    ]);
    const report = buildDoctorReport(deps(), reg);
    expect(report.conventions).toHaveLength(1);
    expect(report.conventions[0]?.detail).toContain('E144');
    expect(report.conventions[0]?.detail).toContain('instructions.md');
    expect(report.conventions[0]?.next_action).toContain(`${FLOW}/instructions.md`);
    expect(report.conventions[0]?.next_action).toContain('harness instructions');
    const ext = report.layers.find((l) => l.name === 'extensions');
    expect(ext?.ok).toBe(false);
    expect(ext?.detail).toContain('missing instructions.md');
    expect(report.extensions[0]?.status).toBe('loaded');
    const env = doctorEnvelope(report, new FakeClock('2026-06-10T00:00:00.000Z'));
    expect(env.status).toBe('degraded');
    expect(exitCodeFor(env)).toBe(0);
  });

  it('the core instructions row is ALWAYS present and ok (the baked briefing ships with the CLI)', () => {
    const report = buildDoctorReport(deps(), EMPTY);
    const layer = report.layers.find((l) => l.name === 'instructions');
    expect(layer?.ok).toBe(true);
    expect(layer?.detail).toMatch(/baked/i);
  });

  it('renders the complaint and the flat-layout rejection through the standard record path', () => {
    const reg = registry([
      { entryPath: `${FLOW}/extension.ts`, status: 'loaded', verbs: [mkVerb('flow')] },
      {
        entryPath: '/repo/.harness/extensions/legacy.ts',
        status: 'failed',
        verbs: [],
        error: 'E143: unsupported flat layout — move to legacy/extension.ts',
      },
    ]);
    const text = renderDoctorText(buildDoctorReport(deps(), reg));
    expect(text).toContain('missing instructions.md');
    expect(text).toContain(`author ${FLOW}/instructions.md`);
    expect(text).toContain('unsupported flat layout — move to legacy/extension.ts');
  });
});

describe('record-types layer', () => {
  it('enumerates the merged record types (core ∪ extension) without invoking anything', () => {
    const recordReg = buildRecordRegistry(coreRecordTypes, [
      {
        recordType: {
          kind: 'record',
          type: 'dev-survey',
          description: 'DX survey.',
          template: '---\n---\n',
        },
        entryPath: '.harness/extensions/dev-survey.record.ts',
      },
    ]);
    const report = buildDoctorReport(deps(), EMPTY, recordReg);
    const layer = report.layers.find((l) => l.name === 'record-types');
    expect(layer?.ok).toBe(true);
    expect(layer?.detail).toContain('2 available');
    expect(layer?.detail).toContain('1 core');
    expect(layer?.detail).toContain('1 extension');
    expect(report.recordTypes.map((t) => t.type)).toEqual(['retro', 'dev-survey']);

    const text = renderDoctorText(report);
    expect(text).toContain('record-types');
    expect(text).toContain('retro [core]');
    expect(text).toContain('dev-survey [extension] .harness/extensions/dev-survey.record.ts');
  });

  it('without a record registry shows zero record types (back-compat 2-arg call)', () => {
    const report = buildDoctorReport(deps(), EMPTY);
    const layer = report.layers.find((l) => l.name === 'record-types');
    expect(layer?.detail).toContain('0 available');
  });
});
