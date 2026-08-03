import type { DocLoader, DocLoadResult } from '../core/walk.js';

/**
 * Remember what a loader already answered.
 *
 * The doctor reads the same document from several angles — the traversal, the
 * radius-∞ walk, and the interior-resolution pass — and each of those is a
 * separate, legitimate question. Re-reading and re-parsing the file for every one
 * of them is the only cost worth removing, so it is removed once, here, instead
 * of by teaching each caller to hold state.
 *
 * Caching is per instance and lives exactly as long as one command, which is the
 * only window in which "the file has not changed underneath us" is safe to assume.
 */
export class MemoizingDocLoader implements DocLoader {
  private readonly cache = new Map<string, DocLoadResult>();

  constructor(private readonly inner: DocLoader) {}

  load(path: string): DocLoadResult {
    const hit = this.cache.get(path);
    if (hit) return hit;
    const result = this.inner.load(path);
    this.cache.set(path, result);
    return result;
  }
}
