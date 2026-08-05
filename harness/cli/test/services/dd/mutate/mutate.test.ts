import { describe, expect, it } from 'vitest';
import type { DdDoc } from '../../../../src/services/dd/core/model.js';
import {
  coerceValue,
  collectIds,
  ddAdd,
  ddGet,
  ddRemove,
  ddSet,
  locate,
  mintId,
  normalizePrefix,
  serializeDoc,
} from '../../../../src/services/dd/mutate/index.js';
import { EVIDENCE_SCHEMA, FixtureSchemaResolver } from '../helpers.js';

const RESOLVER = new FixtureSchemaResolver();
const DEPS = {
  schema: EVIDENCE_SCHEMA,
  schemaResolver: RESOLVER,
  repoRoot: '/repo',
  path: '/repo/docs/plan.dd.json',
};

function doc(): DdDoc {
  return {
    dd: { schema: 'test/evidence-plan' },
    sections: [
      {
        name: 'tasks',
        value: [
          { id: 'tk-0001', title: 'first', state: 'unchecked', done: '#evidence/tk-0001' },
          { id: 'tk-0002', title: 'second', state: 'checked' },
        ],
      },
      {
        name: 'evidence',
        value: {
          'tk-0001': [{ id: 'dw-0001', assertion: 'it holds', state: 'unchecked' }],
        },
      },
    ],
    references: [],
  };
}

describe('dd mutate — locate (shape-directed, parent-aware)', () => {
  it('resolves section, instance and part addresses', () => {
    const section = locate(doc(), EVIDENCE_SCHEMA, ['tasks']);
    expect(section.ok && section.kind).toBe('section');
    expect(section.ok && section.parent).toBeNull();

    const instance = locate(doc(), EVIDENCE_SCHEMA, ['tasks', 'tk-0002']);
    expect(instance.ok && instance.kind).toBe('instance');
    expect(instance.ok && instance.key).toBe(1);

    const part = locate(doc(), EVIDENCE_SCHEMA, ['tasks', 'tk-0002', 'state']);
    expect(part.ok && part.kind).toBe('part');
    expect(part.ok && part.value).toBe('checked');
  });

  it('steps a dynamic-key map by its own key, and calls it an instance', () => {
    const entry = locate(doc(), EVIDENCE_SCHEMA, ['evidence', 'tk-0001']);
    expect(entry.ok && entry.kind).toBe('instance');
    expect(entry.ok && Array.isArray(entry.value)).toBe(true);
  });

  it('refuses an unknown section, an unknown id and a leaf that cannot contain', () => {
    expect(locate(doc(), EVIDENCE_SCHEMA, ['nope'])).toMatchObject({
      ok: false,
      reason: 'section-unknown',
    });
    expect(locate(doc(), EVIDENCE_SCHEMA, ['tasks', 'tk-9999'])).toMatchObject({
      ok: false,
      reason: 'target-unknown',
    });
    expect(locate(doc(), EVIDENCE_SCHEMA, ['tasks', 'tk-0001', 'state', 'deeper'])).toMatchObject({
      ok: false,
      reason: 'container-invalid',
    });
  });

  it('opens a missing tail ONLY under permissiveTail, and only at the tail', () => {
    expect(locate(doc(), EVIDENCE_SCHEMA, ['evidence', 'tk-0002'])).toMatchObject({
      ok: false,
      reason: 'target-unknown',
    });
    const born = locate(doc(), EVIDENCE_SCHEMA, ['evidence', 'tk-0002'], { permissiveTail: true });
    expect(born.ok && born.value).toBeUndefined();
    // Mid-path misses stay misses: the tail exception never conjures a chain.
    expect(
      locate(doc(), EVIDENCE_SCHEMA, ['evidence', 'tk-0002', 'x'], { permissiveTail: true }),
    ).toMatchObject({ ok: false, reason: 'target-unknown' });
  });
});

describe('dd mutate — coerceValue reads the DECLARED type', () => {
  it.each([
    ['int', '3', 3],
    ['number', '1.5', 1.5],
    ['bool', 'true', true],
    ['string', '3', '3'],
    ['state', 'checked', 'checked'],
  ])('reads a %s cell', (type, raw, expected) => {
    const result = coerceValue(raw, { type }, false);
    expect(result.ok && result.value).toStrictEqual(expected);
  });

  it('refuses a value the declared type cannot hold', () => {
    expect(coerceValue('lots', { type: 'int' }, false)).toMatchObject({
      ok: false,
      reason: 'value-invalid',
    });
    expect(coerceValue('yes', { type: 'bool' }, false)).toMatchObject({
      ok: false,
      reason: 'value-invalid',
    });
    expect(coerceValue('[]', { type: 'array' }, false)).toMatchObject({
      ok: false,
      reason: 'value-invalid',
    });
  });

  it('takes structural values only through the explicit --value-json door', () => {
    const good = coerceValue('["a","b"]', { type: 'array' }, true);
    expect(good.ok && good.value).toStrictEqual(['a', 'b']);
    expect(coerceValue('{not json', undefined, true)).toMatchObject({
      ok: false,
      reason: 'value-invalid',
    });
  });
});

describe('dd mutate — id minting (the DF-008 bug class, made unrepresentable)', () => {
  it('mints the next id ABOVE the highest in the series, per prefix', () => {
    expect(mintId(doc(), 'tk')).toStrictEqual({ ok: true, id: 'tk-0003' });
    expect(mintId(doc(), 'dw')).toStrictEqual({ ok: true, id: 'dw-0002' });
    // A prefix with nothing in the document starts at one, never at zero.
    expect(mintId(doc(), 'ac')).toStrictEqual({ ok: true, id: 'ac-0001' });
  });

  it('never repeats an id already anywhere in the FILE', () => {
    const seeded = doc();
    const ids = new Set<string>();
    let current = seeded;
    for (let n = 0; n < 12; n += 1) {
      const minted = mintId(current, 'dw');
      expect(minted.ok).toBe(true);
      if (!minted.ok) return;
      expect(ids.has(minted.id)).toBe(false);
      ids.add(minted.id);
      const added = ddAdd(
        current,
        ['evidence', 'tk-0001'],
        '{"assertion":"a","state":"unchecked"}',
        {
          ...DEPS,
          mint: 'dw',
        },
      );
      expect(added.ok).toBe(true);
      if (!added.ok) return;
      current = added.doc;
    }
    expect(ids.size).toBe(12);
    expect(collectIds(current).size).toBe(15);
  });

  it('accepts `tk`, `tk-` and `TK`, and refuses an unregistered prefix', () => {
    expect(normalizePrefix('tk')).toBe('tk-');
    expect(normalizePrefix('tk-')).toBe('tk-');
    expect(normalizePrefix('TK')).toBe('tk-');
    expect(normalizePrefix('zz')).toBeNull();
    expect(mintId(doc(), 'zz')).toMatchObject({
      ok: false,
      reason: 'mint-prefix-unregistered',
    });
  });
});

describe('dd mutate — the write gate runs BEFORE anything changes', () => {
  it('refuses a set that would break the schema, and leaves the document untouched', () => {
    const before = doc();
    const snapshot = JSON.stringify(before);
    const result = ddSet(before, ['tasks', 'tk-0001', 'state'], 'donezo', DEPS);
    expect(result).toMatchObject({ ok: false, reason: 'schema-refused' });
    expect(result.ok === false && result.introduced?.[0]?.class).toBe('enum-invalid');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('refuses an add that would duplicate an id', () => {
    const result = ddAdd(
      doc(),
      ['tasks'],
      '{"id":"tk-0001","title":"clash","state":"unchecked"}',
      DEPS,
    );
    expect(result).toMatchObject({ ok: false, reason: 'schema-refused' });
    expect(result.ok === false && result.introduced?.[0]?.class).toBe('duplicate-id');
  });

  it('still allows a repair on a document that was ALREADY invalid', () => {
    const broken = doc();
    const rows = broken.sections[0]?.value as Array<Record<string, unknown>>;
    Object.assign(rows[0] ?? {}, { state: 'donezo' });
    const repaired = ddSet(broken, ['tasks', 'tk-0001', 'state'], 'checked', DEPS);
    expect(repaired.ok).toBe(true);
    // Touching an UNRELATED cell is also allowed — the gate is a diff, not a bar.
    const unrelated = ddSet(broken, ['tasks', 'tk-0002', 'title'], 'renamed', DEPS);
    expect(unrelated.ok).toBe(true);
  });
});

describe('dd mutate — the four verbs', () => {
  it('get reads without writing', () => {
    const result = ddGet(doc(), EVIDENCE_SCHEMA, ['tasks', 'tk-0002', 'title']);
    expect(result.ok && result.value).toBe('second');
  });

  it('set replaces a part, an instance and a whole section', () => {
    const part = ddSet(doc(), ['tasks', 'tk-0001', 'title'], 'renamed', DEPS);
    expect(part.ok && (part.doc.sections[0]?.value as { title: string }[])[0]?.title).toBe(
      'renamed',
    );

    const instance = ddSet(
      doc(),
      ['tasks', 'tk-0002'],
      '{"id":"tk-0002","title":"replaced","state":"na","note":"why"}',
      { ...DEPS, asJson: true },
    );
    expect(instance.ok && (instance.doc.sections[0]?.value as { title: string }[])[1]?.title).toBe(
      'replaced',
    );

    const section = ddSet(doc(), ['evidence'], '{}', { ...DEPS, asJson: true });
    expect(section.ok && section.doc.sections[1]?.value).toStrictEqual({});
  });

  it('set CREATES an absent optional field, but never conjures a missing instance', () => {
    // "Make it this" has to work on a field that was never there — a task row
    // that has not carried a `done` link yet is the ordinary case, not an error.
    const created = ddSet(doc(), ['tasks', 'tk-0002', 'done'], '#evidence/tk-0002', DEPS);
    expect(created.ok && (created.doc.sections[0]?.value as { done: string }[])[1]?.done).toBe(
      '#evidence/tk-0002',
    );
    // An array member is found by id, so a missing id is a genuine miss.
    expect(ddSet(doc(), ['tasks', 'tk-9999', 'state'], 'checked', DEPS)).toMatchObject({
      ok: false,
      reason: 'target-unknown',
    });
    // And the write gate still judges the result, so permissiveness cannot
    // produce an invalid document.
    expect(ddSet(doc(), ['tasks', 'tk-0002', 'state'], 'donezo', DEPS)).toMatchObject({
      ok: false,
      reason: 'schema-refused',
    });
  });

  it('add appends to a list and creates a JIT-born map entry', () => {
    const appended = ddAdd(doc(), ['tasks'], '{"title":"third","state":"unchecked"}', {
      ...DEPS,
      mint: 'tk',
    });
    expect(appended.ok && appended.minted).toBe('tk-0003');
    expect(appended.ok && (appended.doc.sections[0]?.value as unknown[]).length).toBe(3);
    // The minted id leads the row, exactly as every hand-authored instance does.
    expect(
      appended.ok && Object.keys((appended.doc.sections[0]?.value as object[])[2] ?? {})[0],
    ).toBe('id');

    const born = ddAdd(
      doc(),
      ['evidence', 'tk-0002'],
      '[{"id":"dw-0002","assertion":"new","state":"unchecked"}]',
      DEPS,
    );
    expect(born.ok && (born.doc.sections[1]?.value as Record<string, unknown>)['tk-0002']).toEqual([
      { id: 'dw-0002', assertion: 'new', state: 'unchecked' },
    ]);
  });

  it('add --mint refuses to overwrite an id the author already chose', () => {
    const result = ddAdd(doc(), ['tasks'], '{"id":"tk-00ff","title":"x","state":"unchecked"}', {
      ...DEPS,
      mint: 'tk',
    });
    expect(result).toMatchObject({ ok: false, reason: 'id-conflict' });
  });

  it('rm removes an array member, a map entry, a field and a section', () => {
    const member = ddRemove(doc(), ['tasks', 'tk-0002'], DEPS);
    expect(member.ok && (member.doc.sections[0]?.value as unknown[]).length).toBe(1);

    const entry = ddRemove(doc(), ['evidence', 'tk-0001'], DEPS);
    expect(entry.ok && entry.doc.sections[1]?.value).toStrictEqual({});

    const field = ddRemove(doc(), ['tasks', 'tk-0001', 'done'], DEPS);
    expect(
      field.ok && (field.doc.sections[0]?.value as { done?: string }[])[0]?.done,
    ).toBeUndefined();

    const section = ddRemove(doc(), ['evidence'], DEPS);
    expect(section.ok && section.doc.sections.map((s) => s.name)).toStrictEqual(['tasks']);
  });

  it('refuses `add` on something that is not a list', () => {
    expect(ddAdd(doc(), ['tasks', 'tk-0001', 'title'], '"x"', DEPS)).toMatchObject({
      ok: false,
      reason: 'target-exists',
    });
  });
});

describe('dd mutate — serialization', () => {
  it('emits canonical two-space JSON with a trailing newline', () => {
    const text = serializeDoc(doc(), '{}');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "sections": [');
  });

  it('preserves a top-level key the envelope model does not carry', () => {
    const text = serializeDoc(doc(), '{"x_custom": {"kept": true}}');
    expect(JSON.parse(text)).toMatchObject({ x_custom: { kept: true } });
  });
});
