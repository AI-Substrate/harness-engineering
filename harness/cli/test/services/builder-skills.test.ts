import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsDocLoader } from '@ai-substrate/dd';
import { MemoizingDocLoader } from '@ai-substrate/dd/links';
import { NodeSchemaFs } from '@ai-substrate/dd/node';
import { ConventionSchemaResolver } from '@ai-substrate/dd/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { NodeFs } from '../../src/adapters/fs/node-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { NodeHash } from '../../src/adapters/hash/node-hash.js';
import { evaluateDdGate } from '../../src/services/flow/flow-dd-gate.js';
import { type DdLink, ddLinkOf, type FlowDoc } from '../../src/services/flow/flow-events.js';
import { applyBatch, setNow } from '../../src/services/flow/flow-mutations.js';
import { createFlow } from '../../src/services/flow/flow-service.js';

/*
Test Doc:
- Why: the source skill must keep product planning separate from implementation guidance,
  and must not require future closeout evidence at an earlier review departure.
- Contract: source overrides instantiate the real flow; review can reach closeout while
  post-flight refuses missing completion evidence. Expansion preserves that distinction.
  Executable examples and local ddocs exercise real services, composition, proof links and refusals.
- Scope: tests use source templates/schema, not the PM-owned generated bundle.
*/
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SOURCE = join(ROOT, 'skills/builder');
const CLOCK = new FakeClock('2026-09-05T00:00:00.000Z');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temp() {
  const root = mkdtempSync(join(tmpdir(), 'builder-skills-'));
  roots.push(root);
  return root;
}

function create(root: string): FlowDoc {
  const result = createFlow(
    {
      type: 'flight-plan',
      slug: 'source-example',
      repoRoot: root,
      harnessVersion: '0.0.0-test',
      path: 'the-flow.json',
      planDir: 'docs/plans/example',
      schemaPath: join(SOURCE, 'references/flight-plan.schema.json'),
      templatePath: join(SOURCE, 'references/flight-plan.template.json'),
    },
    {
      fs: new NodeFs(),
      clock: CLOCK,
      git: new FakeGit({ isRepo: true, branch: 'example' }),
      env: new FakeEnv({}, `${root}/nohome`),
    },
  );
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.doc;
}

function gateDeps(root: string) {
  const fs = new NodeSchemaFs();
  const schemaResolver = new ConventionSchemaResolver({
    fs,
    repoRoot: root,
    home: `${root}/nohome`,
  });
  const docLoader = new MemoizingDocLoader(new FsDocLoader(fs, new NodeHash(), null));
  return {
    clock: CLOCK,
    gate: {
      evaluate: (link: DdLink) =>
        evaluateDdGate(link, { schemaResolver, docLoader }, { repoRoot: root, fromPath: null }),
    },
  };
}

function node(doc: FlowDoc, id: string) {
  const found = doc.nodes.find((entry) => entry.id === id);
  if (!found) throw new Error(`Missing node ${id}`);
  return found;
}

function runExample(file: string, args: string[] = []) {
  const run = spawnSync(process.execPath, [join(SOURCE, 'examples', file), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
  });
  expect(run.error).toBeUndefined();
  expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
  return JSON.parse(run.stdout.trim()) as {
    status: string;
    exercised?: string[];
    root?: string;
    receipts?: string;
  };
}

describe('Builder source lifecycle and runnable examples', () => {
  it('instantiates a distinct guide in the canonical spine without gating on future code', () => {
    const root = temp();
    const doc = create(root);
    expect(node(doc, 'plan').next).toEqual(['impl-guide']);
    expect(node(doc, 'impl-guide').next).toEqual(['phase-1']);
    expect(node(doc, 'impl-guide').command).toBe('/builder 4 guide');
    expect(
      setNow({ ...doc, nav: { now: 'impl-guide', next: null } }, 'phase-1', gateDeps(root)).ok,
    ).toBe(true);
    expect(ddLinkOf(node(doc, 'phase-1'))?.address).toBe(
      'docs/plans/example/assets/tasks/phase-1/tasks.dd.json#tasks',
    );
  });

  it('allows review to reach closeout but refuses post-flight EXIT without its evidence', () => {
    const root = temp();
    const doc = create(root);
    const before = JSON.stringify(doc);
    const review = setNow(
      { ...doc, nav: { now: 'review-1', next: null } },
      'post-flight',
      gateDeps(root),
    );
    expect(review.ok).toBe(true);
    const close = setNow(
      { ...doc, nav: { now: 'post-flight', next: null } },
      'ship',
      gateDeps(root),
    );
    expect(close.ok).toBe(false);
    if (close.ok) throw new Error('Missing closeout unexpectedly passed');
    expect(close.code).toBe('E441');
    expect(JSON.stringify(doc)).toBe(before);
    const forced = setNow(
      { ...doc, nav: { now: 'post-flight', next: null } },
      'ship',
      gateDeps(root),
      { force: true },
    );
    expect(forced.ok).toBe(true);
    if (!forced.ok) throw new Error(JSON.stringify(forced));
    expect(forced.doc.nav?.now).toBe('ship');
  });

  it.each([
    { now: 'review-1', override: false },
    { now: 'post-flight', override: true },
  ])('renders human-only override guidance at $now only when its whole-plan gate applies', ({
    now,
    override,
  }) => {
    const root = temp();
    const doc = create(root);
    const path = join(root, 'the-flow.json');
    new NodeFs().writeText(path, JSON.stringify({ ...doc, nav: { now, next: null } }));
    const run = spawnSync(
      process.execPath,
      [join(ROOT, 'harness/cli/bin/harness.js'), 'flow', 'orient', '--path', path],
      { cwd: root, encoding: 'utf8', timeout: 10000 },
    );
    expect(run.error).toBeUndefined();
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    const boundary =
      "If the gate refuses and departing anyway is the HUMAN's decision, they pass --force — it records a defended override. An agent may not force a dd gate on its own judgment.";
    expect(run.stdout.includes(boundary)).toBe(override);
  });

  it('expands phases through the real batch API without rearming whole-plan review gates', () => {
    const root = temp();
    const doc = create(root);
    const phase = node(doc, 'phase-1');
    const review = node(doc, 'review-1');
    const expanded = applyBatch(
      doc,
      [
        {
          op: 'upsert',
          id: 'phase-2',
          type: 'phase',
          phase: 2,
          label: 'P2',
          status: 'known',
          next: ['review-2'],
          instructions: phase.instructions,
          dd_link: { address: 'docs/plans/example/assets/tasks/phase-2/tasks.dd.json#tasks' },
        },
        {
          op: 'upsert',
          id: 'review-2',
          type: 'review',
          label: 'Review P2',
          status: 'known',
          zone: 'flight',
          next: ['post-flight'],
          instructions: review.instructions,
        },
        { op: 'set', id: 'review-1', next: ['phase-2'] },
      ],
      { clock: CLOCK },
    );
    expect(expanded.ok).toBe(true);
    if (!expanded.ok) throw new Error(JSON.stringify(expanded));
    expect(
      setNow({ ...expanded.doc, nav: { now: 'review-1', next: null } }, 'phase-2', gateDeps(root))
        .ok,
    ).toBe(true);
    expect(
      setNow(
        { ...expanded.doc, nav: { now: 'review-2', next: null } },
        'post-flight',
        gateDeps(root),
      ).ok,
    ).toBe(true);
    expect(
      setNow({ ...expanded.doc, nav: { now: 'post-flight', next: null } }, 'ship', gateDeps(root))
        .ok,
    ).toBe(false);
    expect(ddLinkOf(node(expanded.doc, 'post-flight'))?.check).toBe('plan-validate');
  });

  it('executes independently injected services, actual composition, solo/bad and preservation cases', () => {
    const result = runExample('verify.mjs');
    expect(result.status).toBe('passed');
    expect(result.exercised).toEqual([
      'contracts',
      'parser',
      'renderer',
      'composition',
      'solo',
      'bad',
      'lifecycle',
    ]);
  }, 60000);

  it('executes the documented local ddocs recipe and links actual proof back to criteria', () => {
    const root = join(temp(), 'corpus');
    const result = runExample('proof-recipe.mjs', [root]);
    expect(result.status).toBe('passed');
    const plan = JSON.parse(readFileSync(join(root, 'plan.dd.json'), 'utf8')) as {
      sections: Array<{ name: string; value: unknown }>;
    };
    const criteria = plan.sections.find((section) => section.name === 'acceptance_criteria')
      ?.value as Array<{ state: string; pressure: string; proven_by: string }>;
    expect(criteria[0]?.state).toBe('checked');
    expect(criteria[0]?.pressure).toMatch(/^assets\/backpressure\.dd\.json#rows\/bp-/);
    expect(criteria[0]?.proven_by).toMatch(/^assets\/execution-log\.dd\.json#entries\/lg-/);
    const receipts = JSON.parse(readFileSync(join(root, 'receipts.json'), 'utf8')) as Array<{
      exit_code: number;
      args: string[];
    }>;
    expect(
      receipts.some((receipt) => receipt.args.includes('composition') && receipt.exit_code === 0),
    ).toBe(true);
    expect(receipts[receipts.length - 1]?.exit_code).toBe(1);
  }, 60000);
});
