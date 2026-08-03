import { isAddressFailure, parseAddress } from './address.js';
import type { DdDoc } from './model.js';
import {
  collectLinkCells,
  type DdIssue,
  isPathWithinRepo,
  resolveAddressFile,
  type SchemaResolver,
  validateDocument,
} from './validate.js';

export type DocLoadResult =
  | { ok: true; path: string; doc: DdDoc; sha: string; tracked: boolean }
  | { ok: false; path: string; reason: 'missing'; message: string };

/** P4 and doctor implement this over their filesystem/repository ports. */
export interface DocLoader {
  load(path: string): DocLoadResult;
}

export interface ValidateWalkDeps {
  schemaResolver: SchemaResolver;
  docLoader: DocLoader;
}

export interface ValidateWalkOptions {
  repoRoot: string;
  depth?: number;
  mode?: 'direct' | 'sweep';
}

function testFixturePath(path: string): boolean {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  const testIndex = parts.lastIndexOf('test');
  return testIndex >= 0 && parts.slice(testIndex + 1).includes('fixtures');
}

export function shouldExcludeFromSweep(path: string, doc: DdDoc): boolean {
  return doc.dd.sweep_exclude === true || testFixturePath(path);
}

function finding(issue: Omit<DdIssue, 'owner'>, owner: string): DdIssue {
  return { ...issue, owner };
}

function targetType(schemaName: string, sectionName: string | undefined): string {
  return sectionName ? `${schemaName}/section/${sectionName}` : schemaName;
}

/**
 * Breadth-first validation over outbound links. `remaining` is decremented per
 * edge; a queued document is always depth-zero validated, including at zero.
 */
export function validateWalk(
  rootDoc: DdDoc,
  rootPath: string,
  deps: ValidateWalkDeps,
  options: ValidateWalkOptions,
): DdIssue[] {
  const mode = options.mode ?? 'direct';
  const requestedDepth = options.depth ?? 3;
  const depth =
    requestedDepth === Number.POSITIVE_INFINITY
      ? requestedDepth
      : Math.max(0, Math.floor(requestedDepth));
  const queue: Array<{ doc: DdDoc; path: string; remaining: number }> = [
    { doc: rootDoc, path: rootPath, remaining: depth },
  ];
  const visited = new Set<string>();
  const issues: DdIssue[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (visited.has(current.path)) continue;
    visited.add(current.path);
    if (mode === 'sweep' && shouldExcludeFromSweep(current.path, current.doc)) continue;

    issues.push(
      ...validateDocument(current.doc, current.path, deps.schemaResolver, options.repoRoot),
    );
    if (current.remaining === 0) continue;

    const resolvedSchema = deps.schemaResolver.resolve(current.doc.dd.schema, current.path);
    if (!resolvedSchema.ok) continue;

    for (const link of collectLinkCells(current.doc, resolvedSchema.schema)) {
      const address = parseAddress(link.raw);
      if (isAddressFailure(address) || address.file === null) continue;
      const targetPath = resolveAddressFile(current.path, address.file);
      if (!isPathWithinRepo(targetPath, options.repoRoot)) continue;

      const loaded = deps.docLoader.load(targetPath);
      if (!loaded.ok) {
        issues.push(
          finding(
            {
              class: 'address-target-missing',
              severity: 'WARN',
              location: link.location,
              message: loaded.message,
            },
            current.path,
          ),
        );
        continue;
      }
      if (!loaded.tracked) {
        issues.push(
          finding(
            {
              class: 'address-target-untracked',
              severity: 'WARN',
              location: link.location,
              message: `address target is not tracked: ${targetPath}`,
            },
            current.path,
          ),
        );
      }

      const ledgerEntry = current.doc.references.find(
        (reference) => resolveAddressFile(current.path, reference.path) === targetPath,
      );
      // Basis staleness is WARN, and stays WARN wherever it is asked (plan 065 P6
      // T004 / dossier § Rulings, A1 residual). A recorded basis that no longer
      // matches means the reader's conclusions about that target were computed
      // against a file that has since moved — which is information, not a verdict.
      // The flow spine's dd gate consumes the same rule through `verify-basis`:
      // drift surfaces at `orient` as a warning and NEVER refuses a departure,
      // because the gate itself is recomputed live against the current file and has
      // already answered the question drift would only cast doubt on.
      if (ledgerEntry && ledgerEntry.sha !== loaded.sha) {
        issues.push(
          finding(
            {
              class: 'basis-stale',
              severity: 'WARN',
              location: '$.references',
              message: `recorded basis ${ledgerEntry.sha} does not match ${loaded.sha} for ${ledgerEntry.path}`,
            },
            current.path,
          ),
        );
      }

      if (link.target) {
        const targetSchema = deps.schemaResolver.resolve(loaded.doc.dd.schema, targetPath);
        if (targetSchema.ok) {
          const actual = targetType(targetSchema.schema.name, address.segments[0]?.value);
          if (actual !== link.target) {
            issues.push(
              finding(
                {
                  class: 'link-type-mismatch',
                  severity: 'ERROR',
                  location: link.location,
                  message: `link targets "${actual}", expected "${link.target}"`,
                },
                current.path,
              ),
            );
          }
        }
      }

      queue.push({
        doc: loaded.doc,
        path: loaded.path,
        remaining:
          current.remaining === Number.POSITIVE_INFINITY
            ? Number.POSITIVE_INFINITY
            : current.remaining - 1,
      });
    }
  }

  return issues;
}
