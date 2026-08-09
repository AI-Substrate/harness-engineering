import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { Envelope } from '../../src/output/envelope.js';
import { ErrorCodes } from '../../src/output/error-codes.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';
import { BUNDLED_FLOW_SCHEMAS } from '../../src/services/flow/schemas-content.js';

/**
 * Plan 081 — the behaviour change bundling turned ON, pinned in both directions.
 *
 * `validateMutatedDoc` (acts/flow.ts) re-resolves the overlay by `doc.kind` and
 * SKIPS post-mutation validation only when it cannot resolve one. Before 081, a
 * flight-plan created behind an external `--schema` in a repo carrying no
 * `.harness/schemas/flows/flight-plan.schema.json` had nothing left to re-resolve
 * (that is the E304 this plan fixes), so THOSE mutations took the tolerant-skip
 * branch. Not every flight-plan mutation did — a repo overlay was a resolvable
 * rung then and still is (last test below). Now the type resolves from the bundle
 * unconditionally, so mutations REVALIDATE — a real behaviour change nobody
 * designed, that falls out of reachability.
 *
 * It FAILS CLOSED, which is the good direction: a mutation that the flow's own
 * BYO overlay would allow is now REFUSED (E300, nothing written) rather than
 * silently written. The cost is that every status and node type a mutation uses
 * must stay INSIDE the bundled vocabulary — a `--schema` superset is exactly the
 * failing case (first test below), not a way around it, because the mutation
 * verbs take no `--schema` and re-resolve the BUNDLED overlay.
 *
 * Both legs live in ONE spec because the DIFFERENCE is the assertion. The skip
 * leg is not colour: it is what proves the switch is RESOLVABILITY and not some
 * other 081 change. Identical overlay, identical mutation — only `kind` differs,
 * and with it whether the overlay can be re-resolved.
 */

const EMPTY: VerbRegistry = { verbs: [], records: [] };

/** The bundled flight-plan overlay's vocabulary — the baseline a superset extends. */
const BUNDLED_FLIGHT_PLAN = BUNDLED_FLOW_SCHEMAS['flight-plan'] as {
  statuses: string[];
  nodeTypes: string[];
};

/** A custom status/type that no bundled overlay declares — the superset's extra vocabulary. */
const CUSTOM_STATUS = 'parked';
const CUSTOM_TYPE = 'canary';

/** A strict superset of the bundled flight-plan vocabulary, under a caller-chosen `kind`. */
function supersetOverlay(kind: string): string {
  return JSON.stringify({
    kind,
    schema_version: 1,
    statuses: [...BUNDLED_FLIGHT_PLAN.statuses, CUSTOM_STATUS],
    nodeTypes: [...BUNDLED_FLIGHT_PLAN.nodeTypes, CUSTOM_TYPE],
  });
}

/** The two overlays differ in ONE byte-range: `kind`. Everything else is identical. */
const RESOLVABLE_SCHEMA = '/elsewhere/flight-plan-superset.schema.json';
const UNRESOLVABLE_SCHEMA = '/elsewhere/workteam-custom-superset.schema.json';
const UNBUNDLED_KIND = 'workteam-custom';

function fakeDeps(fs: FakeFs): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs,
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-09T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

function seededFs(): FakeFs {
  const fs = new FakeFs({
    [RESOLVABLE_SCHEMA]: supersetOverlay('flight-plan'),
    [UNRESOLVABLE_SCHEMA]: supersetOverlay(UNBUNDLED_KIND),
  });
  fs.mkdirp('/repo/.harness');
  return fs;
}

async function runFlow(
  deps: VerbActDeps,
  argv: string[],
): Promise<{ env: Envelope; code: number }> {
  let out = '';
  let code = -1;
  const writers: Writers = {
    out: (t) => {
      out += t;
    },
    err: () => {},
  };
  const io: CliIo = { mode: 'json', writers };
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  await expect(
    buildProgram('0.4.0', io, deps, EMPTY).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  vi.restoreAllMocks();
  return { env: JSON.parse(out.trim()) as Envelope, code };
}

/** The flow path a slug resolves to — read back to prove what was (not) written. */
function flowPath(slug: string): string {
  return `/repo/.harness/flows/${slug}.json`;
}

/**
 * Create a BYO-superset flow of `type` and then mutate it with the custom
 * vocabulary and NO `--schema` — the exact shape the mutation verbs offer, since
 * none of them takes a `--schema` flag. Returns the mutation envelope plus the
 * persisted bytes either side of it.
 */
async function createThenMutate(
  type: string,
  schemaPath: string,
  slug: string,
): Promise<{ env: Envelope; code: number; before: string | null; after: string | null }> {
  const deps = fakeDeps(seededFs());
  const created = await runFlow(deps, [
    'flow',
    'create',
    type,
    '--slug',
    slug,
    '--schema',
    schemaPath,
    '--bare',
  ]);
  expect(created.env.status).toBe('ok');
  const fs = deps.fs as FakeFs;
  const before = fs.readText(flowPath(slug));
  const mutated = await runFlow(deps, [
    'flow',
    'add-node',
    '--slug',
    slug,
    '--id',
    'canary-1',
    '--type',
    CUSTOM_TYPE,
    '--label',
    'Canary',
    '--status',
    CUSTOM_STATUS,
  ]);
  return { env: mutated.env, code: mutated.code, before, after: fs.readText(flowPath(slug)) };
}

describe('post-mutation revalidation: bundling a type switches the tolerant skip OFF', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('BUNDLED kind — a BYO superset mutation without --schema is REFUSED (E300), nothing written', async () => {
    const res = await createThenMutate('flight-plan', RESOLVABLE_SCHEMA, 'bundled-superset');
    expect(res.env.status).toBe('error');
    expect(res.code).toBe(1);
    expect(res.env.error?.code).toBe(ErrorCodes.FLOW_SCHEMA_INVALID);
    // Fail-CLOSED: the refusal costs a write, never permits one. The persisted
    // flow is byte-identical to before the mutation.
    expect(res.after).toBe(res.before);
    expect(res.after).not.toContain('canary-1');
  });

  it('UNBUNDLED kind (control) — the SAME overlay + SAME mutation is allowed (tolerant skip)', async () => {
    const res = await createThenMutate(UNBUNDLED_KIND, UNRESOLVABLE_SCHEMA, 'unbundled-superset');
    expect(res.env.status).toBe('ok');
    expect(res.code).toBe(0);
    expect(res.after).not.toBe(res.before);
    expect(res.after).toContain('canary-1');
  });

  it('the DIFFERENCE is resolvability alone — same overlay, same mutation, opposite verdicts', async () => {
    const bundled = await createThenMutate('flight-plan', RESOLVABLE_SCHEMA, 'diff-bundled');
    const unbundled = await createThenMutate(UNBUNDLED_KIND, UNRESOLVABLE_SCHEMA, 'diff-unbundled');
    // The single assertion this whole spec exists for: identical overlay bytes
    // (modulo `kind`), identical mutation argv, opposite verdicts.
    expect([bundled.env.status, unbundled.env.status]).toEqual(['error', 'ok']);
    // …and the write follows the verdict: refused → unchanged, skipped → written.
    expect(bundled.after).toBe(bundled.before);
    expect(unbundled.after).not.toBe(unbundled.before);
  });

  it('the refusal names the custom vocabulary that the BUNDLED overlay does not declare', async () => {
    const res = await createThenMutate('flight-plan', RESOLVABLE_SCHEMA, 'names-vocab');
    const message = res.env.error?.message ?? '';
    expect(message).toContain(CUSTOM_TYPE);
    expect(message).toContain(CUSTOM_STATUS);
    // The remedy the operator needs: it is the argument that is wrong, and
    // nothing was written while they decide.
    expect(res.env.next_action).toContain('nothing was written');
  });

  it('a mutation staying INSIDE the bundled vocabulary is still allowed on a bundled kind', async () => {
    const deps = fakeDeps(seededFs());
    await runFlow(deps, [
      'flow',
      'create',
      'flight-plan',
      '--slug',
      'in-vocab',
      '--schema',
      RESOLVABLE_SCHEMA,
      '--bare',
    ]);
    const ok = await runFlow(deps, [
      'flow',
      'add-node',
      '--slug',
      'in-vocab',
      '--id',
      'r1',
      '--type',
      'research',
      '--label',
      'Research',
      '--status',
      'known',
    ]);
    expect(ok.env.status).toBe('ok');
    expect(ok.code).toBe(0);
    expect((deps.fs as FakeFs).readText(flowPath('in-vocab'))).toContain('r1');
  });

  it('the documented remedy works — a REPO overlay outranks the bundled copy on the mutation path too', async () => {
    // The guide tells an operator whose custom vocabulary must survive mutation
    // to pin it at `.harness/schemas/flows/<kind>.schema.json`. That remedy is
    // only true if the mutation path consults the repo rung, not just `create` —
    // so it is pinned here rather than asserted in prose. Same kind, same
    // mutation as the refusal above; only the overlay's LOCATION differs.
    const fs = seededFs();
    fs.writeText(
      '/repo/.harness/schemas/flows/flight-plan.schema.json',
      supersetOverlay('flight-plan'),
    );
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'flight-plan', '--slug', 'repo-pinned', '--bare']);
    const ok = await runFlow(deps, [
      'flow',
      'add-node',
      '--slug',
      'repo-pinned',
      '--id',
      'canary-1',
      '--type',
      CUSTOM_TYPE,
      '--label',
      'Canary',
      '--status',
      CUSTOM_STATUS,
    ]);
    expect(ok.env.status).toBe('ok');
    expect(ok.code).toBe(0);
    expect(fs.readText(flowPath('repo-pinned'))).toContain('canary-1');
  });
});
