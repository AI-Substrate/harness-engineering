import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerBuilderAct } from '../../src/acts/builder.js';
import type { Envelope } from '../../src/output/envelope.js';
import { ErrorCodes } from '../../src/output/error-codes.js';
import { writeBuilderRecord } from '../../src/services/builder/records.js';
import {
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
