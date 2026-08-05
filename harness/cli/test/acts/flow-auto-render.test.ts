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
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

const EMPTY: VerbRegistry = { verbs: [], records: [] };
const FLOW = '/repo/.harness/flows/demo.json';
const RENDER = '/repo/.harness/flows/demo.md';

/**
 * An fs on which the sibling markdown cannot be written at all.
 *
 * The match covers `demo.md` AND `demo.md.<anything>` on purpose. The sibling is
 * staged through a temp, so a fake that only knows the final name would let every
 * write succeed and these controls would go green while proving nothing — the
 * failure they exist to inject would simply stop happening. The fake models "this
 * fs will not accept the sibling", not "this fs will not accept one filename".
 */
class MdFailFs extends FakeFs {
  /** Flipped ON only once the fixture is in the state a control needs. */
  failMd = true;
  override writeText(path: string, contents: string): void {
    if (this.failMd && /\.md(\.[^/]+)?$/.test(path)) throw new Error('read-only render');
    super.writeText(path, contents);
  }
}

/**
 * The failure `MdFailFs` CANNOT model, and the reason it had to be joined by this
 * one: a write that emits some bytes and only then gives way — ENOSPC part-way
 * through, a truncating writer, a process killed mid-`write(2)`. An all-or-nothing
 * throw leaves the sibling untouched by luck, so a control built from one proves
 * nothing about a partial. This one leaves HALF a sibling on disk before it
 * throws, which is the only way to see whether the refusal path stages its write
 * or simply hopes the failure was clean.
 *
 * The match is deliberately `demo.md` AND `demo.md.<anything>`: the staging temp
 * is exactly the byte-path a fix would introduce, so the same control keeps
 * failing the write after the fix instead of quietly going green because the
 * writes moved to a name it stopped looking at.
 */
class PartialSiblingFs extends FakeFs {
  /** Flipped ON only once the fixture is in the state a control needs. */
  failSibling = true;
  override writeText(path: string, contents: string): void {
    if (this.failSibling && /\.md(\.[^/]+)?$/.test(path)) {
      super.writeText(path, contents.slice(0, Math.max(1, Math.floor(contents.length / 2))));
      throw new Error('ENOSPC: no space left on device, write');
    }
    super.writeText(path, contents);
  }
}

/**
 * The worse case: the sibling cannot be written AND neither can the rollback.
 * The one write that must still land is the flow SOURCE's own temp, so
 * `writeFlowAtomic`'s temp-write + rename succeeds and the failure lands where
 * this control needs it — on the sibling, with the restore then blocked too.
 * (Named by suffix rather than "not a temp": the sibling stages through a temp of
 * its own now, and that one has to keep failing.)
 */
class RollbackFailFs extends FakeFs {
  failFinalWrites = true;
  override writeText(path: string, contents: string): void {
    if (this.failFinalWrites && !path.endsWith('.json.tmp')) throw new Error('read-only volume');
    super.writeText(path, contents);
  }
}

function fakeDeps(fs: FakeFs): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs,
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-06-18T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

async function runFlow(
  deps: VerbActDeps,
  argv: string[],
): Promise<{ env: Envelope; code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  let code = -1;
  const writers: Writers = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const io: CliIo = { mode: 'json', writers };
  vi.spyOn(process, 'exit').mockImplementation(((value?: number) => {
    code = value ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  await expect(
    buildProgram('0.4.0', io, deps, EMPTY).parseAsync(['node', 'harness', ...argv]),
  ).rejects.toThrow(/^exit:/);
  vi.restoreAllMocks();
  return { env: JSON.parse(out.trim()) as Envelope, code, out, err };
}

describe('FX001-5 flow mutation auto-render', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('create writes the sibling markdown byte-identical to manual render output', async () => {
    const fs = new FakeFs();
    const deps = fakeDeps(fs);
    const created = await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    expect(created.code).toBe(0);
    expect(fs.readText(RENDER)).not.toBeNull();

    const manual = await runFlow(deps, ['flow', 'render', '--path', FLOW]);
    expect(fs.readText(RENDER)).toBe((manual.env.data as { rendered: string }).rendered);
  });

  it('a successful mutation refreshes the sibling render and preserves default stdout bytes', async () => {
    const fs = new FakeFs();
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const before = fs.readText(RENDER);

    const mutated = await runFlow(deps, [
      'flow',
      'status',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--to',
      'in_progress',
    ]);

    expect(mutated.out).toBe(
      '{"command":"flow","status":"ok","timestamp":"2026-06-18T00:00:00.000Z","data":{"path":"/repo/.harness/flows/demo.json","slug":"demo","kind":"harness-loop","now":"boot","next":null,"node_count":7,"event_count":2}}\n',
    );
    expect(fs.readText(RENDER)).not.toBe(before);
    const checked = await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--check']);
    expect(checked.code).toBe(0);
    expect((checked.env.data as { drift: boolean }).drift).toBe(false);
  });

  it('the append-only event mutation also refreshes the sibling render', async () => {
    const fs = new FakeFs();
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const before = fs.readText(RENDER);

    const event = await runFlow(deps, ['flow', 'event', 'test-run', '--slug', 'demo']);

    expect(event.code).toBe(0);
    expect(fs.readText(RENDER)).not.toBe(before);
    const checked = await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--check']);
    expect(checked.code).toBe(0);
  });
});

/**
 * tk-7174 / DF-016 — the sibling is half of the write, not decoration.
 *
 * These controls exist because the OPPOSITE behaviour used to be pinned in this
 * very file: a failed sibling write warned on stderr and the verb still exited 0,
 * leaving a moved `.json` beside a stale `.md` — the exact drift `flow render
 * --check` exists to catch, manufactured by the tool that promises not to. Each
 * control drives one of the three callsites and asserts BOTH halves of the
 * contract: the operation is refused, AND the source is exactly as it was.
 */
describe('dw-000f — a failed sibling render refuses the flow operation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('create refuses and leaves NO flow behind — a refused create creates nothing', async () => {
    const fs = new MdFailFs();
    const deps = fakeDeps(fs);

    const created = await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);

    expect(created.code).not.toBe(0);
    expect(created.env.status).toBe('error');
    expect(created.env.error?.code).toBe('E302');
    expect(created.env.error?.message).toContain('sibling markdown could not be written');
    // The rollback is the point: no half-created flow, and no sibling either.
    expect(fs.exists(FLOW)).toBe(false);
    expect(fs.exists(RENDER)).toBe(false);
  });

  it('a mutation refuses and restores the source byte-for-byte', async () => {
    const fs = new MdFailFs();
    fs.failMd = false;
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const sourceBefore = fs.readText(FLOW);
    const siblingBefore = fs.readText(RENDER);
    fs.failMd = true;

    const mutated = await runFlow(deps, [
      'flow',
      'status',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--to',
      'in_progress',
    ]);

    expect(mutated.code).not.toBe(0);
    expect(mutated.env.error?.code).toBe('E302');
    expect(mutated.env.next_action).toContain('Nothing was changed');
    expect(fs.readText(FLOW)).toBe(sourceBefore);
    expect(fs.readText(RENDER)).toBe(siblingBefore);
  });

  it('the append-only event verb refuses too — an unrenderable event is not recorded', async () => {
    const fs = new MdFailFs();
    fs.failMd = false;
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const sourceBefore = fs.readText(FLOW);
    fs.failMd = true;

    const event = await runFlow(deps, ['flow', 'event', 'test-run', '--slug', 'demo']);

    expect(event.code).not.toBe(0);
    expect(event.env.error?.code).toBe('E302');
    expect(fs.readText(FLOW)).toBe(sourceBefore);
  });

  it('says so LOUDLY when the rollback itself fails — the honest worse case', async () => {
    const fs = new RollbackFailFs();
    fs.failFinalWrites = false;
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    // Now nothing final can be written: not the sibling, and not the rollback either.
    fs.failFinalWrites = true;

    const mutated = await runFlow(deps, [
      'flow',
      'status',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--to',
      'in_progress',
    ]);

    expect(mutated.code).not.toBe(0);
    expect(mutated.env.next_action).toContain('the rollback of');
    expect(mutated.env.next_action).toContain('also failed');
  });

  it('does NOT refuse when the sibling writes fine — the guard is not a blanket', async () => {
    const fs = new MdFailFs();
    fs.failMd = false;
    const deps = fakeDeps(fs);

    const created = await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);

    expect(created.code).toBe(0);
    expect(created.env.status).toBe('ok');
    expect(fs.readText(RENDER)).not.toBeNull();
  });
});

/**
 * PHASE3 fix round 1, finding 1 — a refusal that leaves a HALF-WRITTEN sibling is
 * still drift.
 *
 * The controls above restore the source and call the contract kept. They can only
 * see failures that throw before touching the sibling, so they were satisfied by
 * a `persistSibling` that wrote the live `.md` directly: on a mid-write failure
 * the source rolled back and the sibling stayed half-written — a `.json` and a
 * `.md` that disagree, produced by the verb whose entire purpose is to make that
 * state unreachable. "The write threw" is not the same claim as "the write left
 * nothing behind", and only a partial-byte failure can tell them apart.
 *
 * So these assert the stronger contract: a refusal leaves BOTH files exactly as
 * they were, and leaves no staging temp behind either.
 */
describe('dw-000f — a MID-WRITE sibling failure still leaves both files untouched', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('create leaves no partial sibling — not even the half the fs managed to write', async () => {
    const fs = new PartialSiblingFs();
    const deps = fakeDeps(fs);

    const created = await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);

    expect(created.code).not.toBe(0);
    expect(created.env.error?.code).toBe('E302');
    expect(fs.exists(FLOW)).toBe(false);
    // Pre-fix this is the half-written render: present, truncated, and trusted.
    expect(fs.exists(RENDER)).toBe(false);
  });

  it('a mutation restores the sibling BYTE-for-byte, not merely the source', async () => {
    const fs = new PartialSiblingFs();
    fs.failSibling = false;
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    const sourceBefore = fs.readText(FLOW);
    const siblingBefore = fs.readText(RENDER);
    fs.failSibling = true;

    const mutated = await runFlow(deps, [
      'flow',
      'status',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--to',
      'in_progress',
    ]);

    expect(mutated.code).not.toBe(0);
    expect(mutated.env.error?.code).toBe('E302');
    expect(mutated.env.next_action).toContain('Nothing was changed');
    expect(fs.readText(FLOW)).toBe(sourceBefore);
    // The load-bearing assertion: pre-fix the sibling is truncated in place.
    expect(fs.readText(RENDER)).toBe(siblingBefore);
  });

  it('the drift gate agrees the sibling survived — the refusal is provable, not asserted', async () => {
    const fs = new PartialSiblingFs();
    fs.failSibling = false;
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    fs.failSibling = true;

    await runFlow(deps, ['flow', 'event', 'test-run', '--slug', 'demo']);

    // `flow render --check` is the repo's own drift authority: it, not this test's
    // string compare, is what a reader would consult after the refusal.
    fs.failSibling = false;
    const checked = await runFlow(deps, ['flow', 'render', '--slug', 'demo', '--check']);
    expect(checked.code).toBe(0);
    expect((checked.env.data as { drift: boolean }).drift).toBe(false);
  });

  it('leaves no staging temp behind next to the flow — a refusal is not litter', async () => {
    const fs = new PartialSiblingFs();
    fs.failSibling = false;
    const deps = fakeDeps(fs);
    await runFlow(deps, ['flow', 'create', 'harness-loop', '--slug', 'demo']);
    fs.failSibling = true;

    await runFlow(deps, [
      'flow',
      'status',
      '--slug',
      'demo',
      '--node',
      'boot',
      '--to',
      'in_progress',
    ]);

    const strays = Object.keys(fs.files).filter((p) => p.includes('demo.md') && p !== RENDER);
    expect(strays).toEqual([]);
  });
});
