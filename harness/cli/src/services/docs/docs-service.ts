import type { DocEntry, DocLookup, DocsListResult } from './contract.js';
import { DOCS } from './docs-content.js';

/**
 * A single row of the bundled corpus — the index fields (`DocEntry`) plus the
 * full `content`. The generated `DOCS` array is the production corpus; tests
 * inject a fake `DocRecord[]` (fakes-only, no `vi.mock`).
 */
export interface DocRecord {
  id: string;
  title: string;
  summary: string;
  audience: DocEntry['audience'];
  content: string;
}

/**
 * The pure docs surface (plan 007, workshop 001). Operates ONLY over the
 * in-memory corpus — no `node:fs`, no `process.cwd()`, no CLI coupling (P2,
 * Finding 03) — so a future `mcp/tools/docs_*` imports these functions unchanged
 * (Finding 08). The act (`acts/docs.ts`) owns all I/O.
 *
 * Both functions default to the bundled `DOCS`; the optional `docs` parameter is
 * the test seam (and keeps the functions trivially reusable).
 */

/** List every doc as an index entry — title/summary only, never the body. */
export function listDocs(docs: readonly DocRecord[] = DOCS): DocsListResult {
  return {
    docs: docs.map(({ id, title, summary, audience }) => ({ id, title, summary, audience })),
  };
}

/** Resolve one doc by id to its full content, or an explicit not-found marker. */
export function getDoc(id: string, docs: readonly DocRecord[] = DOCS): DocLookup {
  const found = docs.find((doc) => doc.id === id);
  if (!found) {
    return { notFound: true, id };
  }
  return { id: found.id, title: found.title, content: found.content, format: 'markdown' };
}
