import type { DdDocLookup, DdDocRecord, DdDocsListResult } from './contract.js';
import { DD_DOCS } from './docs-content.js';

/**
 * The pure baked-docs surface. Operates ONLY over the in-memory corpus — no
 * filesystem, no cwd, no CLI coupling — so the same functions serve a future MCP
 * tool unchanged. The `docs` parameter is the test seam (fakes only, no mocks).
 */

/** Every baked doc as an index entry — title/summary only, never the body. */
export function listDdDocs(docs: readonly DdDocRecord[] = DD_DOCS): DdDocsListResult {
  return {
    docs: docs.map(({ id, title, summary, audience }) => ({ id, title, summary, audience })),
  };
}

/** Resolve one baked doc by id, or return an explicit not-found marker. */
export function getDdDoc(id: string, docs: readonly DdDocRecord[] = DD_DOCS): DdDocLookup {
  const found = docs.find((doc) => doc.id === id);
  if (!found) return { notFound: true, id };
  return { ...found, format: 'markdown' };
}
