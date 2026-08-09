import { describe, expect, it } from 'vitest';
import type { VerbActDeps } from '../../src/acts/verb.js';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeExec } from '../../src/adapters/exec/fake-exec.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import { buildProgram } from '../../src/app.js';
import type { CliIo, Writers } from '../../src/output/output-port.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';

/**
 * Plan 081 — a TRIPWIRE over a control that is currently held by CONVENTION.
 *
 * `setNode` (`flow-mutations.ts:797-871`) admits a `next` field: `next` is in
 * `NODE_FIELDS` (`flow-events.ts:386`), so its unknown-field guard lets it
 * through, and neither `badNext` nor `dagIssue` sits on its path. A caller that
 * reaches that exported seam directly with `{ next: ... }` can therefore author
 * an edge — and a cycle — that NO layer refuses: `validateFlowDoc`
 * (`flow-schema.ts:229-330`) has no cycle rule either.
 *
 * It is not reachable from the CLI, and the reason is the only thing holding it:
 * `flow set-node` DECLARES NO EDGE-AUTHORING FLAG (`acts/flow.ts:782-810`), so
 * the act can never put `next` into the fields map it hands the seam. That is the
 * containment. It is a closed flag set, not a check — exactly the shape of
 * control this plan exists to stop trusting silently.
 *
 * The two paths that DO guard, for whoever opens the flag later and needs to know
 * what to add:
 *   - `applyBatch` re-checks the WHOLE graph at the batch tail — `firstDanglingRef`
 *     then `dagIssue` → `E309` (`flow-mutations.ts:1612-1621`), pinned by
 *     `test/services/flow/flow-apply.test.ts` ("a batch that produces a CYCLE
 *     writes NOTHING → E309"). This is why a `set` op inside `flow apply` is safe
 *     while the seam is not.
 *   - `insertNode` runs `badNext` + `dagIssue` itself (`flow-mutations.ts:1006`,
 *     `:1010`) — and it is the verb that legitimately authors edges, which is the
 *     contrast asserted below.
 *
 * So: if someone adds `--next` (or `--branch-of`) to `set-node`, the containment
 * evaporates SILENTLY unless something fails. This is that something. When it
 * goes red, do not delete it — wire `badNext` + `dagIssue` into `setNode` first.
 */

const EMPTY: VerbRegistry = { verbs: [], records: [] };

function fakeDeps(): VerbActDeps {
  return {
    exec: new FakeExec(),
    fs: new FakeFs({}),
    env: new FakeEnv({}, '/home/u'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    clock: new FakeClock('2026-08-09T00:00:00.000Z'),
    proc: new FakeProcess({}, '/repo'),
  };
}

/**
 * The LIVE option set of `harness flow <sub>`, read off the BUILT program rather
 * than a hand-copied list — a transcribed list would keep passing after the real
 * flag set changed, which is the one failure a tripwire may not have.
 */
function optionFlags(sub: string): string[] {
  const writers: Writers = { out: () => {}, err: () => {} };
  const io: CliIo = { mode: 'json', writers };
  const program = buildProgram('0.4.0', io, fakeDeps(), EMPTY);
  const flow = program.commands.find((c) => c.name() === 'flow');
  if (flow === undefined) throw new Error('no `flow` command is registered');
  const cmd = flow.commands.find((c) => c.name() === sub);
  if (cmd === undefined) throw new Error(`no \`flow ${sub}\` subcommand is registered`);
  return cmd.options.map((o) => o.long ?? o.short ?? o.flags);
}

describe("plan 081 tripwire — set-node's containment is the CLI's closed flag set", () => {
  // VACUITY GUARD, and it is not ceremony: every other assertion here is a
  // NEGATIVE one, and a reader that silently returned [] would satisfy all of
  // them while proving nothing. Pin something that must be present first, so a
  // broken reader fails here instead of passing everywhere.
  it('reads the REAL flag set — a reader that saw nothing would pass every negative below', () => {
    const flags = optionFlags('set-node');
    expect(flags).toContain('--node');
    expect(flags).toContain('--label');
    expect(flags.length).toBeGreaterThan(5);
  });

  it('set-node declares NO edge-authoring flag — this is what keeps the unguarded seam unreachable', () => {
    const flags = optionFlags('set-node');
    expect(flags).not.toContain('--next');
    expect(flags).not.toContain('--branch-of');
  });

  // The contrast that shows the rule is about EDGES, not about set-node being
  // special: the verb that may author edges is the verb that re-checks the DAG.
  it('insert-node DOES author edges — and it is the one that runs badNext + dagIssue', () => {
    expect(optionFlags('insert-node')).toContain('--branch-of');
  });
});
