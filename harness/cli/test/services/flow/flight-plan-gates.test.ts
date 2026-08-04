import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSchemaFs } from '../../../src/acts/dd/schema-fs.js';
import { FsDocLoader } from '../../../src/acts/dd/shared.js';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { NodeHash } from '../../../src/adapters/hash/node-hash.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import { MemoizingDocLoader } from '../../../src/services/dd/links/index.js';
import { ConventionSchemaResolver } from '../../../src/services/dd/schema/index.js';
import { evaluateDdGate } from '../../../src/services/flow/flow-dd-gate.js';
import { type DdLink, ddLinkOf, type FlowNode } from '../../../src/services/flow/flow-events.js';
import { setNow } from '../../../src/services/flow/flow-mutations.js';
import { createFlow } from '../../../src/services/flow/flow-service.js';

/**
 * tk-7133 / dw-0005 + dw-0006 — the template authors the gates, and a pre-JIT
 * departure refuses.
 *
 * Two halves of one property. The first: a flow created from the shipped
 * flight-plan template already carries its gates, so nothing has to remember to
 * add them. The second, which matters more: a gate pointed at a task file that
 * has not been born yet must REFUSE — a gate that passes because its target is
 * missing is worse than no gate, because it reports safety it never checked.
 */

const REFERENCES = '../../../../../skills/builder/references';
const TEMPLATE_PATH = fileURLToPath(
  new URL(`${REFERENCES}/flight-plan.template.json`, import.meta.url),
);
/** The flight-plan overlay is not bundled — the-flow passes it with `--schema`, so this does too. */
const SCHEMA_PATH = fileURLToPath(
  new URL(`${REFERENCES}/flight-plan.schema.json`, import.meta.url),
);

let root = '';

afterEach(() => {
  if (root.length > 0) rmSync(root, { recursive: true, force: true });
  root = '';
});

function templateNodes(): FlowNode[] {
  return (JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8')) as { nodes: FlowNode[] }).nodes;
}

function nodeById(nodes: readonly FlowNode[], id: string): FlowNode {
  const node = nodes.find((n) => n.id === id);
  if (node === undefined) throw new Error(`template lost node ${id}`);
  return node;
}

function serviceDeps() {
  return {
    fs: new NodeFs(),
    clock: new FakeClock('2026-08-04T00:00:00.000Z'),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    env: new FakeEnv({}, `${root}/nohome`),
  };
}

function create(planDir?: string) {
  return createFlow(
    {
      type: 'flight-plan',
      slug: 'demo',
      repoRoot: root,
      harnessVersion: '0.0.0-test',
      path: '.harness/flows/demo.json',
      schemaPath: SCHEMA_PATH,
      templatePath: TEMPLATE_PATH,
      ...(planDir !== undefined && { planDir }),
    },
    serviceDeps(),
  );
}

describe('dw-0005 — the shipped template carries both gate kinds', () => {
  it('gates phase-1 on its own task file, by BARE ORDINAL', () => {
    const link = ddLinkOf(nodeById(templateNodes(), 'phase-1'));
    expect(link?.address).toBe('assets/tasks/phase-1/tasks.dd.json#tasks');
    // The stated amendment to #90's `phase-N-<kebab-title>`: an ordinal is
    // knowable before titles exist, and retitling a phase must never move its
    // task-file address.
    expect(link?.address).not.toMatch(/phase-1-[a-z]/);
    expect(link?.check).toBeUndefined();
  });

  it('gates the last review on the plan validator', () => {
    const link = ddLinkOf(nodeById(templateNodes(), 'review-1'));
    expect(link?.check).toBe('plan-validate');
    expect(link?.address).toBe('plan.dd.json');
  });

  it('writes both addresses RELATIVE to the plan folder — a static template knows no folder', () => {
    for (const id of ['phase-1', 'review-1']) {
      const address = ddLinkOf(nodeById(templateNodes(), id))?.address ?? '';
      expect(address.startsWith('/')).toBe(false);
      expect(address.startsWith('docs/')).toBe(false);
    }
  });
});

describe('dw-0005 — `flow create --plan-dir` anchors those addresses', () => {
  it('prefixes every relative gate address with the plan folder', () => {
    root = mkdtempSync(join(tmpdir(), 'anchor-'));
    const created = create('docs/plans/071-dd-native-builder');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');

    expect(ddLinkOf(nodeById(created.doc.nodes, 'phase-1'))?.address).toBe(
      'docs/plans/071-dd-native-builder/assets/tasks/phase-1/tasks.dd.json#tasks',
    );
    expect(ddLinkOf(nodeById(created.doc.nodes, 'review-1'))?.address).toBe(
      'docs/plans/071-dd-native-builder/plan.dd.json',
    );
    // The check kind survives the rewrite — only the address moves.
    expect(ddLinkOf(nodeById(created.doc.nodes, 'review-1'))?.check).toBe('plan-validate');
    expect(created.doc.plan_dir).toBe('docs/plans/071-dd-native-builder');
  });

  it('normalizes a trailing slash and a leading ./', () => {
    root = mkdtempSync(join(tmpdir(), 'anchor-'));
    const created = create('./docs/plans/x/');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');
    expect(created.doc.plan_dir).toBe('docs/plans/x');
    expect(ddLinkOf(nodeById(created.doc.nodes, 'review-1'))?.address).toBe(
      'docs/plans/x/plan.dd.json',
    );
  });

  it('WITHOUT the flag, nothing is anchored and nothing is recorded — byte-identity', () => {
    // The control the ruling asked for by name. `--plan-dir` is additive, and
    // additive has to mean invisible when unused: a flow created the old way must
    // be the bytes it was before the option existed.
    root = mkdtempSync(join(tmpdir(), 'anchor-'));
    const created = create();
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');

    expect(created.doc.plan_dir).toBeUndefined();
    expect(ddLinkOf(nodeById(created.doc.nodes, 'phase-1'))?.address).toBe(
      'assets/tasks/phase-1/tasks.dd.json#tasks',
    );
    expect(ddLinkOf(nodeById(created.doc.nodes, 'review-1'))?.address).toBe('plan.dd.json');
    // And the template's own nodes are not mutated in place — a create must not
    // poison the next one in the same process.
    expect(ddLinkOf(nodeById(templateNodes(), 'phase-1'))?.address).toBe(
      'assets/tasks/phase-1/tasks.dd.json#tasks',
    );
  });

  it('refuses to bake an ABSOLUTE plan dir into a committed flow', () => {
    // A machine-specific prefix in a committed document is worse than no prefix:
    // the gates would resolve on exactly one laptop.
    root = mkdtempSync(join(tmpdir(), 'anchor-'));
    const created = create('/Users/someone/repo/docs/plans/x');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');
    expect(created.doc.plan_dir).toBeUndefined();
    expect(ddLinkOf(nodeById(created.doc.nodes, 'review-1'))?.address).toBe('plan.dd.json');
  });

  it('leaves an already-anchored address alone', () => {
    root = mkdtempSync(join(tmpdir(), 'anchor-'));
    const created = create('docs/plans/x');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');
    // Anchoring is idempotent: the address is already inside the plan dir, so a
    // second pass must not produce `docs/plans/x/docs/plans/x/…`.
    const second = createFlow(
      {
        type: 'flight-plan',
        slug: 'demo2',
        repoRoot: root,
        harnessVersion: '0.0.0-test',
        path: '.harness/flows/demo2.json',
        schemaPath: SCHEMA_PATH,
        templatePath: TEMPLATE_PATH,
        planDir: 'docs/plans/x',
      },
      serviceDeps(),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(ddLinkOf(nodeById(second.doc.nodes, 'review-1'))?.address).toBe(
      'docs/plans/x/plan.dd.json',
    );
  });
});

describe('dw-0006 — a pre-JIT departure REFUSES, it never passes vacuously', () => {
  function gateDeps() {
    const fs = new NodeSchemaFs();
    return {
      schemaResolver: new ConventionSchemaResolver({ fs, repoRoot: root, home: `${root}/nohome` }),
      docLoader: new MemoizingDocLoader(new FsDocLoader(fs, new NodeHash(), null)),
    };
  }

  it('refuses a completion gate whose task file has not been born yet', () => {
    root = mkdtempSync(join(tmpdir(), 'prejit-'));
    const created = create('docs/plans/x');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');

    // The plan folder exists in the flow; the task file does not exist on disk —
    // exactly the state between `1b plan` and `5 tasks`.
    const link = ddLinkOf(nodeById(created.doc.nodes, 'phase-1')) as DdLink;
    const result = evaluateDdGate(link, gateDeps(), { repoRoot: root, fromPath: null });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    // NOT "complete: true with zero items". A gate that reports success because it
    // found nothing to check is a gate that reports safety it never verified.
    expect(result.reason).toBe('target-invalid');
  });

  it('refuses the DEPARTURE too, with E441 and nothing written', () => {
    root = mkdtempSync(join(tmpdir(), 'prejit-'));
    const created = create('docs/plans/x');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');

    const doc = { ...created.doc, nav: { now: 'phase-1', next: null } };
    const before = JSON.stringify(doc);
    const deps = {
      clock: new FakeClock('2026-08-04T09:00:00.000Z'),
      gate: {
        evaluate: (link: DdLink) =>
          evaluateDdGate(link, gateDeps(), { repoRoot: root, fromPath: null }),
      },
    };
    const result = setNow(doc, 'review-1', deps);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe(ErrorCodes.DD_GATE_TARGET_INVALID);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('refuses a pre-JIT CHECK gate as well — no plan document, no green', () => {
    root = mkdtempSync(join(tmpdir(), 'prejit-'));
    const created = create('docs/plans/x');
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');

    const link = ddLinkOf(nodeById(created.doc.nodes, 'review-1')) as DdLink;
    const result = evaluateDdGate(link, gateDeps(), { repoRoot: root, fromPath: null });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('target-invalid');
  });
});
