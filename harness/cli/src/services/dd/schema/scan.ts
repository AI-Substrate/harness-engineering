import { isWithin, posixJoin } from '../../shared/posix-path.js';
import {
  MAX_SCAN_DEPTH,
  SCAN_SKIP_DIRS,
  SCHEMA_FILE,
  SCHEMAS_DIR,
  type SchemaFs,
  type SchemaHit,
  type SchemaIssue,
  schemaIssue,
  type SchemaRoot,
} from './model.js';

export interface RootScan {
  root: SchemaRoot;
  /** Every `<pkg>/<schema>` found under this root, sorted by name then path. */
  hits: SchemaHit[];
  issues: SchemaIssue[];
}

const NAME_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A qualified name is exactly `<pkg>/<schema>`, each segment path-safe. */
export function isQualifiedName(name: string): boolean {
  const parts = name.split('/');
  return parts.length === 2 && parts.every((part) => NAME_SEGMENT.test(part));
}

function collectPackages(
  fs: SchemaFs,
  schemasDir: string,
  root: SchemaRoot,
  hits: SchemaHit[],
  issues: SchemaIssue[],
): void {
  for (const pkg of [...fs.readdir(schemasDir)].sort()) {
    const pkgDir = posixJoin(schemasDir, pkg);
    for (const schema of [...fs.readdir(pkgDir)].sort()) {
      const path = posixJoin(pkgDir, schema, SCHEMA_FILE);
      if (!fs.exists(path)) continue;
      const name = `${pkg}/${schema}`;
      if (!isQualifiedName(name) || !isWithin(root.path, path)) {
        issues.push(
          schemaIssue('path-escape', 'ERROR', `schema path escapes its discovery root: ${path}`, {
            schema: name,
            path,
          }),
        );
        continue;
      }
      hits.push({ name, path, root: root.kind, rootPath: root.path });
    }
  }
}

/**
 * Deep-scan one discovery root for `schemas/<pkg>/<schema>/schema.json` packages.
 *
 * "Deep" is the point (D14): a package may sit at any depth beneath its root, so
 * the walk descends until it meets a `schemas/` folder (which it enumerates but
 * never recurses into — a nested `schemas` there is a package name, not another
 * convention folder). Directory-ness is inferred from `readdir` returning
 * entries, which is all the port promises; skip-listed and over-deep branches are
 * silently pruned, and any port failure becomes one honest `scan-failed` issue
 * rather than a thrown exception.
 */
export function scanRoot(fs: SchemaFs, root: SchemaRoot): RootScan {
  const hits: SchemaHit[] = [];
  const issues: SchemaIssue[] = [];
  const skip = new Set<string>(SCAN_SKIP_DIRS);

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH) return;
    for (const entry of [...fs.readdir(dir)].sort()) {
      if (skip.has(entry)) continue;
      const child = posixJoin(dir, entry);
      if (entry === SCHEMAS_DIR) {
        collectPackages(fs, child, root, hits, issues);
        continue;
      }
      if (fs.readdir(child).length > 0) walk(child, depth + 1);
    }
  };

  try {
    walk(root.path, 0);
  } catch (error) {
    issues.push(
      schemaIssue(
        'scan-failed',
        'ERROR',
        `schema-root discovery failed for ${root.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { path: root.path },
      ),
    );
    return { root, hits: [], issues };
  }

  hits.sort((a, b) => (a.name === b.name ? a.path.localeCompare(b.path) : a.name.localeCompare(b.name)));
  return { root, hits, issues };
}
