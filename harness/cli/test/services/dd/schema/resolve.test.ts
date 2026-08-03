import { describe, expect, it } from 'vitest';
import { validateDocument } from '../../../../src/services/dd/core/validate.js';
import type { SchemaFs } from '../../../../src/services/dd/schema/model.js';
import {
  ConventionSchemaResolver,
  deriveSchemaState,
} from '../../../../src/services/dd/schema/resolve.js';
import { fixtureDocFrom } from './helpers.js';
import { loadSchemaWorld } from './world.js';

function resolverFor(caseName: string) {
  const world = loadSchemaWorld(caseName);
  return {
    world,
    resolver: new ConventionSchemaResolver({
      fs: world.fs,
      repoRoot: world.repoRoot,
      home: world.home,
    }),
  };
}

function errors(issues: { severity: string; class: string }[]): string[] {
  return issues.filter((issue) => issue.severity === 'ERROR').map((issue) => issue.class);
}

describe('dd schema resolution — precedence', () => {
  it('resolves the doc-folder copy first and records every shadow in precedence order', () => {
    const { world, resolver } = resolverFor('precedence-chain');
    const resolution = resolver.resolveDetailed('builder/plan', world.doc('plan.dd.json'));

    expect(resolution.record?.description).toBe('plan schema from the doc-folder root');
    expect(resolution.record?.root).toBe('doc-folder');
    expect(resolution.record?.path).toBe(world.path('repo/docs/schemas/builder/plan/schema.json'));
    expect(resolution.record?.shadows.map((shadow) => shadow.root)).toEqual([
      'gitroot',
      'harness',
      'home',
    ]);
    expect(resolution.record?.shadows.map((shadow) => shadow.path)).toEqual([
      world.path('repo/.dd/schemas/builder/plan/schema.json'),
      world.path('repo/.harness/.dd/schemas/builder/plan/schema.json'),
      world.path('home/.dd/schemas/builder/plan/schema.json'),
    ]);
    expect(resolution.issues.map((issue) => [issue.class, issue.severity])).toEqual([
      ['shadowed', 'WARN'],
      ['shadowed', 'WARN'],
      ['shadowed', 'WARN'],
    ]);
  });

  it('falls to the gitroot root when no document folder is in play', () => {
    const { resolver } = resolverFor('precedence-chain');
    expect(resolver.resolveDetailed('builder/plan').record?.description).toBe(
      'plan schema from the gitroot root',
    );
  });

  it('finds a package buried deep beneath its root', () => {
    const { world, resolver } = resolverFor('deep-scan');
    const resolution = resolver.resolveDetailed('builder/plan', world.doc('plan.dd.json'));
    expect(resolution.record?.path).toBe(
      world.path('repo/.dd/team/shared/nested/schemas/builder/plan/schema.json'),
    );
    expect(resolution.record?.shadows).toEqual([]);
  });

  it('always carries the resolved absolute path on the result', () => {
    const { world, resolver } = resolverFor('single-root');
    const record = resolver.resolveDetailed('builder/plan', world.doc('plan.dd.json')).record;
    expect(record?.path).toBe(world.path('repo/.dd/schemas/builder/plan/schema.json'));
    expect(record?.shadows).toEqual([]);
  });
});

describe('dd schema resolution — failure classes', () => {
  it('E412: a duplicate qualified name inside ONE root is a hard error', () => {
    const { world, resolver } = resolverFor('duplicate-in-root');
    const resolution = resolver.resolveDetailed('builder/plan', world.doc('plan.dd.json'));
    expect(resolution.record).toBeUndefined();
    expect(errors(resolution.issues)).toEqual(['name-conflict']);
    expect(resolution.issues[0]?.message).toContain('is defined 2 times inside the gitroot root');
    expect(resolution.issues[0]?.message).toContain('vendor/schemas/builder/plan/schema.json');
  });

  it('E411: a malformed package fails with a located reason', () => {
    const { world, resolver } = resolverFor('malformed-package');
    const resolution = resolver.resolveDetailed('builder/plan', world.doc('plan.dd.json'));
    expect(resolution.record).toBeUndefined();
    expect(errors(resolution.issues)).toEqual(['package-invalid']);
    expect(resolution.issues[0]?.location).toBe('$.sections');

    const notes = resolver.resolveDetailed('builder/notes', world.doc('plan.dd.json'));
    expect(errors(notes.issues)).toEqual(['package-invalid']);
  });

  it('E414: an unsupported dd_schema version is refused, not guessed at', () => {
    const { world, resolver } = resolverFor('unsupported-version');
    const resolution = resolver.resolveDetailed('builder/plan', world.doc('plan.dd.json'));
    expect(errors(resolution.issues)).toEqual(['version-unsupported']);
    expect(resolution.issues[0]?.message).toContain('dd_schema 99');
  });

  it.each([
    ['builder/subset', 'gate_terminal names'],
    ['builder/unbound', 'is not declared'],
    ['builder/conflicting', 'different gate_terminal sets'],
  ])('E415: %s is an invalid enum/gate-terminal declaration', (name, needle) => {
    const { world, resolver } = resolverFor('invalid-enum');
    const resolution = resolver.resolveDetailed(name, world.doc('plan.dd.json'));
    expect(resolution.record).toBeUndefined();
    expect(errors(resolution.issues)).toContain('enum-invalid');
    expect(resolution.issues.map((issue) => issue.message).join('\n')).toContain(needle);
  });

  it('E416: a failing port becomes honest scan-failed issues, never a throw', () => {
    const throwing: SchemaFs = {
      readdir() {
        throw new Error('EIO: simulated readdir failure');
      },
      exists: () => false,
      readText: () => null,
    };
    const resolver = new ConventionSchemaResolver({ fs: throwing, repoRoot: '/repo' });
    const resolution = resolver.resolveDetailed('builder/plan', '/repo/docs/plan.dd.json');
    // One per root: a chain you could not read cannot be claimed as first-hit-wins.
    expect(errors(resolution.issues)).toEqual(['scan-failed', 'scan-failed', 'scan-failed']);
    expect(resolution.issues.map((issue) => issue.path)).toEqual([
      '/repo/docs',
      '/repo/.dd',
      '/repo/.harness/.dd',
    ]);
    expect(resolver.resolve('builder/plan', '/repo/docs/plan.dd.json')).toEqual({
      ok: false,
      message: expect.stringContaining('schema-root discovery failed'),
    });
  });

  it('E417: a traversing schema name never reaches the filesystem', () => {
    const { world, resolver } = resolverFor('single-root');
    const resolution = resolver.resolveDetailed('../../escape/plan', world.doc('plan.dd.json'));
    expect(errors(resolution.issues)).toEqual(['path-escape']);
  });

  it('E410: an absent qualified name names the roots it searched', () => {
    const { world, resolver } = resolverFor('single-root');
    const resolution = resolver.resolveDetailed('builder/nowhere', world.doc('plan.dd.json'));
    expect(errors(resolution.issues)).toEqual(['schema-not-found']);
    expect(resolution.issues[0]?.message).toContain('/repo/.dd');
  });

  it('E410: a name that is not `<pkg>/<schema>` is refused before any scan', () => {
    const { resolver } = resolverFor('single-root');
    expect(errors(resolver.resolveDetailed('plan').issues)).toEqual(['schema-not-found']);
    expect(errors(resolver.resolveDetailed('a/b/c').issues)).toEqual(['schema-not-found']);
  });
});

describe('dd schema resolution — declarations flow through to the engine', () => {
  it('a custom enum both widens the vocabulary and moves the gate-terminal set', () => {
    const { world, resolver } = resolverFor('custom-enum');
    const record = resolver.resolveDetailed('builder/review', world.doc('review.dd.json')).record;
    expect(record?.gateTerminal).toEqual(['approved', 'waived']);
    expect(record?.schema.enums?.review?.values).toEqual([
      'draft',
      'in-review',
      'approved',
      'waived',
    ]);

    const doc = fixtureDocFrom(world, 'custom-enum/repo/docs/review.dd.json');
    expect(validateDocument(doc, world.doc('review.dd.json'), resolver, world.repoRoot)).toEqual(
      [],
    );
  });

  it('a value outside the declared enum is an ERROR through the real resolver', () => {
    const { world, resolver } = resolverFor('custom-enum');
    const doc = fixtureDocFrom(world, 'custom-enum/repo/docs/review-bad-value.dd.json');
    const issues = validateDocument(
      doc,
      world.doc('review-bad-value.dd.json'),
      resolver,
      world.repoRoot,
    );
    expect(issues.map((issue) => issue.class)).toEqual(['enum-invalid']);
    expect(issues[0]?.message).toContain('draft, in-review, approved, waived');
  });

  it('the declared gate_terminal set changes what deriveState calls complete', () => {
    const { world, resolver } = resolverFor('custom-enum');
    const record = resolver.resolveDetailed('builder/review', world.doc('review.dd.json')).record;
    if (!record) throw new Error('expected builder/review to resolve');

    const complete = fixtureDocFrom(world, 'custom-enum/repo/docs/review.dd.json');
    const incomplete = fixtureDocFrom(world, 'custom-enum/repo/docs/review-incomplete.dd.json');
    const tasksOf = (doc: { sections: { name: string; value: unknown }[] }) => {
      const section = doc.sections.find((entry) => entry.name === 'tasks');
      if (!section) throw new Error('expected a tasks section');
      return section;
    };

    expect(deriveSchemaState(record, tasksOf(complete))).toMatchObject({
      complete: true,
      terminal: 2,
      total: 2,
    });
    expect(deriveSchemaState(record, tasksOf(incomplete))).toMatchObject({
      complete: false,
      incomplete: ['tk-3c4d'],
    });
    // The built-in default would call `approved`/`in-review` incomplete either way —
    // the schema's own declaration is what makes the first document gate-terminal.
    expect(record.gateTerminal).not.toEqual(['checked', 'human-skipped', 'na']);
  });

  it('substituting the real resolver keeps the P1 validate contract green', () => {
    const { world, resolver } = resolverFor('single-root');
    const good = fixtureDocFrom(world, 'single-root/repo/docs/plan.dd.json');
    expect(validateDocument(good, world.doc('plan.dd.json'), resolver, world.repoRoot)).toEqual([]);

    const bad = fixtureDocFrom(world, 'single-root/repo/docs/invalid-plan.dd.json');
    expect(
      validateDocument(bad, world.doc('invalid-plan.dd.json'), resolver, world.repoRoot).map(
        (issue) => [issue.class, issue.severity],
      ),
    ).toEqual([['state-note-required', 'ERROR']]);

    const unresolvable = fixtureDocFrom(world, 'single-root/repo/docs/unknown-schema.dd.json');
    expect(
      validateDocument(
        unresolvable,
        world.doc('unknown-schema.dd.json'),
        resolver,
        world.repoRoot,
      ).map((issue) => issue.class),
    ).toEqual(['schema-unresolvable']);
  });
});

describe('dd schema listing', () => {
  it('lists every visible schema with its path and shadow chain', () => {
    const { world, resolver } = resolverFor('precedence-chain');
    const listing = resolver.list(world.doc('plan.dd.json'));
    expect(listing.roots.map((root) => root.kind)).toEqual([
      'doc-folder',
      'gitroot',
      'harness',
      'home',
    ]);
    expect(listing.entries).toHaveLength(1);
    expect(listing.entries[0]?.record?.root).toBe('doc-folder');
    expect(listing.entries[0]?.record?.shadows).toHaveLength(3);
  });

  it('keeps an unloadable package visible with the reason it failed', () => {
    const { world, resolver } = resolverFor('malformed-package');
    const listing = resolver.list(world.doc('plan.dd.json'));
    expect(listing.entries.map((entry) => entry.name)).toEqual(['builder/notes', 'builder/plan']);
    for (const entry of listing.entries) {
      expect(entry.record).toBeUndefined();
      expect(errors(entry.issues)).toEqual(['package-invalid']);
    }
  });
});
