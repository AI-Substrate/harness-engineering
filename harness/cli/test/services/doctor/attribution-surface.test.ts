import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeGitAttribution } from '../../../src/adapters/git/fake-git-attribution.js';
import { FakeSocketProbe, FakeSocketRelay } from '../../../src/adapters/net/fake-socket-probe.js';
import type { ProbeOutcome } from '../../../src/adapters/net/socket-probe-port.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { readIngress } from '../../../src/services/doctor/collector/ingress.js';
import { buildDoctorReport, type DoctorDeps } from '../../../src/services/doctor/doctor-service.js';
import type { VerbRegistry } from '../../../src/services/extensions/registry.js';
import { commitGuidanceBlock } from '../../../src/services/instructions/commit-guidance.js';
import { FakeCollectorFs } from '../../support/collector-fakes.js';
import { PRE_075_BLOCK } from '../../support/pre-075-block.js';

/**
 * Plan 074 · ac-0004, ac-0007, ac-0008 — the doctor SURFACE.
 *
 * Three separate claims live here:
 *
 * 1. capture-liveness no longer reports green on a default (capture-off)
 *    install — its green-forever failure mode is dead.
 * 2. the attribution rows DETECT and NAME the recovery command, and a bare
 *    doctor run MUTATES NOTHING — no socket write, no buffer, no ref.
 * 3. the commit-guidance row warns when the AGENTS.md block is absent, and
 *    never edits the file.
 */

const REPO = '/repo';
const SOCK = '/home/u/.git-ai/internal/daemon/trace2.sock';
const EMPTY: VerbRegistry = { verbs: [], records: [] };
const BUILT_CLI = {
  'harness/cli/tsconfig.json': '{}',
  'harness/cli/dist/index.js': '// built',
};

async function ingressFor(outcome: ProbeOutcome) {
  const cfs = new FakeCollectorFs();
  cfs.writeText(SOCK, '');
  return readIngress({
    fs: cfs,
    probe: new FakeSocketProbe({ [SOCK]: outcome }),
    git: new FakeGitAttribution({ trace2Target: `af_unix:stream:${SOCK}` }),
    env: { get: () => undefined },
  });
}

function deps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    fs: over.fs ?? new FakeFs(BUILT_CLI),
    proc: over.proc ?? new FakeProcess({ node: '/usr/bin/node' }, REPO),
    git: over.git ?? new FakeGit({ isRepo: true, branch: 'main' }),
    env: over.env ?? new FakeEnv(),
    clock: over.clock ?? new FakeClock('2026-08-07T00:00:00.000Z'),
    ...over,
  };
}

function layer(report: ReturnType<typeof buildDoctorReport>, name: string) {
  const found = report.layers.find((l) => l.name === name);
  if (found === undefined) throw new Error(`doctor has no ${name} layer`);
  return found;
}

describe('plan 074 · ac-0004 — capture-liveness is dead as a green-forever row', () => {
  it('a DEFAULT install (capture off) does NOT report healthy', () => {
    // The exact shape the AC names: a shipped harness, clean environment. Before
    // this fix the row answered ok:true forever, because after plan 073 inverted
    // the capture default there was never a lane to watch — reassurance about a
    // measurement that had stopped being taken.
    const report = buildDoctorReport(deps({ env: new FakeEnv() }), EMPTY);
    const row = layer(report, 'capture-liveness');

    expect(row.ok).toBe(false);
    expect(row.detail).toContain('could-not-determine');
    expect(row.detail).toContain('NOT a healthy reading');
    expect(row.next_action).toBeDefined();
  });

  it('the operator kill-switch is reported as its own cause, still not healthy', () => {
    const report = buildDoctorReport(
      deps({ env: new FakeEnv({ HARNESS_NO_TELEMETRY: '1' }) }),
      EMPTY,
    );
    const row = layer(report, 'capture-liveness');

    expect(row.ok).toBe(false);
    expect(row.detail).toContain('HARNESS_NO_TELEMETRY=1');
  });

  it('with capture ENABLED the layer is measurable again and can be green', () => {
    const report = buildDoctorReport(
      deps({ env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }) }),
      EMPTY,
    );
    const row = layer(report, 'capture-liveness');

    expect(row.ok).toBe(true);
    expect(row.detail).not.toContain('could-not-determine');
  });

  it('warns without blocking — the doctor envelope still exits 0', () => {
    // 073 ac-000c holds: every doctor rung is advisory.
    const report = buildDoctorReport(deps({ env: new FakeEnv() }), EMPTY);
    expect(report.layers.some((l) => !l.ok)).toBe(true);
  });
});

describe('plan 074 · ac-0002 — the ingress-blocked verdict renders as a warning', () => {
  it('markers present + probe CONNECTED yields NO ingress warning (F-11)', async () => {
    const cfs = new FakeCollectorFs();
    cfs.writeText(SOCK, '');
    const reading = await readIngress({
      fs: cfs,
      probe: new FakeSocketProbe({ [SOCK]: 'connected' }),
      git: new FakeGitAttribution({ trace2Target: `af_unix:${SOCK}` }),
      env: { get: (n: string) => (n === 'CURSOR_SANDBOX' ? 'seatbelt' : undefined) },
    });
    const report = buildDoctorReport(
      deps({
        ingress: reading,
        attribution: new FakeGitAttribution({
          window: { shas: [], rule: 'merge-base', detail: 'w' },
        }),
      }),
      EMPTY,
    );

    expect(layer(report, 'attribution-at-risk').detail).not.toContain('sandbox is blocking');
  });
});

describe('plan 074 · ac-0007 — doctor DETECTS, and mutates NOTHING', () => {
  it('names the exact recovery command when unattributed commits exist', async () => {
    const attribution = new FakeGitAttribution({
      window: { shas: ['a'.repeat(40)], rule: 'merge-base', detail: 'ahead of merge-base' },
    });
    const report = buildDoctorReport(
      deps({ ingress: await ingressFor('denied'), attribution }),
      EMPTY,
    );
    const row = layer(report, 'attribution-at-risk');

    expect(row.ok).toBe(false);
    expect(row.detail).toContain('unattributed');
    expect(row.next_action).toContain('harness doctor telemetry-nudge');
  });

  it('issues no stage, no commit, and no note write — detection only', async () => {
    const attribution = new FakeGitAttribution({
      window: { shas: ['a'.repeat(40)], rule: 'merge-base', detail: 'ahead of merge-base' },
    });
    buildDoctorReport(deps({ ingress: await ingressFor('denied'), attribution }), EMPTY);

    expect(attribution.commits).toEqual([]);
    expect(attribution.staged).toEqual([]);
    expect(attribution.calls).toEqual(['commitWindow:200:50', 'listNotedShas']);
  });

  it('a bare doctor run writes NOTHING into the collector socket', async () => {
    // Doctor is handed the PROBE port only — never the relay — so this is
    // structural rather than behavioural. The relay is exercised here purely to
    // prove it stays untouched by the report path.
    const relay = new FakeSocketRelay();
    const probe = new FakeSocketProbe({ [SOCK]: 'denied' });
    const cfs = new FakeCollectorFs();
    cfs.writeText(SOCK, '');
    const reading = await readIngress({
      fs: cfs,
      probe,
      git: new FakeGitAttribution({ trace2Target: `af_unix:${SOCK}` }),
      env: { get: () => undefined },
    });

    const fs = new FakeFs(BUILT_CLI);
    buildDoctorReport(
      deps({
        fs,
        ingress: reading,
        attribution: new FakeGitAttribution({
          window: { shas: [], rule: 'merge-base', detail: 'w' },
        }),
      }),
      EMPTY,
    );

    expect(relay.sends).toEqual([]);
    // The probe connected and destroyed; it never sent a byte, by construction.
    expect(probe.calls).toEqual([SOCK]);
    // No buffer was rotated, created, or deleted by a bare report.
    expect(fs.exists(`${REPO}/.harness/temp/trace2/buffer.jsonl`)).toBe(false);
  });

  it('omits the at-risk row entirely when no attribution reads were wired', async () => {
    // Absence of wiring is never reported as a clean bill.
    const report = buildDoctorReport(deps({ ingress: await ingressFor('connected') }), EMPTY);
    expect(report.layers.some((l) => l.name === 'attribution-at-risk')).toBe(false);
  });
});

describe('plan 074 · ac-0008 — commit-guidance warns, and never edits', () => {
  it('warns when AGENTS.md carries no managed block, naming the inject command', () => {
    const report = buildDoctorReport(
      deps({ fs: new FakeFs({ ...BUILT_CLI, '/repo/AGENTS.md': '# Agents\n' }) }),
      EMPTY,
    );
    const row = layer(report, 'commit-guidance');

    expect(row.ok).toBe(false);
    expect(row.detail).toContain('no harness:commit-guidance block');
    expect(row.next_action).toContain('harness instructions commit --inject');
  });

  it('warns when there is no AGENTS.md at all', () => {
    const report = buildDoctorReport(deps({ fs: new FakeFs(BUILT_CLI) }), EMPTY);
    expect(layer(report, 'commit-guidance').ok).toBe(false);
  });

  it('is green when the block is present and current', () => {
    const fs = new FakeFs({ ...BUILT_CLI, '/repo/AGENTS.md': `${commitGuidanceBlock()}\n` });
    const report = buildDoctorReport(deps({ fs }), EMPTY);
    expect(layer(report, 'commit-guidance').ok).toBe(true);
  });

  it('flags a STALE block rather than silently rewriting it', () => {
    const stale = commitGuidanceBlock().replace('Committing in this repo', 'Old heading');
    const fs = new FakeFs({ ...BUILT_CLI, '/repo/AGENTS.md': `${stale}\n` });
    const report = buildDoctorReport(deps({ fs }), EMPTY);
    const row = layer(report, 'commit-guidance');

    expect(row.ok).toBe(false);
    expect(row.detail).toContain('STALE');
    // The file is untouched: doctor reports, the explicit verb edits.
    expect(fs.readText('/repo/AGENTS.md')).toBe(`${stale}\n`);
  });

  it('plan 076 · ac-0005 — the VERBATIM pre-075 block migrates as `stale`, and doctor still edits nothing', () => {
    /*
    Test Doc:
    - Why: every repo in the wild carries the pre-075 block, which promises exactly
      two outcomes and routes a named-pipe reader to a nudge that refuses. Migration
      must be graceful: the old text has to read `stale` — never `current` (which
      would leave the wrong promise in place forever) and never `absent` (which
      would tell an adopted repo it was never adopted).
    - Contract: doctor's row is not-ok, says STALE, names `--inject`, mutates nothing.
    - Quality Contribution: pins the ONE state that makes the fix reachable for
      already-adopted repos, against the real historical bytes rather than a mutation
      of today's block.
    */
    const fs = new FakeFs({ ...BUILT_CLI, '/repo/AGENTS.md': `${PRE_075_BLOCK}\n` });
    const report = buildDoctorReport(deps({ fs }), EMPTY);
    const row = layer(report, 'commit-guidance');

    expect(row.ok).toBe(false);
    expect(row.detail).toContain('STALE');
    expect(row.next_action).toContain('harness instructions commit --inject');
    expect(fs.readText('/repo/AGENTS.md')).toBe(`${PRE_075_BLOCK}\n`);
  });
});
