import { describe, expect, it } from 'vitest';
import { type DocRecord, getDoc, listDocs } from '../../../src/services/docs/docs-service.js';

/*
Test Doc:
- Why: DocsService is the pure, MCP-stable seam behind `harness docs`; it must list/resolve
  docs over an in-memory corpus with NO node:fs/cwd so a future docs_* MCP tool reuses it as-is.
- Contract: listDocs() -> {docs: DocEntry[]} (no content); getDoc(id) -> DocContent | {notFound,id}.
- Usage Notes: both functions default to the bundled DOCS but accept an injected corpus for tests.
- Quality Contribution: pins the list/get behaviour + the not-found marker shape with fakes only.
- Worked Example: getDoc('alpha', FAKE) === {id:'alpha',title:'Alpha',content:'…',format:'markdown'}.
*/

const FAKE: DocRecord[] = [
  { id: 'alpha', title: 'Alpha', summary: 'first', audience: 'both', content: '# Alpha\nbody-a' },
  { id: 'beta', title: 'Beta', summary: 'second', audience: 'agent', content: '# Beta\nbody-b' },
];

describe('DocsService — listDocs', () => {
  it('returns index entries (id/title/summary/audience) and never leaks content', () => {
    const result = listDocs(FAKE);
    expect(result.docs).toEqual([
      { id: 'alpha', title: 'Alpha', summary: 'first', audience: 'both' },
      { id: 'beta', title: 'Beta', summary: 'second', audience: 'agent' },
    ]);
    expect((result.docs[0] as Record<string, unknown>).content).toBeUndefined();
  });

  it('over the real bundled corpus, returns a non-empty list', () => {
    expect(listDocs().docs.length).toBeGreaterThan(0);
  });
});

describe('DocsService — getDoc', () => {
  it('returns the full content with format "markdown" for a known id', () => {
    expect(getDoc('alpha', FAKE)).toEqual({
      id: 'alpha',
      title: 'Alpha',
      content: '# Alpha\nbody-a',
      format: 'markdown',
    });
  });

  it('returns a notFound marker (with the id) for an unknown id', () => {
    expect(getDoc('nope', FAKE)).toEqual({ notFound: true, id: 'nope' });
  });

  it('resolves a real bundled doc by id with non-empty content', () => {
    const firstId = listDocs().docs[0]?.id ?? '';
    const doc = getDoc(firstId);
    expect('content' in doc && doc.content.length > 0).toBe(true);
  });
});
