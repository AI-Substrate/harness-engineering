/**
 * Public shapes for the baked `dd docs` surface (plan 065, D15).
 *
 * The corpus is compiled INTO the CLI — an agent that has the binary has the
 * documentation, with no repo checkout and no network. The service that returns
 * these is pure (it reads the generated array only); the act owns all I/O.
 */

/** One baked doc as listed by `dd docs list` — the index entry, never the body. */
export interface DdDocEntry {
  /** Stable slug — the `dd docs get <id>` argument. */
  id: string;
  title: string;
  summary: string;
  audience: 'human' | 'agent' | 'both';
}

/** One baked doc with its full body, as returned by `dd docs get <id>`. */
export interface DdDocContent extends DdDocEntry {
  content: string;
  /** Pinned so a consumer can switch on it; only markdown ships today. */
  format: 'markdown';
}

export interface DdDocsListResult {
  docs: DdDocEntry[];
}

/** A single lookup: the doc, or an explicit not-found marker (never a throw). */
export type DdDocLookup = DdDocContent | { notFound: true; id: string };

/** A row of the generated corpus: index fields plus the body. */
export interface DdDocRecord extends DdDocEntry {
  content: string;
}
