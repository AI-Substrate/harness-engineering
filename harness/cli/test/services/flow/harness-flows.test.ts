import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import type { FlowDoc, FlowNode } from '../../../src/services/flow/flow-events.js';
import { setNode } from '../../../src/services/flow/flow-mutations.js';
import { renderFlow, renderRailLine } from '../../../src/services/flow/flow-renderer.js';
import { createFlow, type FlowServiceDeps } from '../../../src/services/flow/flow-service.js';
import {
  BUNDLED_FLOW_SCHEMAS,
  BUNDLED_FLOW_TEMPLATES,
} from '../../../src/services/flow/schemas-content.js';

/**
 * Plan 032 T006 — the two first-class harness flows (🧰 adopt + ⚙️ loop). Proves the
 * bundled overlays + templates exist with the 028 flight-map shape, that `create`
 * stamps a valid instance from each, that zones band correctly (the renderer's
 * ZONE_BY_TYPE has NO adopt/loop types, so every node carries an explicit zone —
 * R-3), and that the `decision` nodes (bridge / drain-gate) render as a rhombus
 * (R-4). Pure over Fake ports, mirroring flow-service.test.ts.
 */

const REPO = '/repo';

function deps(): { d: FlowServiceDeps } {
  return {
    d: {
      fs: new FakeFs(),
      clock: new FakeClock('2026-06-19T00:00:00.000Z'),
      git: new FakeGit({
        isRepo: true,
        branch: '026-flow-nav-rail-zone',
        remoteUrl: 'github.com/AI-Substrate/harness-engineering',
      }),
      env: new FakeEnv({}),
    },
  };
}

function create(type: string, slug: string, title: string): FlowDoc {
  const { d } = deps();
  const res = createFlow(
    {
      type,
      slug,
      repoRoot: REPO,
      harnessVersion: '0.4.0',
      path: `/repo/.harness/flows/${slug}.json`,
      title,
    },
    d,
  );
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(res.message);
  return res.doc;
}

const byId = (doc: FlowDoc, id: string): FlowNode | undefined => doc.nodes.find((n) => n.id === id);

describe('bundled overlays', () => {
  it('ships a harness-adopt overlay with the 028 node types', () => {
    const schema = BUNDLED_FLOW_SCHEMAS['harness-adopt'] as {
      nodeTypes?: string[];
      statuses?: string[];
    };
    expect(schema).toBeDefined();
    expect(schema.nodeTypes).toEqual(
      expect.arrayContaining([
        'install',
        'scout',
        'governance',
        'inject',
        'build-boot',
        'decision',
      ]),
    );
    expect(schema.statuses).toEqual(expect.arrayContaining(['todo', 'skipped']));
  });

  it('ships both templates as {cursor, nodes[]} seeds', () => {
    const adopt = BUNDLED_FLOW_TEMPLATES['harness-adopt'] as { cursor?: string; nodes?: unknown[] };
    const loop = BUNDLED_FLOW_TEMPLATES['harness-loop'] as { cursor?: string; nodes?: unknown[] };
    expect(adopt.cursor).toBe('install');
    expect(loop.cursor).toBe('boot');
    expect(Array.isArray(adopt.nodes)).toBe(true);
    expect(Array.isArray(loop.nodes)).toBe(true);
  });
});

describe('🧰 harness-adopt flow', () => {
  const doc = create('harness-adopt', 'adopt', 'adopt');

  it('creates a valid instance positioned at install', () => {
    expect(doc.kind).toBe('harness-adopt');
    expect(doc.nav?.now).toBe('install');
    expect(doc.nodes).toHaveLength(6);
  });

  it('has the spine install → governance → build-boot → bridge', () => {
    expect(byId(doc, 'install')?.next).toEqual(['governance']);
    expect(byId(doc, 'governance')?.next).toEqual(['build-boot']);
    expect(byId(doc, 'build-boot')?.next).toEqual(['bridge']);
  });

  it('terminates at a decision bridge with next:[] (the adopt→loop gate)', () => {
    const bridge = byId(doc, 'bridge');
    expect(bridge?.type).toBe('decision');
    expect(bridge?.next).toEqual([]);
  });

  it('carries scout + inject as branch_of excursions that rejoin FORWARD (028 §4)', () => {
    expect(byId(doc, 'scout')?.branch_of).toBe('install');
    expect(byId(doc, 'inject')?.branch_of).toBe('governance');
    // an excursion rejoins the NEXT required rung, never back to its anchor:
    expect(byId(doc, 'scout')?.next).toEqual(['governance']);
    expect(byId(doc, 'inject')?.next).toEqual(['build-boot']);
  });

  it('bands every node explicitly (R-3)', () => {
    expect(byId(doc, 'install')?.zone).toBe('preflight');
    expect(byId(doc, 'governance')?.zone).toBe('flight');
    expect(byId(doc, 'build-boot')?.zone).toBe('postflight');
    expect(byId(doc, 'bridge')?.zone).toBe('postflight');
  });

  it('renders the bridge as a decision rhombus + excursions dotted (R-4)', () => {
    const md = renderFlow(doc);
    expect(md).toContain('bridge{"Bridge → harness loop?"}:::decision');
    expect(md).toContain('scout -.-> governance');
    expect(md).toContain('inject -.-> build_boot');
  });

  it('rails as [adopt] with the spine only (excursions off the rail)', () => {
    const rail = renderRailLine(doc);
    expect(rail.startsWith('[adopt]')).toBe(true);
    expect(rail).not.toContain('Scout');
    expect(rail).not.toContain('Inject');
  });
});

describe('⚙️ harness-loop flow', () => {
  const doc = create('harness-loop', 'loop', 'harness-loop');

  it('creates a valid instance positioned at boot', () => {
    expect(doc.kind).toBe('harness-loop');
    expect(doc.nav?.now).toBe('boot');
    expect(doc.nodes).toHaveLength(7);
  });

  it('splits retro into drain + harvest and adds the drain-gate decision', () => {
    expect(byId(doc, 'retro-drain')?.type).toBe('retro');
    expect(byId(doc, 'retro-harvest')?.type).toBe('retro');
    expect(byId(doc, 'drain-gate')?.type).toBe('decision');
  });

  it('drain-gate is a REAL decision — both outcomes (028 §5: buffer non-empty?)', () => {
    // non-empty → retro-drain; empty/no-drain → retro-harvest directly
    expect(byId(doc, 'drain-gate')?.next).toEqual(['retro-drain', 'retro-harvest']);
  });

  it('stays acyclic — improve is terminal (next:[]); the cycle is a nav reset', () => {
    expect(byId(doc, 'improve')?.next).toEqual([]);
  });

  it('carries the four fire-hook commands; observe/improve fire none', () => {
    expect(byId(doc, 'boot')?.command).toBe('run /eng-harness-flow --hook pre-flight');
    expect(byId(doc, 'backpressure')?.command).toBe('run /eng-harness-flow --hook pre-coding');
    expect(byId(doc, 'retro-drain')?.command).toBe('run /eng-harness-flow --hook post-coding');
    expect(byId(doc, 'retro-harvest')?.command).toBe('run /eng-harness-flow --hook post-flight');
    expect(byId(doc, 'observe')?.command).toBeUndefined();
    expect(byId(doc, 'improve')?.command).toBeUndefined();
  });

  it('rails as [harness-loop]', () => {
    expect(renderRailLine(doc).startsWith('[harness-loop]')).toBe(true);
  });
});

describe('R-1 — set-node can flag an existing node as a chore', () => {
  it('turns a plain spine node into a command chore (the the-flow seam-node path)', () => {
    const doc = create('harness-loop', 'loop', 'harness-loop');
    const res = setNode(
      doc,
      'boot',
      { chore: { kind: 'command', importance: 'strongly-recommended' } },
      { clock: new FakeClock('2026-06-19T00:01:00.000Z') },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(byId(res.doc, 'boot')?.chore).toEqual({
      kind: 'command',
      importance: 'strongly-recommended',
    });
    // rail pip flips from spine diamond to a chore square
    expect(renderRailLine(res.doc, 'show')).toContain('□ Boot');
  });

  it('rejects an invalid chore importance (E108-class guard, even off-overlay)', () => {
    const doc = create('harness-loop', 'loop', 'harness-loop');
    const res = setNode(
      doc,
      'observe',
      { chore: { kind: 'command', importance: 'required' } },
      { clock: new FakeClock('2026-06-19T00:01:00.000Z') },
    );
    expect(res.ok).toBe(false);
  });

  /**
   * Test Doc — AC-07 idempotency (FT-001).
   * - **Why**: AC-07 promises re-injection/re-flagging is byte-identical. `setNode`
   *   used to unconditionally restamp `modified_at` + append a `node-updated` event,
   *   so re-flagging an already-correct chore churned metadata (retro `idempotent=false`).
   * - **Contract**: when every requested field already equals the node's current value,
   *   `setNode` returns the doc UNCHANGED — same object, no new event, no restamp.
   * - **Usage Notes**: validation (badChore/badZone) still runs before the no-op check.
   * - **Quality Contribution**: makes the R-1 re-injection path deterministically
   *   idempotent, the guarantee the coexist scorer's Gate 2 byte-diff relies on.
   * - **Worked Example**: flag `boot` as a command chore, then flag it again with the
   *   same fields → second call is a no-op (identical events length, identical node).
   */
  it('Given an already-flagged chore, When re-flagged with identical fields, Then it is a byte-identical no-op', () => {
    const doc = create('harness-loop', 'loop', 'harness-loop');
    const fields = { chore: { kind: 'command', importance: 'strongly-recommended' } };
    const first = setNode(doc, 'boot', fields, {
      clock: new FakeClock('2026-06-19T00:01:00.000Z'),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const eventsAfterFirst = first.doc.events.length;
    const bootAfterFirst = JSON.stringify(byId(first.doc, 'boot'));
    // Re-flag with the SAME fields, at a LATER clock — must not restamp or emit.
    const second = setNode(first.doc, 'boot', fields, {
      clock: new FakeClock('2026-06-19T12:00:00.000Z'),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.doc.events.length).toBe(eventsAfterFirst); // no node-updated appended
    expect(JSON.stringify(byId(second.doc, 'boot'))).toBe(bootAfterFirst); // no modified_at churn
    expect(second.doc).toBe(first.doc); // same object returned (unchanged)
  });
});
