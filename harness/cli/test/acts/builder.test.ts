import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerBuilderAct } from '../../src/acts/builder.js';
import type { Envelope } from '../../src/output/envelope.js';
import { ErrorCodes } from '../../src/output/error-codes.js';
import { writeBuilderRecord } from '../../src/services/builder/records.js';
import {
  BUILDER_FIXTURE_GUIDE,
  BUILDER_FIXTURE_PLAN,
  builderFixture,
  fixtureAllocation,
} from '../fixtures/builder-contracts.js';

async function runBuilder(
  args: string[],
  fixture: ReturnType<typeof builderFixture> = builderFixture(),
): Promise<{ envelope: Envelope; code: number }> {
  let stdout = '';
  let code = -1;
  const program = new Command();
  registerBuilderAct(
    program,
    {
      mode: 'json',
      writers: {
        out: (text) => {
          stdout += text;
        },
        err: () => {},
      },
    },
    fixture.deps,
  );
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  await expect(program.parseAsync(['node', 'harness', 'builder', ...args])).rejects.toThrow(
    /^exit:/,
  );
  vi.restoreAllMocks();
  return { envelope: JSON.parse(stdout.trim()) as Envelope, code };
}

describe('Builder CLI composition boundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['compose', BUILDER_FIXTURE_PLAN, '--already-integrated'],
    ['compose', BUILDER_FIXTURE_PLAN, '--verify', 'a'.repeat(40), '--already-integrated'],
    [
      'dispatch',
      BUILDER_FIXTURE_PLAN,
      '--unit',
      'tk-0002',
      '--workspace',
      '/worker',
      '--adopt-peer',
      'coder',
    ],
  ])('rejects an incomplete or conflicting invocation before execution: %j', async (...args) => {
    const fixture = builderFixture();
    const output = vi.fn();
    const program = new Command()
      .exitOverride()
      .configureOutput({ writeErr: () => {}, writeOut: () => {} });
    registerBuilderAct(
      program,
      { mode: 'json', writers: { out: output, err: output } },
      fixture.deps,
    );
    await expect(program.parseAsync(['builder', ...args], { from: 'user' })).rejects.toThrow();
    expect(output).not.toHaveBeenCalled();
    expect(fixture.exec.calls).toEqual([]);
  });

  it('reads the canonical guide through the registered JSON command', async () => {
    const fixture = builderFixture();
    const result = await runBuilder(['guide', BUILDER_FIXTURE_PLAN], fixture);
    expect(result.code).toBe(0);
    expect(result.envelope.status).toBe('ok');
    expect(result.envelope.data).toEqual({ guide: fixture.guide });
  });

  it('does not render an unsealed readiness report as successful', async () => {
    const result = await runBuilder(['ready', BUILDER_FIXTURE_PLAN]);
    expect(result.code).toBe(1);
    expect(result.envelope.status).toBe('error');
    expect(result.envelope.error?.code).toBe(ErrorCodes.BUILDER_NOT_READY);
    expect(result.envelope.error?.details).toMatchObject({ status: 'not-ready' });
    expect(result.envelope.next_action).toBeTruthy();
  });

  it('reports an unavailable self-check packet as actionable warnings with exit zero', async () => {
    /*
    Test Doc:
    - Why: startup orientation must not become a replacement acknowledgement gate.
    - Contract: unreadable packet inspection returns warnings, not a CLI error exit.
    - Usage Notes: the existing fake filesystem contains no selected packet.
    - Quality Contribution: catches accidental error-envelope mapping at the act boundary.
    */
    const result = await runBuilder([
      'self-check',
      'missing-packet.dd.json',
      '--sha256',
      '0'.repeat(64),
    ]);
    expect(result.code).toBe(0);
    expect(result.envelope.error).toBeUndefined();
    expect(result.envelope.data).toMatchObject({
      self_check: {
        expected: { packet_sha256: '0'.repeat(64) },
        warnings: expect.arrayContaining([
          expect.objectContaining({ message: expect.any(String), next_action: expect.any(String) }),
        ]),
      },
    });
  });

  it('keeps unavailable on-track inspection advisory at the CLI boundary', async () => {
    /*
    Test Doc:
    - Why: the self-serve map check must not become a new readiness gate.
    - Contract: unavailable guide data yields compared:false and actionable issues, exit zero.
    - Usage Notes: the selected plan does not exist in the fake filesystem.
    - Quality Contribution: catches accidental error-envelope mapping for inspection failures.
    */
    const result = await runBuilder(['on-track', 'missing-plan.dd.json', '--untracked']);
    expect(result.code).toBe(0);
    expect(result.envelope.error).toBeUndefined();
    expect(result.envelope.data).toMatchObject({
      on_track: {
        compared: false,
        includes_untracked: true,
        issues: expect.arrayContaining([
          expect.objectContaining({ message: expect.any(String), next_action: expect.any(String) }),
        ]),
      },
    });
  });

  it.each([
    'contracts',
    'dispatch',
  ])('keeps ownership warnings visible in %s failure envelopes', async (verb) => {
    const fixture = builderFixture();
    fixture.guide.units[0].paths = [];
    fixture.guide.checks[0].cwd = '..';
    fixture.fs.writeText(
      `/repo/${BUILDER_FIXTURE_GUIDE}`,
      JSON.stringify({
        dd: { schema: 'builder/impl-guide' },
        sections: Object.entries(fixture.guide).map(([name, value]) => ({ name, value })),
        references: [],
      }),
    );
    const args =
      verb === 'contracts'
        ? ['contracts', BUILDER_FIXTURE_PLAN, '--seal', '--review', 'missing-review.dd.json']
        : [
            'dispatch',
            BUILDER_FIXTURE_PLAN,
            '--unit',
            'tk-0002',
            '--workspace',
            '/worker',
            '--parent',
            'peer-pm',
          ];
    const result = await runBuilder(args, fixture);
    expect(result.code).toBe(1);
    expect(result.envelope.error).toMatchObject({
      code: ErrorCodes.BUILDER_NOT_READY,
      details: {
        cause: expect.arrayContaining([expect.objectContaining({ code: 'executable-check' })]),
        warnings: expect.arrayContaining([
          expect.objectContaining({ file: 'contracts.ts', owning_unit: 'unmapped' }),
        ]),
      },
    });
  });

  it('applies a role-scoped invocation override without changing the guide', async () => {
    const fixture = builderFixture();
    const result = await runBuilder(
      [
        'settings',
        BUILDER_FIXTURE_PLAN,
        '--role',
        'coder',
        '--harness',
        'omp',
        '--model',
        'fixture/override',
      ],
      fixture,
    );
    expect(result.code).toBe(0);
    expect(result.envelope.data).toMatchObject({
      roles: [{ role: 'coder', harness: 'omp', model: 'fixture/override' }],
    });
    expect((result.envelope.data as { roles: unknown[] }).roles).toHaveLength(1);
    const reread = await runBuilder(['guide', BUILDER_FIXTURE_PLAN], fixture);
    expect(reread.envelope.data).toEqual({ guide: fixture.guide });
  });

  it('does not turn existing-peer binding into a readiness bypass or a native launch', async () => {
    /*
    Test Doc:
    - Why: an already-running peer does not replace the guide's sealed-source prerequisites.
    - Contract: --adopt-peer still reports missing readiness without spawning or writing a packet.
    - Usage Notes: the registered CLI uses the unsealed Builder fixture, not a service mock.
    - Quality Contribution: catches accidental adoption shortcuts at the act boundary.
    */
    const fixture = builderFixture();
    const result = await runBuilder(
      [
        'dispatch',
        BUILDER_FIXTURE_PLAN,
        '--unit',
        'tk-0002',
        '--workspace',
        '/workers/existing',
        '--parent',
        'peer-pm',
        '--adopt-peer',
        'running-coder',
      ],
      fixture,
    );
    expect(result.code).toBe(1);
    expect(result.envelope.error?.code).toBe(ErrorCodes.BUILDER_NOT_READY);
    expect(fixture.exec.calls.filter((call) => call.command === 'pij-rs')).toEqual([]);
    expect(fixture.fs.exists('/repo/docs/plans/001-example/assets/team')).toBe(false);
  });

  it('does not treat already-integrated as evidence when the sealed baseline is missing', async () => {
    /*
    Test Doc:
    - Why: the import modifier must not manufacture success from a claim of prior integration.
    - Contract: complete delivery input still needs immutable source evidence before any receipt.
    - Usage Notes: the real import service reads an unsealed fixture; no Git replay is available.
    - Quality Contribution: protects the CLI evidence boundary without forwarding-only mocks.
    */
    const fixture = builderFixture({
      '/repo/deliveries.json': JSON.stringify([
        {
          unit_id: 'tk-0002',
          peer_id: 'running-coder',
          workspace: '/workers/existing',
          commit_sha: 'b'.repeat(40),
          packet_sha256: 'c'.repeat(64),
          baseline_sha: 'a'.repeat(40),
        },
      ]),
    });
    const result = await runBuilder(
      [
        'compose',
        BUILDER_FIXTURE_PLAN,
        '--import',
        '/repo/deliveries.json',
        '--already-integrated',
      ],
      fixture,
    );
    expect(result.code).toBe(1);
    expect(result.envelope.status).toBe('error');
    expect(result.envelope.error?.code).toBe(ErrorCodes.BUILDER_INVALID);
    expect(fixture.exec.calls).toEqual([]);
    expect(fixture.fs.exists('/repo/docs/plans/001-example/assets/team/composition.dd.json')).toBe(
      false,
    );
  });

  it('rejects malformed JSON as a named input failure, not a raw exception', async () => {
    const fixture = builderFixture({ '/repo/deliveries.json': '{not json' });
    const result = await runBuilder(
      ['compose', BUILDER_FIXTURE_PLAN, '--import', '/repo/deliveries.json'],
      fixture,
    );
    expect(result.code).toBe(1);
    expect(result.envelope.error?.code).toBe(ErrorCodes.BUILDER_INVALID);
    expect(result.envelope.next_action).toContain('harness builder');
  });

  it('refuses a delivery missing its immutable packet and baseline bindings', async () => {
    const fixture = builderFixture({
      '/repo/deliveries.json': JSON.stringify([{ unit_id: 'tk-0001' }]),
    });
    const result = await runBuilder(
      ['compose', BUILDER_FIXTURE_PLAN, '--import', '/repo/deliveries.json'],
      fixture,
    );
    expect(result.code).toBe(1);
    expect(result.envelope.error?.code).toBe(ErrorCodes.BUILDER_INVALID);
    expect(result.envelope.status).toBe('error');
  });

  it('refuses an allocation manifest whose value disagrees with its authoritative record', async () => {
    const fixture = builderFixture();
    const allocation = writeBuilderRecord(
      fixture.deps,
      '/repo/allocation.dd.json',
      fixtureAllocation(),
    );
    if (!allocation.ok) throw new Error(allocation.message);
    const manifest = {
      ref: allocation.value.ref,
      value: { ...allocation.value.value, root: '/another-workspace' },
    };
    fixture.fs.writeText('/repo/allocations.json', JSON.stringify([manifest]));
    fixture.fs.writeText('/repo/evidence.json', '[]');
    const result = await runBuilder(
      [
        'close',
        BUILDER_FIXTURE_PLAN,
        '--allocations',
        '/repo/allocations.json',
        '--evidence',
        '/repo/evidence.json',
        '--survivor',
        '/survivor',
      ],
      fixture,
    );
    expect(result.code).toBe(1);
    expect(result.envelope.error?.code).toBe(ErrorCodes.BUILDER_CONFLICT);
  });

  it('refuses an unknown evidence category before beginning preservation', async () => {
    const fixture = builderFixture({
      '/repo/allocations.json': '[]',
      '/repo/evidence.json': JSON.stringify([{ path: 'report.json', category: 'discardable' }]),
    });
    const result = await runBuilder(
      [
        'close',
        BUILDER_FIXTURE_PLAN,
        '--allocations',
        '/repo/allocations.json',
        '--evidence',
        '/repo/evidence.json',
        '--survivor',
        '/survivor',
      ],
      fixture,
    );
    expect(result.code).toBe(1);
    expect(result.envelope.error?.code).toBe(ErrorCodes.BUILDER_INVALID);
  });
});
