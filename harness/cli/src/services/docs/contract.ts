/**
 * Public shapes for the docs surface (plan 007, workshop 001 § Contract).
 *
 * These types are the **MCP-stable seam**: a future `mcp/tools/docs_*` tool
 * imports `DocsService` and these records unchanged (Finding 08). `format` and
 * `audience` are pinned now — not because the CLI needs them, but so the seam
 * never has to widen its contract later (validation MEDIUM).
 *
 * The service that returns these (`docs-service.ts`) is **pure** — it operates
 * only over the generated `DOCS` array, never `node:fs`/`cwd`. All I/O (reading
 * argv, writing stdout) lives in the act (`acts/docs.ts`).
 */

/** Curated doc, as listed by `harness docs` (no body — the index entry only). */
export interface DocEntry {
  /** Stable slug, e.g. `extend-the-harness`. The `harness docs <id>` argument. */
  id: string;
  /** Human-facing one-line title. */
  title: string;
  /** One-line summary for the list view. */
  summary: string;
  /** Who the doc is written for (drives future filtering; informational today). */
  audience: 'human' | 'agent' | 'both';
}

/** A single doc with its full body, as returned by `harness docs <id>`. */
export interface DocContent {
  id: string;
  title: string;
  /** The full document body. */
  content: string;
  /** The content's format. Only `'markdown'` today; pinned so consumers can switch on it. */
  format: 'markdown';
}

/** The `harness docs` (list) payload — the envelope `data`. */
export interface DocsListResult {
  docs: DocEntry[];
}

/** The result of a single-doc lookup: the content, or an explicit not-found marker. */
export type DocLookup = DocContent | { notFound: true; id: string };
