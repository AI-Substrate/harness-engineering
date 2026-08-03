import { describe, expect, it } from 'vitest';
import { resolveLink } from '../../../../src/services/dd/links/resolver.js';
import { deps, docPath, REPO } from './helpers.js';

const PLAN = docPath('docs/plan.dd.json');

function resolve(raw: string, fromPath: string | null = PLAN) {
  return resolveLink(raw, deps(), { repoRoot: REPO, fromPath });
}

describe('dd links resolver — targets', () => {
  it.each([
    ['evidence.dd.json#entries', 'section', ['section']],
    ['plan.dd.json#phases/ph-1a2b', 'instance', ['section', 'instance']],
    ['plan.dd.json#phases/ph-1a2b/brief', 'part', ['section', 'instance', 'part']],
    [
      'plan.dd.json#phases/ph-1a2b/tasks/tk-3c4d',
      'instance',
      ['section', 'instance', 'part', 'instance'],
    ],
  ] as const)('%s resolves to a %s', (raw, kind, kinds) => {
    const result = resolve(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.kind).toBe(kind);
    expect(result.target.segments.map((segment) => segment.kind)).toEqual(kinds);
  });

  it('classifies by shape, not by position', () => {
    // `#meta/owner` puts a shape part where the alternating grammar hints an id,
    // and `#meta/audit/by` puts parts at both following indices. Positional
    // classification calls the first of those an instance; the shape does not.
    const owner = resolve('plan.dd.json#meta/owner');
    expect(owner.ok).toBe(true);
    if (!owner.ok) return;
    expect(owner.target.segments).toEqual([
      { value: 'meta', kind: 'section' },
      { value: 'owner', kind: 'part' },
    ]);
    expect(owner.target.value).toBe('harness');

    const nested = resolve('plan.dd.json#meta/audit/by');
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    expect(nested.target.segments.map((segment) => segment.kind)).toEqual([
      'section',
      'part',
      'part',
    ]);
    expect(nested.target.value).toBe('phase-4');
  });

  it('hands back the addressed value itself', () => {
    const result = resolve('evidence.dd.json#entries/ev-5e6f');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.value).toEqual({
      id: 'ev-5e6f',
      state: 'checked',
      note: 'the address resolved',
    });
    expect(result.target.schema).toBe('links/evidence');
    expect(result.target.path).toBe(docPath('docs/evidence.dd.json'));
    expect(result.target.sha).toBe('sha-evidence');
    expect(result.target.form).toBe('qualified');
  });

  it('resolves a bare-# address against its containing document', () => {
    const from = docPath('docs/bare-same-doc.dd.json');
    const result = resolveLink('#phases/ph-7081/brief', deps(), { repoRoot: REPO, fromPath: from });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.form).toBe('bare');
    expect(result.target.path).toBe(from);
    expect(result.target.value).toBe('Bare-# addresses resolve against their own document');
  });

  it('resolves relative file parts against the containing document, across folders', () => {
    const result = resolveLink('../plan.dd.json#phases/ph-1a2b', deps(), {
      repoRoot: REPO,
      fromPath: docPath('docs/nested/child.dd.json'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.path).toBe(docPath('docs/plan.dd.json'));
  });

  it('anchors at the repo root when there is no containing document', () => {
    const result = resolveLink('docs/evidence.dd.json#entries', deps(), {
      repoRoot: REPO,
      fromPath: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.path).toBe(docPath('docs/evidence.dd.json'));
  });

  it('reports the untracked target honestly rather than hiding it', () => {
    const result = resolve('untracked.dd.json#entries');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target.tracked).toBe(false);
  });
});

describe('dd links resolver — every unresolved reason', () => {
  it.each([
    ['evidence.dd.json#nosuchsection', 'section-unknown'],
    ['plan.dd.json#meta/nosuchpart', 'part-unknown'],
    ['evidence.dd.json#entries/ev-0000', 'id-not-found'],
    ['plan.dd.json#preamble/deeper', 'not-a-container'],
    ['missing.dd.json#entries', 'file-unreadable'],
    ['../../../outside.dd.json#entries', 'path-escape'],
    ['no-hash-at-all', 'malformed'],
    ['plan.dd.json#entries@abcd', 'malformed'],
  ] as const)('%s fails with reason %s', (raw, reason) => {
    const result = resolve(raw);
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      class: 'link-unresolved',
      severity: 'ERROR',
      reason,
      owner: PLAN,
    });
  });

  it('refuses to guess a base document for a bare-# address', () => {
    const result = resolve('#phases/ph-1a2b', null);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.reason).toBe('no-base-document');
    expect(result.issues[0]?.message).toContain('<path>#<interior>');
  });

  it('reports an unresolvable target schema as its own reason', () => {
    const loader = {
      load: (path: string) => ({
        ok: true as const,
        path,
        doc: { dd: { schema: 'links/nope' }, sections: [], references: [] },
        sha: 'sha-x',
        tracked: true,
      }),
    };
    const result = resolveLink('other.dd.json#entries', deps(loader), {
      repoRoot: REPO,
      fromPath: PLAN,
    });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.reason).toBe('schema-unresolvable');
  });

  it('owns the finding by the document that must change', () => {
    const citing = docPath('docs/unresolved-id.dd.json');
    const result = resolveLink('evidence.dd.json#entries/ev-0000', deps(), {
      repoRoot: REPO,
      fromPath: citing,
      location: '$.sections[citations].value[0].cite',
    });
    expect(result.ok).toBe(false);
    // The address is broken, and the citing document holds it — so the citing
    // document is what must change, never the target it points at.
    expect(result.issues[0]).toMatchObject({
      owner: citing,
      location: '$.sections[citations].value[0].cite',
    });
  });
});
