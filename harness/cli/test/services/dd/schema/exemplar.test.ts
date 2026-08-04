import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveState } from '../../../../src/services/dd/core/derive.js';
import type { DdDoc, DdSection } from '../../../../src/services/dd/core/model.js';
import { parse } from '../../../../src/services/dd/core/parse.js';
import type { DocLoader, DocLoadResult } from '../../../../src/services/dd/core/walk.js';
import { validateWalk } from '../../../../src/services/dd/core/walk.js';
import type { SchemaFs } from '../../../../src/services/dd/schema/model.js';
import {
  ConventionSchemaResolver,
  deriveSchemaState,
} from '../../../../src/services/dd/schema/resolve.js';
import { FIXTURE_ROOT, loadTrees, REPO_ROOT } from './world.js';

const EXEMPLAR = `${FIXTURE_ROOT}/exemplar`;

/** Reads the repository's OWN committed `.dd/schemas/builder/**` packages. */
const fs: SchemaFs = loadTrees(`${REPO_ROOT}/.dd`, EXEMPLAR);
const resolver = new ConventionSchemaResolver({ fs, repoRoot: REPO_ROOT });

function doc(name: string): DdDoc {
  const text = fs.readText(`${EXEMPLAR}/${name}.dd.json`);
  if (text === null) throw new Error(`missing exemplar document: ${name}`);
  const parsed = parse(text);
  if (Array.isArray(parsed)) throw new Error(`exemplar ${name} failed to parse`);
  return parsed;
}

const loader: DocLoader = {
  load(path: string): DocLoadResult {
    const text = fs.readText(path);
    if (text === null) return { ok: false, path, reason: 'missing', message: `missing: ${path}` };
    const parsed = parse(text);
    if (Array.isArray(parsed)) {
      return { ok: false, path, reason: 'missing', message: `unparseable: ${path}` };
    }
    return {
      ok: true,
      path,
      doc: parsed,
      sha: createHash('sha256').update(text).digest('hex'),
      tracked: true,
    };
  },
};

function section(document: DdDoc, name: string): DdSection {
  const found = document.sections.find((entry) => entry.name === name);
  if (!found) throw new Error(`expected a "${name}" section`);
  return found;
}

describe('exemplar builder/* schema packages', () => {
  it.each([
    'builder/plan',
    'builder/backpressure',
    'builder/execution-log',
  ])('%s resolves from <gitroot>/.dd with an in-file description', (name) => {
    const record = resolver.resolveDetailed(name).record;
    expect(record?.root).toBe('gitroot');
    expect(record?.path).toBe(`${REPO_ROOT}/.dd/schemas/${name}/schema.json`);
    expect(record?.description.length).toBeGreaterThan(20);
    expect(record?.shadows).toEqual([]);
  });

  it('validates a real plan document end to end, links and all', () => {
    const issues = validateWalk(
      doc('plan'),
      `${EXEMPLAR}/plan.dd.json`,
      { schemaResolver: resolver, docLoader: loader },
      { repoRoot: REPO_ROOT, depth: 3, mode: 'direct' },
    );
    expect(issues).toEqual([]);
  });

  it('declares D2 link columns on AC rows and on every done_when entry', () => {
    const record = resolver.resolveDetailed('builder/plan').record;
    const acRow = record?.schema.sections.acceptance_criteria?.shape.items?.fields;
    expect(acRow?.pressure).toEqual({
      type: 'link',
      target: 'builder/backpressure/section/rows',
      rel: 'pressure',
    });
    expect(acRow?.proven_by).toEqual({
      type: 'link',
      target: 'builder/execution-log/section/entries',
      rel: 'proven_by',
    });

    // Each task row points at ITS own assertion list, in this document. The
    // `target` pin was suspended for the duration of the `evidence` alias window
    // — a corpus mid-migration could legally land in either section — and
    // tk-7161 restored it when it dropped the alias. With the pin back, a `done`
    // link into anything but `done_when` fails validation, so a task's state can
    // be DERIVED from assertions and derived from nothing else.
    expect(record?.schema.sections.tasks?.shape.items?.fields?.done).toEqual({
      type: 'link',
      target: 'builder/plan/section/done_when',
      rel: 'derives',
    });
  });

  /**
   * The alias is GONE (tk-7161), and this test is what stops it coming back.
   *
   * It was introduced with a leash — a test naming the task that had to remove
   * it — precisely so the deprecation could not quietly become permanent. That
   * task has now run, so the leash inverts: `evidence` must not exist, and
   * `done_when` must be the only place an assertion list can live. A schema
   * carrying both again would make `tasks[].done` ambiguous, which is the
   * ambiguity the target pin was suspended for and has now been restored to
   * forbid.
   */
  it('has DROPPED the `evidence` alias — done_when is the only assertion section', () => {
    const record = resolver.resolveDetailed('builder/plan').record;
    expect(record?.schema.sections.done_when).toBeDefined();
    expect(record?.schema.sections.evidence).toBeUndefined();
    // The description records what happened rather than pretending it never did:
    // a reader meeting a frozen `evidence` corpus needs to know where it went.
    expect(record?.description).toContain('deprecated `evidence` alias was dropped');
    expect(record?.description).toContain('tk-7161');

    // Mandatory pressure has nothing left to be asymmetric with — every assertion
    // authored under this schema names its instrument or fails.
    const living = record?.schema.sections.done_when?.shape.valuesShape?.items?.required;
    expect(living).toContain('pressure');
  });

  it('keys the done_when section by the owning task id — a map, not an id-bearing row', () => {
    // workshop-002 Ruling 3: `tk-9f2a:` is a KEY. As an id-bearing array entry it
    // would collide with the task row's own id (ids are unique per FILE), which is
    // exactly what a live `dd validate` reported before this shape was adopted.
    const evidence = section(doc('plan'), 'done_when').value as Record<string, unknown>;
    expect(Array.isArray(evidence)).toBe(false);
    const taskIds = (section(doc('plan'), 'tasks').value as { id: string }[]).map(
      (task) => task.id,
    );
    expect(Object.keys(evidence).sort()).toEqual([...taskIds].sort());
    expect(
      validateWalk(
        doc('plan'),
        `${EXEMPLAR}/plan.dd.json`,
        { schemaResolver: resolver, docLoader: loader },
        { repoRoot: REPO_ROOT, depth: 0, mode: 'direct' },
      ).filter((issue) => issue.class === 'duplicate-id'),
    ).toEqual([]);
  });

  it('still derives the gate through the map — ownership kept, nothing self-reported', () => {
    const record = resolver.resolveDetailed('builder/plan').record;
    if (!record) throw new Error('expected builder/plan to resolve');
    const evidence = section(doc('plan'), 'done_when');

    // Six assertions across two tasks; `human-skipped` passes, the one `unchecked`
    // entry is what holds the gate — and it is named, not merely counted.
    expect(deriveSchemaState(record, evidence)).toMatchObject({
      complete: false,
      total: 6,
      terminal: 5,
      incomplete: ['dw-b013'],
    });
    expect(deriveState(evidence)).toEqual(deriveSchemaState(record, evidence));
  });

  it('carries a human-skipped receipt with the human words, as the convention requires', () => {
    const evidence = section(doc('plan'), 'done_when').value as Record<
      string,
      { id: string; state: string; receipt?: string }[]
    >;
    const skipped = Object.values(evidence)
      .flat()
      .filter((entry) => entry.state === 'human-skipped');
    expect(skipped.length).toBeGreaterThan(0);
    for (const entry of skipped) {
      expect(entry.receipt ?? '').toMatch(/\w+, \d{4}-\d{2}-\d{2}: /);
    }
  });
});
