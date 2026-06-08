import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DOCS } from '../../../src/services/docs/docs-content.js';
import { getDoc, listDocs } from '../../../src/services/docs/docs-service.js';

/*
Test Doc:
- Why: docs-content.ts is GENERATED from .md sources — these tests are the drift guard (the
  bundled body must byte-equal its source) and the P12 curation guard (only allow-listed,
  publication-safe docs ship; never governance/plan/scratch material).
- Contract: getDoc(id).content === source .md; set(DOCS ids) === set(manifest ids); no forbidden paths.
- Quality Contribution: a hand-edit of docs-content.ts, a stale regen, or a curation leak all fail here.
- Worked Example: editing docs/how/extend-the-harness.md without `npm run gen:docs` breaks the byte-equal test.
*/

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const manifestPath = join(repoRoot, 'harness/cli/src/services/docs/docs-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  docs: { id: string; sourcePath: string }[];
};

describe('docs corpus — drift guard', () => {
  it.each(manifest.docs.map((entry) => [entry.id, entry.sourcePath] as const))(
    'getDoc(%s).content byte-equals its source .md (regen is current)',
    (id, sourcePath) => {
      const lookup = getDoc(id);
      expect('content' in lookup).toBe(true);
      const source = readFileSync(join(repoRoot, sourcePath), 'utf8');
      if ('content' in lookup) {
        expect(lookup.content).toBe(source);
      }
    },
  );
});

describe('docs corpus — curation (P12)', () => {
  it('DOCS ids exactly match the manifest ids (no orphans, no extras)', () => {
    const docIds = [...DOCS].map((doc) => doc.id).sort();
    const manifestIds = manifest.docs.map((entry) => entry.id).sort();
    expect(docIds).toEqual(manifestIds);
  });

  it('listDocs() surfaces exactly the curated ids', () => {
    const listed = listDocs().docs.map((doc) => doc.id).sort();
    expect(listed).toEqual(manifest.docs.map((entry) => entry.id).sort());
  });

  it('never includes governance/private material (AGENTS.md, docs/plans, scratch)', () => {
    const FORBIDDEN = [/(^|\/)AGENTS\.md$/i, /(^|\/)docs\/plans\//, /(^|\/)scratch\//];
    for (const entry of manifest.docs) {
      for (const pattern of FORBIDDEN) {
        expect(entry.sourcePath).not.toMatch(pattern);
      }
    }
  });
});
