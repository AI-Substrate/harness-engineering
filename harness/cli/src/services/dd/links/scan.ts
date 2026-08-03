import { posixJoin, posixNormalize } from '../../shared/posix-path.js';
import { SCAN_SKIP_DIRS, type SchemaFs } from '../schema/model.js';
import { type DdLinkIssue, linkIssue } from './model.js';

/** Every deterministic document carries this suffix; enumeration matches nothing else. */
export const DD_SUFFIX = '.dd.json';

export interface DdCorpusScan {
  /** Absolute POSIX-logical paths, sorted — enumeration order is part of the contract. */
  paths: string[];
  issues: DdLinkIssue[];
}

/**
 * Enumerate every `*.dd.json` beneath a root.
 *
 * There is no depth bound: dd documents live wherever their authors put them, and
 * a bound would silently omit a document rather than report one — the same
 * reasoning the schema scan records for its own walk. What the walk *does* carry
 * is a visited set over normalized directory paths, so a directory reachable by
 * two routes is enumerated once.
 *
 * A visited set cannot break a symlink cycle on its own — each traversal of the
 * loop mints a longer, genuinely distinct path. That is deliberate: the port
 * eventually fails (`ELOOP`/`ENAMETOOLONG`), and `SchemaFs` implementations that
 * keep the honest errno split (`NodeSchemaFs`, P2 F002) let that failure through
 * instead of flattening it to "no entries". The catch below turns it into one
 * reported `link-scan-failed`, so a corpus that cannot be enumerated is never
 * mistaken for an empty one.
 */
export function scanCorpus(fs: SchemaFs, root: string): DdCorpusScan {
  const paths: string[] = [];
  const issues: DdLinkIssue[] = [];
  const skip = new Set<string>(SCAN_SKIP_DIRS);
  const seen = new Set<string>();

  const walk = (dir: string): void => {
    const key = posixNormalize(dir);
    if (seen.has(key)) return;
    seen.add(key);
    for (const entry of [...fs.readdir(dir)].sort()) {
      if (skip.has(entry)) continue;
      const child = posixJoin(dir, entry);
      if (entry.endsWith(DD_SUFFIX)) {
        paths.push(child);
        continue;
      }
      if (fs.readdir(child).length > 0) walk(child);
    }
  };

  try {
    walk(root);
  } catch (error) {
    issues.push(
      linkIssue(
        'link-scan-failed',
        'ERROR',
        root,
        `document discovery failed for ${root}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        root,
      ),
    );
    return { paths: [], issues };
  }

  paths.sort();
  return { paths, issues };
}
