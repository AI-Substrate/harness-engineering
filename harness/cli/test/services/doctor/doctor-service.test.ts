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
import type { RegisteredSensor, VerbRegistry } from '../../../src/services/extensions/registry.js';
import { commitGuidanceBlock } from '../../../src/services/instructions/commit-guidance.js';
import { buildRecordRegistry, coreRecordTypes } from '../../../src/services/record/registry.js';

const ALL_TOOLS = { node: '/usr/bin/node', just: '/usr/bin/just', biome: '/usr/bin/biome' };
// Dev-mode seed (FX001): the tsconfig marker makes checkCliBuild treat the fake tree as
// the harness's home; dist present → built. Without the marker the tree reads as a consumer.
// plan 074 · ac-0008 — a repo whose AGENTS.md already carries the managed
// commit-guidance block, so "every layer is ready" keeps meaning what it meant.
// The dedicated commit-guidance cases below seed the absent/stale shapes.
const BUILT_CLI = {
  'harness/cli/tsconfig.json': '{}',
  'harness/cli/dist/index.js': '// built',
  '/repo/AGENTS.md': `${commitGuidanceBlock()}\n`,
};

const mkVerb = (name: string): HarnessVerb => ({
  name,
  summary: `${name} verb`,
  run: () => ({ status: 'ok' }),
});

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    fs: over.fs ?? new FakeFs(BUILT_CLI),
    proc: over.proc ?? new FakeProcess(ALL_TOOLS, '/repo'),
    git: over.git ?? new FakeGit({ isRepo: true, branch: 'main' }),
    // plan 074 · ac-0004 — capture-liveness is GATED on capture being enabled,
    // so a healthy baseline must opt in. A default (capture-off) env now
    // correctly reports could-not-determine; that is asserted on its own below.
    env: over.env ?? new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }),
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
    // Consumer clone: no harness/cli/, but an ADOPTED repo carries the managed
    // commit-guidance block — the assertion here is that no OTHER layer degrades.
    const fs = new FakeFs({ '/repo/AGENTS.md': `${commitGuidanceBlock()}\n` });
    const report = buildDoctorReport(deps({ fs }), EMPTY);
    const layer = report.layers.find((l) => l.name === 'cli-build');
    expect(layer?.ok).toBe(true);
    expect(layer?.detail).toMatch(/consumer/);
    expect(layer?.next_action).toBeUndefined();
    const env = doctorEnvelope(report, new FakeClock('2026-06-08T07:20:00.000Z'));
    expect(env.status).toBe('ok');
  });

  it('version-skew: dev repo, running version matches repo package.json → ok', () => {
    /*
    Test Doc:
    - Why: field report 2026-07-04 — npm latest lagged the repo head, so reinstalls silently
      DOWNGRADED consumers (osk ran 0.6.0 against 0.7.0 doctrine: stale flow renders,
      old-schema telemetry). The layer makes the shadow visible at the first doctor run.
    - Contract: dev marker + runningVersion == repo package.json version → ok:true.
    */
    const fs = new FakeFs({ ...BUILT_CLI, 'package.json': '{"version":"0.7.0"}' });
    const report = buildDoctorReport({ ...deps({ fs }), runningVersion: '0.7.0' }, EMPTY);
    const layer = report.layers.find((l) => l.name === 'version-skew');
    expect(layer?.ok).toBe(true);
    expect(layer?.detail).toContain('matches the repo');
  });

  it('version-skew: dev repo, stale global binary (running < repo) → not-ok, npm link next_action, envelope degraded', () => {
    const fs = new FakeFs({ ...BUILT_CLI, 'package.json': '{"version":"0.7.0"}' });
    const report = buildDoctorReport({ ...deps({ fs }), runningVersion: '0.6.0' }, EMPTY);
    const layer = report.layers.find((l) => l.name === 'version-skew');
    expect(layer?.ok).toBe(false);
    expect(layer?.detail).toContain('running harness 0.6.0 but this repo is 0.7.0');
    expect(layer?.next_action).toContain('npm link');
    const env = doctorEnvelope(report, new FakeClock('2026-06-08T07:20:00.000Z'));
    expect(env.status).toBe('degraded');
  });

  it('version-skew: consumer install (no dev marker) → ok n/a; missing runningVersion → ok skipped', () => {
    const consumer = buildDoctorReport(
      { ...deps({ fs: new FakeFs() }), runningVersion: '0.6.0' },
      EMPTY,
    );
    const consumerLayer = consumer.layers.find((l) => l.name === 'version-skew');
    expect(consumerLayer?.ok).toBe(true);
    expect(consumerLayer?.detail).toMatch(/consumer/);

    const noVersion = buildDoctorReport(
      deps({ fs: new FakeFs({ ...BUILT_CLI, 'package.json': '{"version":"0.7.0"}' }) }),
      EMPTY,
    );
    const skipped = noVersion.layers.find((l) => l.name === 'version-skew');
    expect(skipped?.ok).toBe(true);
    expect(skipped?.detail).toContain('skipped');
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

  it('dev mode flags a missing tool with a next_action', () => {
    // Dev mode: default deps fs = BUILT_CLI (has the harness/cli/tsconfig.json
    // marker), so the full DEV_TOOLS set (node/just/biome) is enforced.
    const proc = new FakeProcess({ node: '/usr/bin/node' });
    const report = buildDoctorReport(deps({ proc }), EMPTY);
    const toolchain = report.layers.find((l) => l.name === 'toolchain');
    expect(toolchain?.ok).toBe(false);
    expect(toolchain?.detail).toContain('just');
  });

  it('toolchain consumer mode: node-only, no just/biome enforced (FIND-2 twin)', () => {
    /*
    Test Doc:
    - Why: `just`/`biome` are THIS repo's dev tools. A consumer clone (no
      harness/cli/tsconfig.json marker) must NOT be told to install them — the
      same dev-vs-consumer split FX001 made for cli-build, one layer over. What
      "ready" means for the consumer's own toolchain is the boot extension's
      per-repo job (constitution P10 — the core hardcodes no repo tool list).
    - Contract: marker absent + only `node` on PATH → toolchain ok:true, detail
      mentions `consumer`, names neither just nor biome, carries no next_action,
      and the whole envelope is not degraded by it.
    - Quality Contribution: pins that the core stops enforcing a foreign toolchain.
    */
    const fs = new FakeFs({ '/repo/AGENTS.md': `${commitGuidanceBlock()}\n` }); // consumer clone — no dev marker
    const proc = new FakeProcess({ node: '/usr/bin/node' }); // just/biome absent
    const report = buildDoctorReport(deps({ fs, proc }), EMPTY);
    const toolchain = report.layers.find((l) => l.name === 'toolchain');
    expect(toolchain?.ok).toBe(true);
    expect(toolchain?.detail).toMatch(/consumer/);
    expect(toolchain?.detail).not.toMatch(/just|biome/);
    expect(toolchain?.next_action).toBeUndefined();
    const env = doctorEnvelope(report, new FakeClock('2026-06-08T07:20:00.000Z'));
    expect(env.status).toBe('ok');
  });

  it('toolchain consumer mode still flags a genuinely missing node', () => {
    const fs = new FakeFs(); // consumer clone
    const proc = new FakeProcess({ just: '/usr/bin/just' }); // node absent
    const report = buildDoctorReport(deps({ fs, proc }), EMPTY);
    const toolchain = report.layers.find((l) => l.name === 'toolchain');
    expect(toolchain?.ok).toBe(false);
    expect(toolchain?.detail).toContain('node');
    expect(toolchain?.next_action).toContain('node');
  });

  it('node-runtime: an old running Node degrades the layer with an upgrade next_action (plan 031)', () => {
    /*
    Test Doc:
    - Why: engines.node ">=22" is only advisory — npx won't enforce it. The runtime guard
      catches an actually-old interpreter, which breaks the Windows .cmd launch path (a bare
      .cmd spawn EINVALs on <20.12.2; the CLI standardises on >=22).
    - Contract: process.versions.node major < 22 → node-runtime layer ok:false with a clear
      "upgrade to Node >=22" next_action; an unparseable version is treated as ok (no false alarm).
    - Worked Example: FakeProcess reporting node 20.11.0 → node-runtime not ok, next_action names 22.
    */
    const proc = new FakeProcess({ node: '/usr/bin/node' }, '/repo', '20.11.0');
    const report = buildDoctorReport(deps({ proc }), EMPTY);
    const runtime = report.layers.find((l) => l.name === 'node-runtime');
    expect(runtime?.ok).toBe(false);
    expect(runtime?.detail).toContain('20.11.0');
    expect(runtime?.next_action).toContain('>=22');
  });

  it('node-runtime: a patched >=22 Node reports ok (plan 031)', () => {
    const proc = new FakeProcess({ node: '/usr/bin/node' }, '/repo', '22.7.0');
    const report = buildDoctorReport(deps({ proc }), EMPTY);
    const runtime = report.layers.find((l) => l.name === 'node-runtime');
    expect(runtime?.ok).toBe(true);
    expect(runtime?.detail).toContain('22.7.0');
  });

  it('reads HARNESS_JSON via the env port into json_env', () => {
    const env = new FakeEnv({ HARNESS_JSON: '1' });
    const report = buildDoctorReport(deps({ env }), EMPTY);
    expect(report.json_env).toBe(true);
    expect(env.gets).toContain('HARNESS_JSON');
  });
});

describe('doctorEnvelope', () => {
  it('keeps the default JSON bytes unchanged and slims only the quiet extension payload', () => {
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    const report = {
      layers: [{ name: 'extensions', ok: true, detail: '1 loaded, 0 failed, 0 conflict' }],
      branch: 'main',
      json_env: false,
      extensions: [
        {
          entryPath: '/repo/.harness/extensions/demo/extension.ts',
          status: 'loaded' as const,
          verbs: [
            {
              name: 'demo',
              summary: 'Verbose summary.',
              description: 'Verbose description.',
              options: [{ flags: '--value <value>', description: 'Verbose option.' }],
              run: () => ({ status: 'ok' as const }),
            },
          ],
        },
      ],
      conventions: [],
      recordTypes: [],
    };

    expect(JSON.stringify(doctorEnvelope(report, clock))).toBe(
      '{"command":"doctor","status":"ok","timestamp":"2026-06-08T07:20:00.000Z","data":{"layers":[{"name":"extensions","ok":true,"detail":"1 loaded, 0 failed, 0 conflict"}],"branch":"main","json_env":false,"extensions":[{"entryPath":"/repo/.harness/extensions/demo/extension.ts","status":"loaded","verbs":[{"name":"demo","summary":"Verbose summary.","description":"Verbose description.","options":[{"flags":"--value <value>","description":"Verbose option."}]}]}],"conventions":[],"recordTypes":[]},"evidence":[{"label":"doctor report","none":true}]}',
    );

    expect(doctorEnvelope(report, clock, true).data).toEqual({
      layers: [{ name: 'extensions', ok: true }],
      branch: 'main',
      extensions: [{ name: 'demo', status: 'loaded', verbs: ['demo'] }],
    });
  });

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
      { entryPath: '/x/boot/extension.ts', status: 'loaded', verbs: [mkVerb('boot')] },
      { entryPath: '/x/checks/extension.ts', status: 'loaded', verbs: [mkVerb('checks')] },
    ]);
    const fs = new FakeFs({
      ...BUILT_CLI,
      '/x/hello/instructions.md': '# Hello',
      '/x/boot/instructions.md': '# Boot',
      '/x/checks/instructions.md': '# Checks',
    });
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

  it('renders authoring format and non-failing v2 loader info explicitly', () => {
    const reg = registry([
      {
        entryPath: '/repo/.harness/extensions/sample/extension.ts',
        status: 'loaded',
        verbs: [mkVerb('sample')],
        format: 'v2 (api 2)',
        sensors: [{ name: 'lint', summary: 'Lint status' }],
        customItems: [{ type: 'migration', name: 'users', summary: 'Migrate users' }],
        info: ['verbs.sample.futureField: unknown field tolerated (doctor info)'],
      },
    ]);
    const text = renderDoctorText(buildDoctorReport(deps(), reg));
    expect(text).toContain('format: v2 (api 2)');
    expect(text).toContain('lint (sensor)');
    expect(text).toContain('migration.users (custom)');
    expect(text).toContain('verbs.sample.futureField');
  });
});

describe('package-convention validation (plan 014 D2)', () => {
  const FLOW = '/repo/.harness/extensions/flow';

  it('an extension carrying instructions.md gets a clean bill — layer ok, envelope ok', () => {
    const reg = registry([
      { entryPath: `${FLOW}/extension.ts`, status: 'loaded', verbs: [mkVerb('flow')] },
      {
        entryPath: '/repo/.harness/extensions/boot/extension.ts',
        status: 'loaded',
        verbs: [mkVerb('boot')],
      },
      {
        entryPath: '/repo/.harness/extensions/checks/extension.ts',
        status: 'loaded',
        verbs: [mkVerb('checks')],
      },
    ]);
    const fs = new FakeFs({
      ...BUILT_CLI,
      [`${FLOW}/instructions.md`]: '# Flow briefing',
      '/repo/.harness/extensions/boot/instructions.md': '# Boot',
      '/repo/.harness/extensions/checks/instructions.md': '# Checks',
    });
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
    expect(report.conventions[0]?.next_action).toContain(
      'author .harness/extensions/flow/instructions.md',
    );
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
    expect(text).toContain('author .harness/extensions/flow/instructions.md');
    expect(text).toContain('unsupported flat layout — move to legacy/extension.ts');
  });
});

describe('temp-hygiene convention check (plan 015 D5, AC-6)', () => {
  const FLOW = '/repo/.harness/extensions/flow';

  /** A tree whose `.harness/temp/` exists WITHOUT its nested .gitignore. */
  function unprotectedTempFs(extra: Record<string, string> = {}): FakeFs {
    const fs = new FakeFs({ ...BUILT_CLI, ...extra });
    fs.mkdirp('/repo/.harness/temp');
    return fs;
  }

  it('temp dir without its nested .gitignore → complaint + next_action + overall degraded (exit 0)', () => {
    /*
    Test Doc:
    - Why: the transient storage class (.harness/temp/) is only safe while its nested
      self-.gitignore exists; doctor must PROVE the protection is in place instead of the
      old skill's prose claim (spec AC-6). Same wail semantics as E144: a complaint with a
      prescription, degraded, exit 0 — never a refusal.
    - Contract: fs.exists(temp) && !fs.exists(temp/.gitignore) → one conventions[] entry
      naming the missing file with a restore next_action; the extensions layer flips !ok;
      envelope degraded, exit 0.
    */
    const report = buildDoctorReport(deps({ fs: unprotectedTempFs() }), EMPTY);
    const complaint = report.conventions.find((c) => c.folder.includes('.harness/temp'));
    expect(complaint?.detail).toContain('.gitignore');
    expect(complaint?.next_action).toContain('.harness/temp/.gitignore');
    expect(complaint?.next_action).toContain('harness observe');
    const ext = report.layers.find((l) => l.name === 'extensions');
    expect(ext?.ok).toBe(false);
    const env = doctorEnvelope(report, new FakeClock('2026-06-10T00:00:00.000Z'));
    expect(env.status).toBe('degraded');
    expect(exitCodeFor(env)).toBe(0);
  });

  it('fires alongside loaded extensions too (complaint coexists with a clean package)', () => {
    const reg = registry([
      { entryPath: `${FLOW}/extension.ts`, status: 'loaded', verbs: [mkVerb('flow')] },
    ]);
    const fs = unprotectedTempFs({ [`${FLOW}/instructions.md`]: '# Flow briefing' });
    const report = buildDoctorReport(deps({ fs }), reg);
    expect(report.conventions).toHaveLength(1);
    expect(report.conventions[0]?.folder).toContain('.harness/temp');
    expect(report.layers.find((l) => l.name === 'extensions')?.ok).toBe(false);
  });

  it('protection present → no complaint, layer ok', () => {
    const fs = new FakeFs({ ...BUILT_CLI, '/repo/.harness/temp/.gitignore': '*\n' });
    fs.mkdirp('/repo/.harness/temp');
    const report = buildDoctorReport(deps({ fs }), EMPTY);
    expect(report.conventions).toEqual([]);
    expect(report.layers.find((l) => l.name === 'extensions')?.ok).toBe(true);
    expect(doctorEnvelope(report, new FakeClock('2026-06-10T00:00:00.000Z')).status).toBe('ok');
  });

  it('no temp dir yet → ok; no .harness/ at all → existing doctor output unchanged', () => {
    // No temp dir (and no .harness at all) — the probe stays silent.
    const report = buildDoctorReport(deps(), EMPTY);
    expect(report.conventions).toEqual([]);
    expect(report.layers.find((l) => l.name === 'extensions')?.ok).toBe(true);
    expect(doctorEnvelope(report, new FakeClock('2026-06-10T00:00:00.000Z')).status).toBe('ok');
  });

  it('renders the temp complaint in the text view (the prescription must be visible, P7)', () => {
    const text = renderDoctorText(buildDoctorReport(deps({ fs: unprotectedTempFs() }), EMPTY));
    expect(text).toContain('.gitignore');
    expect(text).toContain('create .harness/temp/.gitignore');
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
    // 4 core (retro + harness-bypass + harness-change + segment) + 1 extension.
    expect(layer?.detail).toContain('5 available');
    expect(layer?.detail).toContain('4 core');
    expect(layer?.detail).toContain('1 extension');
    expect(report.recordTypes.map((t) => t.type)).toEqual([
      'retro',
      'harness-bypass',
      'harness-change',
      'segment',
      'dev-survey',
    ]);

    const text = renderDoctorText(report);
    expect(text).toContain('record-types');
    expect(text).toContain('retro [core]');
    expect(text).toContain('harness-bypass [core]');
    expect(text).toContain('harness-change [core]');
    expect(text).toContain('dev-survey [extension] .harness/extensions/dev-survey.record.ts');
  });

  it('without a record registry shows zero record types (back-compat 2-arg call)', () => {
    const report = buildDoctorReport(deps(), EMPTY);
    const layer = report.layers.find((l) => l.name === 'record-types');
    expect(layer?.detail).toContain('0 available');
  });
});

describe('quality-gate layer (the boot + checks nucleus, ships in core)', () => {
  /*
  Test Doc:
  - Why: the mandated quality gate (`checks`) and its composer (`boot`) are the harness
    nucleus, but our own boot/checks extensions DON'T ship (only `harness/cli/dist` does).
    So the "you have no gate" nudge must live in core doctor to fire on EVERY machine,
    regardless of which extensions a repo authored.
  - Contract: a declarative verb-name lookup (no handler invoked, P7) — both present => ok;
    a repo with extensions but missing boot/checks => degraded (exit 0, advisory) with a
    `harness new …` next_action; a pristine repo (zero extensions) stays ok (don't pile a
    second degrade onto a fresh clone — the gate is an adoption deliverable).
  */
  const mkExt = (name: string): ExtensionRecord => ({
    entryPath: `/repo/.harness/extensions/${name}/extension.ts`,
    status: 'loaded',
    verbs: [mkVerb(name)],
  });
  const withInstr = (...names: string[]): FakeFs =>
    new FakeFs({
      ...BUILT_CLI,
      ...Object.fromEntries(
        names.map((n) => [`/repo/.harness/extensions/${n}/instructions.md`, `# ${n}`]),
      ),
    });

  it('boot + checks both present → layer ok', () => {
    const reg = registry([mkExt('boot'), mkExt('checks')]);
    const report = buildDoctorReport(deps({ fs: withInstr('boot', 'checks') }), reg);
    const layer = report.layers.find((l) => l.name === 'quality-gate');
    expect(layer?.ok).toBe(true);
    expect(layer?.detail).toMatch(/boot.*checks.*present/);
  });

  it('checks missing (boot present) → degraded with a `harness new checks` next_action, exit 0', () => {
    const reg = registry([mkExt('boot')]);
    const report = buildDoctorReport(deps({ fs: withInstr('boot') }), reg);
    const layer = report.layers.find((l) => l.name === 'quality-gate');
    expect(layer?.ok).toBe(false);
    expect(layer?.detail).toContain('checks');
    expect(layer?.next_action).toContain('harness new checks');
    const env = doctorEnvelope(report, new FakeClock('2026-06-10T00:00:00.000Z'));
    expect(env.status).toBe('degraded');
    expect(exitCodeFor(env)).toBe(0);
  });

  it('both missing (repo has other extensions) → degraded naming boot + checks', () => {
    const reg = registry([mkExt('hello')]);
    const report = buildDoctorReport(deps({ fs: withInstr('hello') }), reg);
    const layer = report.layers.find((l) => l.name === 'quality-gate');
    expect(layer?.ok).toBe(false);
    expect(layer?.next_action).toContain('harness new checks');
    expect(layer?.next_action).toContain('harness new boot');
  });

  it('pristine repo (no extensions yet) → ok, stays quiet (the gate is an adoption deliverable)', () => {
    const report = buildDoctorReport(deps(), EMPTY);
    const layer = report.layers.find((l) => l.name === 'quality-gate');
    expect(layer?.ok).toBe(true);
    expect(doctorEnvelope(report, new FakeClock('2026-06-10T00:00:00.000Z')).status).toBe('ok');
  });
});

describe('sensor-watcher check (plan 059 follow-up — the live-scanner nudge)', () => {
  /*
  Test Doc:
  - Why: sensors only stay fresh while the headless watcher runs and heartbeats. A repo that
    registered sensors but has no running watcher would silently serve stale/absent readings;
    doctor must surface that at session start with the three usage instructions a caller needs —
    start+restart the watcher, how an agent reads sensors, how a human views them (field-requested
    2026-07-16). NEVER runs a sensor (P7); reuses SensorStateStore.readDaemon so the liveness
    definition can't drift from the watcher's own.
  - Contract: sensors registered + no live heartbeat → sensor-watcher !ok (degraded, exit 0) with a
    next_action naming `harness sensors watch`, restart-after-extension, `harness sensors --json`,
    and the interactive TUI; a live heartbeat (<15s) → ok naming the pid; zero sensors → ok, quiet.
  */
  const DAEMON = '/repo/.harness/temp/sensors/daemon.json';
  const mkSensor = (name: string): RegisteredSensor => ({
    name,
    extension: name,
    entryPath: `/repo/.harness/extensions/${name}/extension.ts`,
    declaration: { summary: `${name} sensor`, run: () => ({ state: 'pass' as const }) },
  });
  const withSensors = (...names: string[]): VerbRegistry => ({
    verbs: [],
    records: [],
    sensors: names.map(mkSensor),
  });
  const daemonFile = (heartbeatAt: string): string =>
    JSON.stringify({
      schema: 1,
      pid: 4242,
      startedAt: '2026-06-08T07:00:00.000Z',
      heartbeatAt,
      version: '0.12.0',
    });
  const layer = (r: ReturnType<typeof buildDoctorReport>) =>
    r.layers.find((l) => l.name === 'sensor-watcher');

  it('sensors registered but watcher not running → degraded with the three usage instructions (exit 0)', () => {
    const report = buildDoctorReport(deps(), withSensors('tests', 'lint'));
    const l = layer(report);
    expect(l?.ok).toBe(false);
    expect(l?.detail).toContain('2 sensor(s) registered');
    expect(l?.detail).toContain('not running');
    // a) start the watcher + WHEN to restart it (adding/changing an extension)
    expect(l?.next_action).toContain('harness sensors watch');
    expect(l?.next_action).toMatch(/restart/i);
    expect(l?.next_action).toMatch(/extension|sensor/i);
    // b) how an agent reads sensors
    expect(l?.next_action).toContain('harness sensors --json');
    // c) how a human views sensors
    expect(l?.next_action).toContain('interactive TUI');
    const env = doctorEnvelope(report, new FakeClock('2026-06-08T07:20:00.000Z'));
    expect(env.status).toBe('degraded');
    expect(exitCodeFor(env)).toBe(0);
  });

  it('sensors registered AND a live heartbeat (within 15s) → ok, names the running pid', () => {
    const fs = new FakeFs({ ...BUILT_CLI, [DAEMON]: daemonFile('2026-06-08T07:19:55.000Z') });
    const report = buildDoctorReport(deps({ fs }), withSensors('tests'));
    const l = layer(report);
    expect(l?.ok).toBe(true);
    expect(l?.detail).toContain('running');
    expect(l?.detail).toContain('4242');
  });

  it('a stale heartbeat (older than the 15s liveness window) reads as not running → degraded', () => {
    const fs = new FakeFs({ ...BUILT_CLI, [DAEMON]: daemonFile('2026-06-08T07:00:00.000Z') });
    const report = buildDoctorReport(deps({ fs }), withSensors('tests'));
    expect(layer(report)?.ok).toBe(false);
  });

  it('no sensors registered → ok, stays quiet (the feature does not apply to this repo)', () => {
    const report = buildDoctorReport(deps(), EMPTY);
    const l = layer(report);
    expect(l?.ok).toBe(true);
    expect(l?.detail).toMatch(/no sensors/i);
    expect(l?.next_action).toBeUndefined();
    expect(doctorEnvelope(report, new FakeClock('2026-06-08T07:20:00.000Z')).status).toBe('ok');
  });

  it('renders the sensor-watcher row + prescription in the text view (P7)', () => {
    const text = renderDoctorText(buildDoctorReport(deps(), withSensors('tests')));
    expect(text).toContain('sensor-watcher');
    expect(text).toContain('harness sensors watch');
  });
});

// ---------------------------------------------------------------------------
// dd-documents layer (plan 065 T003 — AC-07's CONSUMER half).
// ---------------------------------------------------------------------------

const DD_DOC = JSON.stringify({
  dd: { schema: 'builder/plan' },
  sections: [{ name: 'meta', value: { title: 'x' } }],
});

function ddLayer(files: Record<string, string>, dirs: Record<string, string[]>) {
  const report = buildDoctorReport(
    deps({ fs: new FakeFs({ ...BUILT_CLI, ...files }, dirs) }),
    EMPTY,
  );
  const layer = report.layers.find((entry) => entry.name === 'dd-documents');
  if (!layer) throw new Error('dd-documents layer missing');
  return layer;
}

describe('doctor — the standalone dd CLI layer (plan 080 tk-000e)', () => {
  function ddCliLayer(files: Record<string, string>, dirs: Record<string, string[]>) {
    const report = buildDoctorReport(
      deps({ fs: new FakeFs({ ...BUILT_CLI, ...files }, dirs) }),
      EMPTY,
    );
    const layer = report.layers.find((entry) => entry.name === 'dd-cli');
    if (!layer) throw new Error('dd-cli layer missing');
    return layer;
  }

  const USING_DD = {
    files: { '/repo/docs/plan.dd.json': DD_DOC, '/repo/docs/plan.dd.md': '# rendered' },
    dirs: { '/repo': ['docs'], '/repo/docs': ['plan.dd.json', 'plan.dd.md'] },
  };

  it('warns, non-fatally, when a repo that USES dd has no standalone CLI', () => {
    const layer = ddCliLayer(USING_DD.files, USING_DD.dirs);
    expect(layer.ok).toBe(false);
    expect(layer.detail).toContain('standalone dd CLI not found');
    expect(layer.next_action).toBeDefined();
  });

  it('stays silent in a repo that does not use dd at all', () => {
    // Proportionality: a missing OPTIONAL cli is not a finding where it cannot
    // bite. Without this the layer would degrade every consumer repo's doctor
    // for lacking a tool it has no documents for — the same nagging the
    // dd-documents row refuses.
    const layer = ddCliLayer({}, { '/repo': ['README.md'] });
    expect(layer.ok).toBe(true);
    expect(layer.next_action).toBeUndefined();
  });

  it('is silent when the standalone CLI is installed', () => {
    const layer = ddCliLayer(
      { '/repo/node_modules/.bin/ddocs': '#!/usr/bin/env node' },
      { '/repo': ['node_modules'] },
    );
    expect(layer.ok).toBe(true);
    expect(layer.next_action).toBeUndefined();
  });

  it('names the two spellings that run a DIFFERENT program', () => {
    // The reason this layer exists at all. `dd` is coreutils on every POSIX box
    // and an unrelated `dd` package exists on npm, so a next_action that merely
    // said "install dd" would send a reader to one of two wrong programs — the
    // npx one silently. The warning must name both, or it is worse than absent.
    const layer = ddCliLayer(USING_DD.files, USING_DD.dirs);
    expect(layer.next_action).toContain('node_modules/.bin/ddocs');
    expect(layer.next_action).toContain('coreutils');
    expect(layer.next_action).toContain('npx dd');
  });

  it('does NOT report present merely because coreutils dd is on PATH', () => {
    // The false-green this layer is built to avoid: a PATH probe finds /bin/dd
    // on every POSIX host, so `which` would report our CLI present everywhere,
    // forever. The probe looks for the installed bin instead — this test fails
    // the moment someone "simplifies" it back to proc.which('dd').
    const layer = ddCliLayer(USING_DD.files, USING_DD.dirs);
    expect(layer.ok).toBe(false);
  });
});

describe('doctor — the shipped dd layer', () => {
  it('stays silent and ok in a repository that does not use dd', () => {
    // Same posture as the quality-gate and telemetry rows: never nag a repo the
    // feature does not apply to.
    const layer = ddLayer({}, { '/repo': ['README.md'] });
    expect(layer.ok).toBe(true);
    expect(layer.detail).toContain('dd not in use');
    expect(layer.next_action).toBeUndefined();
  });

  it('reports health when every document has its rendered sibling', () => {
    const layer = ddLayer(
      { '/repo/docs/plan.dd.json': DD_DOC, '/repo/docs/plan.dd.md': '# rendered' },
      { '/repo': ['docs'], '/repo/docs': ['plan.dd.json', 'plan.dd.md'] },
    );
    expect(layer.ok).toBe(true);
    expect(layer.detail).toContain('1 deterministic document(s)');
    // The deep answer belongs to the sweep, and this row says so rather than
    // pretending to have run it (P7 — doctor never invokes).
    expect(layer.detail).toContain('node_modules/.bin/ddocs doctor');
  });

  it('fails a document committed without its rendered sibling', () => {
    const layer = ddLayer(
      { '/repo/docs/plan.dd.json': DD_DOC },
      { '/repo': ['docs'], '/repo/docs': ['plan.dd.json'] },
    );
    expect(layer.ok).toBe(false);
    expect(layer.detail).toContain('no rendered sibling');
    expect(layer.detail).toContain('docs/plan.dd.json');
    expect(layer.next_action).toContain('node_modules/.bin/ddocs build');
  });

  it('honours the sweep exclusion contract instead of re-deriving it', () => {
    // A known-bad fixture and a sweep_exclude document are not missing a render;
    // they are deliberately not participating (AC-15). Neither may redden a row.
    const excluded = JSON.stringify({
      dd: { schema: 'builder/plan', sweep_exclude: true },
      sections: [{ name: 'meta', value: { title: 'x' } }],
    });
    const layer = ddLayer(
      {
        '/repo/test/fixtures/bad.dd.json': DD_DOC,
        '/repo/docs/opted-out.dd.json': excluded,
      },
      {
        '/repo': ['docs', 'test'],
        '/repo/docs': ['opted-out.dd.json'],
        '/repo/test': ['fixtures'],
        '/repo/test/fixtures': ['bad.dd.json'],
      },
    );
    expect(layer.ok).toBe(true);
    expect(layer.detail).toContain('dd not in use');
  });

  it('reports an enumeration failure rather than an empty, clean-looking corpus', () => {
    // P2's F002 lesson, applied to a doctor row: a port that cannot look must
    // never read as a tree that holds nothing.
    const failing = new FakeFs({ ...BUILT_CLI });
    failing.readdir = () => {
      const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    };
    const report = buildDoctorReport(deps({ fs: failing }), EMPTY);
    const layer = report.layers.find((entry) => entry.name === 'dd-documents');
    expect(layer?.ok).toBe(false);
    expect(layer?.detail).toContain('could not be enumerated');
  });
});

/**
 * The collector row's fail-safe contract (packet 3c/§5 case 4).
 *
 * "Failure must not break things" is a claim, so it is exercised by injecting the
 * fault rather than by reading the code. The specific hazard: `doctor` builds all
 * its layers in ONE array literal, so a throw inside any layer escapes the whole
 * report — and this is the row backed by on-disk state written by ANOTHER program
 * (git-ai), on a verb that runs for people who never opted into telemetry.
 *
 * MEASURED BEFORE THE GUARD EXISTED: a single throwing `fs.exists` on a `.git-ai`
 * path produced NO ENVELOPE AT ALL — not a degraded row, not a failed layer. The
 * entire verb died. These tests are red against that code.
 */
describe('doctor — the collector row degrades, it does not take the verb down', () => {
  function throwingCollectorFs(message = 'EIO: collector state unreadable'): FakeFs {
    const fs = new FakeFs(BUILT_CLI);
    const passthrough = fs.exists.bind(fs);
    (fs as unknown as { exists: (p: string) => boolean }).exists = (p: string) => {
      if (p.includes('.git-ai')) throw new Error(message);
      return passthrough(p);
    };
    return fs;
  }

  const HOST = { platform: 'darwin', arch: 'arm64', home: '/home/u' };

  // NOTE: the shared `deps()` helper enumerates the fields it forwards, so an
  // unknown key like `collectorHost` is silently DROPPED. That produced a
  // vacuous pass here — a test comparing two runs that both had no collector
  // row at all. Build the deps explicitly so the row is genuinely present.
  const withCollector = (fs: FakeFs): DoctorDeps =>
    ({ ...deps({ fs }), collectorHost: HOST }) as DoctorDeps;

  it('an unreadable collector state costs the ROW, never the envelope', () => {
    const env = runDoctor(withCollector(throwingCollectorFs()), EMPTY);

    // The verb completed and still reports.
    expect(env.command).toBe('doctor');
    const layers = (env.data as { layers?: { name: string; ok: boolean; detail: string }[] })
      ?.layers;
    const row = layers?.find((l) => l.name === 'gitai-collector');
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain('could-not-determine');
    expect(row?.detail).toContain('EIO: collector state unreadable');
  });

  it('every OTHER row still prints — the failure is contained to one layer', () => {
    const healthy = runDoctor(withCollector(new FakeFs(BUILT_CLI)), EMPTY);
    const broken = runDoctor(withCollector(throwingCollectorFs()), EMPTY);

    const names = (e: typeof healthy): string[] =>
      ((e.data as { layers?: { name: string }[] })?.layers ?? []).map((l) => l.name);

    // Non-vacuous: the row must actually be present in both runs, or this
    // comparison proves nothing (it passed vacuously before `collectorHost`
    // was forwarded).
    expect(names(healthy)).toContain('gitai-collector');
    expect(names(broken)).toContain('gitai-collector');
    // Same rows, same order. Only the collector row's verdict changed.
    expect(names(broken)).toEqual(names(healthy));
    expect(names(broken).length).toBeGreaterThan(1);
  });

  it('a failed reading is never reported as healthy — absent evidence is not good news', () => {
    const env = runDoctor(withCollector(throwingCollectorFs()), EMPTY);
    const row = (
      env.data as { layers?: { name: string; ok: boolean; next_action?: string }[] }
    )?.layers?.find((l) => l.name === 'gitai-collector');

    expect(row?.ok).toBe(false);
    // and it says what is unaffected, so the operator is not left guessing scope
    expect(row?.next_action).toContain('every other row above is unaffected');
  });
});

/**
 * Whole-report containment (Jordan's ruling): a throw ANYWHERE in the report
 * costs its row, never the verb.
 *
 * The collector row above proved the mechanism for one layer. These pin it for
 * the rest — including the three sites that are NOT layers and therefore cannot
 * use `safeLayer`:
 *
 *   - `checkConventions`, computed before the array and feeding `checkExtensions`
 *   - `deps.git.isRepo()/currentBranch()`, read after the array
 *   - `deps.env.get('HARNESS_JSON')`, likewise
 *
 * The last two were found by INJECTION, not by reading: with all fifteen layers
 * wrapped, poisoning `git` or `env` still killed the verb outright. Nothing in
 * the layer inventory pointed at them. That is why the ruling asked for the
 * fault to be injected per-dependency rather than reasoned about per-layer.
 */
describe('doctor — no single failure can take the verb down', () => {
  const HOST = { platform: 'darwin', arch: 'arm64', home: '/home/u' };

  /** Every method of `obj` throws — the bluntest available fault. */
  function poison<T extends object>(obj: T, label: string): T {
    return new Proxy(obj, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        return typeof v === 'function'
          ? () => {
              throw new Error(`POISON(${label}.${String(prop)})`);
            }
          : v;
      },
    });
  }

  function reportWith(over: Record<string, unknown>) {
    return buildDoctorReport(
      { ...deps(), collectorHost: HOST, ...over } as unknown as DoctorDeps,
      EMPTY,
    );
  }

  it.each([
    'fs',
    'proc',
    'git',
    'env',
    'clock',
  ])('a totally unusable %s port still produces a report', (port) => {
    const base = { ...deps(), collectorHost: HOST } as unknown as Record<string, unknown>;
    const report = reportWith({ [port]: poison(base[port] as object, port) });

    // The verb survived and still enumerates every row it would normally.
    expect(report.layers.length).toBeGreaterThan(10);
    // No row silently claims to be fine on the strength of a failed read.
    for (const layer of report.layers) {
      if (layer.detail.includes('failed while running')) expect(layer.ok).toBe(false);
    }
  });

  it('a throwing git port degrades the branch to null rather than killing the verb', () => {
    // Found by injection: this read sits AFTER the layer array, so wrapping all
    // fifteen layers did not cover it and the verb still died.
    const base = { ...deps(), collectorHost: HOST } as unknown as Record<string, unknown>;
    const report = reportWith({ git: poison(base.git as object, 'git') });
    expect(report.branch).toBeNull();
    expect(report.layers.length).toBeGreaterThan(10);
  });

  it('a throwing env port degrades json_env to false rather than killing the verb', () => {
    const base = { ...deps(), collectorHost: HOST } as unknown as Record<string, unknown>;
    const report = reportWith({ env: poison(base.env as object, 'env') });
    expect(report.json_env).toBe(false);
    expect(report.layers.length).toBeGreaterThan(10);
  });

  it('a failed convention scan is NOT reported as "no complaints"', () => {
    // The subtle one. `conventions` degrades to `[]` on a throw, and an empty
    // list otherwise READS as "scanned, nothing wrong" — good news we did not
    // establish. The extensions row must carry the failure instead.
    const base = { ...deps(), collectorHost: HOST } as unknown as Record<string, unknown>;
    const report = reportWith({ fs: poison(base.fs as object, 'fs') });
    const extensions = report.layers.find((l) => l.name === 'extensions');
    expect(extensions?.ok).toBe(false);
    expect(extensions?.detail).toContain('convention scan failed');
  });
});

/**
 * #144 — the Cursor sandbox row as a LAYER (the 18th `safeLayer` site).
 *
 * The module's own behaviour is covered in `collector/cursor-sandbox.test.ts`.
 * What is pinned here is the wiring: that it appears only when warranted, that
 * it degrades rather than gates, and that a throw inside it costs the row and
 * not the verb.
 */
describe('doctor — cursor-sandbox row wiring', () => {
  const HOST = { platform: 'darwin', arch: 'arm64', home: '/home/u' };
  const PERMS = '/home/u/.cursor/permissions.json';

  function withCursor(permissions?: string, marker = true): DoctorDeps {
    const seed: Record<string, string> = { ...BUILT_CLI };
    if (permissions !== undefined) seed[PERMS] = permissions;
    const fs = new FakeFs(seed);
    // `mkdirp`, NOT the `dirs` constructor arg: `FakeFs.exists` consults
    // `files`/`byteFiles`/`madeDirs` and ignores `dirs`, so seeding the latter
    // registers no marker and every "no row" assertion passes vacuously. That
    // is exactly how the first draft of these tests was green and meaningless.
    if (marker) fs.mkdirp('/home/u/.cursor');
    return { ...deps({ fs }), collectorHost: HOST } as unknown as DoctorDeps;
  }

  const names = (report: { layers: { name: string }[] }): string[] =>
    report.layers.map((l) => l.name);

  it('emits NO row when Cursor is absent', () => {
    const report = buildDoctorReport(withCursor(undefined, false), EMPTY);
    expect(names(report)).not.toContain('cursor-sandbox');
  });

  it('DETECTION WORKS — the marker registers, so the absences below mean something', () => {
    // The control for the two silence assertions. Without it, a marker that
    // never registers makes both of them pass for the wrong reason.
    const report = buildDoctorReport(withCursor(JSON.stringify({ terminalAllowlist: [] })), EMPTY);
    expect(names(report)).toContain('cursor-sandbox');
  });

  it('emits NO row when both commands are allowlisted', () => {
    const report = buildDoctorReport(
      withCursor(JSON.stringify({ terminalAllowlist: ['git', 'harness'] })),
      EMPTY,
    );
    expect(names(report)).not.toContain('cursor-sandbox');
  });

  it('emits the row when an entry is missing, degraded and never gating', () => {
    const report = buildDoctorReport(
      withCursor(JSON.stringify({ terminalAllowlist: ['harness'] })),
      EMPTY,
    );
    const row = report.layers.find((l) => l.name === 'cursor-sandbox');
    expect(row?.ok).toBe(false);
    expect(row?.next_action).toContain('harness commit');
    // Every other row still present — one diagnostic never displaces the report.
    expect(names(report)).toContain('gitai-collector');
    expect(report.layers.length).toBeGreaterThan(10);
  });

  it('a throwing fs costs the row, never the verb', () => {
    // The reading is taken behind its own guard, so an fs that throws on the
    // Cursor paths must not escape into the report construction.
    const fs = new FakeFs(BUILT_CLI);
    fs.mkdirp('/home/u/.cursor');
    const passthrough = fs.exists.bind(fs);
    (fs as unknown as { exists: (p: string) => boolean }).exists = (p: string) => {
      if (p.includes('.cursor')) throw new Error('EIO: cursor config unreadable');
      return passthrough(p);
    };
    const d = { ...deps({ fs }), collectorHost: HOST } as unknown as DoctorDeps;

    let report: ReturnType<typeof buildDoctorReport> | null = null;
    expect(() => {
      report = buildDoctorReport(d, EMPTY);
    }).not.toThrow();
    expect(report).not.toBeNull();
    expect((report as unknown as { layers: unknown[] }).layers.length).toBeGreaterThan(10);
  });
});
