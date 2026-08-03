import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DdDocRecord } from '../../../../src/services/dd/docs/contract.js';
import { getDdDoc, listDdDocs } from '../../../../src/services/dd/docs/dd-docs-service.js';
import { DD_DOCS } from '../../../../src/services/dd/docs/docs-content.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const MANIFEST = JSON.parse(
  readFileSync(`${REPO_ROOT}harness/cli/src/services/dd/docs/dd-docs-manifest.json`, 'utf8'),
) as {
  docs: { id: string; title: string; summary: string; audience: string; sourcePath: string }[];
};

const FAKE: DdDocRecord[] = [
  { id: 'a', title: 'A', summary: 'first', audience: 'agent', content: '# A\n' },
  { id: 'b', title: 'B', summary: 'second', audience: 'human', content: '# B\n' },
];

describe('baked dd docs — service', () => {
  it('lists index entries only, never the body', () => {
    const result = listDdDocs(FAKE);
    expect(result.docs).toEqual([
      { id: 'a', title: 'A', summary: 'first', audience: 'agent' },
      { id: 'b', title: 'B', summary: 'second', audience: 'human' },
    ]);
    for (const doc of result.docs) expect(doc).not.toHaveProperty('content');
  });

  it('resolves one doc with its body and a pinned format', () => {
    expect(getDdDoc('b', FAKE)).toEqual({
      id: 'b',
      title: 'B',
      summary: 'second',
      audience: 'human',
      content: '# B\n',
      format: 'markdown',
    });
  });

  it('returns an explicit not-found marker rather than throwing', () => {
    expect(getDdDoc('missing', FAKE)).toEqual({ notFound: true, id: 'missing' });
  });
});

describe('baked dd docs — the shipped corpus', () => {
  it('ships exactly what the manifest curates, in manifest order', () => {
    expect(DD_DOCS.map((doc) => doc.id)).toEqual(MANIFEST.docs.map((entry) => entry.id));
    for (const [index, entry] of MANIFEST.docs.entries()) {
      expect(DD_DOCS[index]).toMatchObject({
        id: entry.id,
        title: entry.title,
        summary: entry.summary,
        audience: entry.audience,
      });
    }
  });

  it('carries each source file byte-for-byte — the in-suite half of the drift gate', () => {
    for (const [index, entry] of MANIFEST.docs.entries()) {
      expect(DD_DOCS[index]?.content).toBe(readFileSync(`${REPO_ROOT}${entry.sourcePath}`, 'utf8'));
    }
  });

  it('documents the two things an author actually needs', () => {
    const overview = getDdDoc('dd-overview');
    const howTo = getDdDoc('how-to-add-a-schema');
    expect('notFound' in overview).toBe(false);
    expect('notFound' in howTo).toBe(false);
    if ('notFound' in overview || 'notFound' in howTo) return;

    // The resolution order and the gate vocabulary are the two facts a reader
    // cannot infer from `--help`, and the receipt convention is the one rule an
    // agent must never quietly break.
    expect(overview.content).toContain('<gitroot>/.dd');
    expect(overview.content).toContain('human-skipped');
    expect(howTo.content).toContain('gate_terminal');
    expect(howTo.content).toContain('receipt');
    expect(howTo.content).toContain('adapters/sparkline.ts');
  });
});
