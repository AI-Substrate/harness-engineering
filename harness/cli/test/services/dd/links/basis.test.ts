import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { updateLedgerEntry, verifyBasis } from '../../../../src/services/dd/links/basis.js';
import { deps, docPath, REPO } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const EVIDENCE = docPath('docs/evidence.dd.json');

function verify(from: string, address: string, sha: string) {
  return verifyBasis(address, sha, deps(), { repoRoot: REPO, fromPath: docPath(from) });
}

describe('verify-basis — the consumer-facing primitive', () => {
  it('calls a recorded sha that still matches fresh', () => {
    const result = verify('docs/basis-fresh.dd.json', 'evidence.dd.json#entries', 'sha-evidence');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict).toEqual({
      state: 'fresh',
      address: 'evidence.dd.json#entries',
      path: EVIDENCE,
      recorded: 'sha-evidence',
      actual: 'sha-evidence',
    });
  });

  it('calls a recorded sha the target has moved past stale', () => {
    const result = verify(
      'docs/basis-stale.dd.json',
      'evidence.dd.json#entries',
      'sha-evidence-before-the-edit',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.verdict.state).toBe('stale');
    expect(result.verdict.actual).toBe('sha-evidence');
  });

  it('answers about the whole target document, not the addressed part', () => {
    // Two addresses into the same document share one ledger entry (workshop 001
    // dropped per-link pins), so both must report the same basis.
    const section = verify('docs/plan.dd.json', 'evidence.dd.json#entries', 'sha-evidence');
    const instance = verify(
      'docs/plan.dd.json',
      'evidence.dd.json#entries/ev-5e6f',
      'sha-evidence',
    );
    expect(section.ok && instance.ok).toBe(true);
    if (!section.ok || !instance.ok) return;
    expect(section.verdict.actual).toBe(instance.verdict.actual);
    expect(section.verdict.state).toBe('fresh');
    expect(instance.verdict.state).toBe('fresh');
  });

  it('reports an unresolvable address instead of guessing a verdict', () => {
    const result = verify('docs/plan.dd.json', 'evidence.dd.json#nosuchsection', 'sha-evidence');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({ class: 'link-unresolved', reason: 'section-unknown' });
  });
});

describe('explicit re-verification — the ledger write', () => {
  const text = () => readFileSync(`${FIXTURES}repo/docs/basis-stale.dd.json`, 'utf8');
  const from = docPath('docs/basis-stale.dd.json');

  it('moves the recorded sha and nothing else', () => {
    const result = updateLedgerEntry(text(), from, EVIDENCE, 'sha-evidence');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.previous).toBe('sha-evidence-before-the-edit');
    expect(result.entry).toEqual({
      path: 'evidence.dd.json',
      sha: 'sha-evidence',
      mode: 'pinned',
    });

    const before = JSON.parse(text());
    const after = JSON.parse(result.text);
    expect(after.sections).toEqual(before.sections);
    expect(after.dd).toEqual(before.dd);
  });

  it('never changes an entry mode as a side effect', () => {
    // The PM's caveat, made mechanical: re-verifying a citation must not quietly
    // turn it into a transclusion, in either direction.
    for (const mode of ['pinned', 'live'] as const) {
      const source = JSON.stringify({
        dd: { schema: 'links/plan' },
        sections: [],
        references: [{ path: 'evidence.dd.json', sha: 'old', mode }],
      });
      const result = updateLedgerEntry(source, from, EVIDENCE, 'sha-evidence');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.entry.mode).toBe(mode);
      expect(JSON.parse(result.text).references[0].mode).toBe(mode);
    }
  });

  it('preserves fields the schema never declared', () => {
    const source = JSON.stringify({
      dd: { schema: 'links/plan' },
      sections: [],
      references: [
        { path: 'evidence.dd.json', sha: 'old', mode: 'pinned', why: 'a note from the author' },
      ],
    });
    const result = updateLedgerEntry(source, from, EVIDENCE, 'sha-evidence');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.parse(result.text).references[0]).toEqual({
      path: 'evidence.dd.json',
      sha: 'sha-evidence',
      mode: 'pinned',
      why: 'a note from the author',
    });
  });

  it('refuses to mint an entry that was never recorded', () => {
    const result = updateLedgerEntry(text(), from, docPath('docs/plan.dd.json'), 'sha-plan');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('records no basis entry');
  });

  it('reports an unusable document rather than writing one', () => {
    expect(updateLedgerEntry('{not json', from, EVIDENCE, 'x')).toEqual({
      ok: false,
      message: expect.stringContaining('not valid JSON'),
    });
    expect(updateLedgerEntry('{"dd":{}}', from, EVIDENCE, 'x')).toEqual({
      ok: false,
      message: expect.stringContaining('no references ledger'),
    });
  });

  it('writes canonical two-space JSON with a trailing newline', () => {
    const result = updateLedgerEntry(text(), from, EVIDENCE, 'sha-evidence');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.endsWith('}\n')).toBe(true);
    expect(result.text).toContain('\n  "references": [');
  });
});
