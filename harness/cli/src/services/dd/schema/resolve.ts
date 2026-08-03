import { posixDirname, posixJoin, toPosix } from '../../shared/posix-path.js';
import { type DdDerivedState, deriveState } from '../core/derive.js';
import type { DdSection } from '../core/model.js';
import type { SchemaResolveResult, SchemaResolver } from '../core/validate.js';
import { type DeclarationResult, parseSchemaDeclaration } from './declarations.js';
import {
  type SchemaFs,
  type SchemaHit,
  type SchemaIssue,
  type SchemaListEntry,
  type SchemaListing,
  type SchemaRecord,
  type SchemaResolution,
  type SchemaRoot,
  schemaIssue,
} from './model.js';
import { isQualifiedName, type RootScan, scanRoot } from './scan.js';

export interface SchemaResolverOptions {
  fs: SchemaFs;
  /** Absolute POSIX-logical repo root — the `<gitroot>` of the precedence chain. */
  repoRoot: string;
  /** Absolute home directory; omit when the host cannot resolve one. */
  home?: string;
}

function nameIssues(name: string): SchemaIssue[] {
  const segments = name.split('/');
  if (name.includes('\\') || segments.some((part) => part === '.' || part === '..')) {
    return [
      schemaIssue('path-escape', 'ERROR', `schema name "${name}" escapes its discovery root`, {
        schema: name,
      }),
    ];
  }
  if (!isQualifiedName(name)) {
    return [
      schemaIssue(
        'schema-not-found',
        'ERROR',
        `"${name}" is not a qualified schema name (expected "<pkg>/<schema>")`,
        { schema: name },
      ),
    ];
  }
  return [];
}

function shadowIssue(winner: SchemaHit, shadowed: SchemaHit): SchemaIssue {
  return schemaIssue(
    'shadowed',
    'WARN',
    `"${shadowed.name}" at ${shadowed.path} is shadowed by the ${winner.root} copy at ${winner.path}`,
    { schema: shadowed.name, path: shadowed.path },
  );
}

function conflictIssue(hits: SchemaHit[]): SchemaIssue {
  const [first] = hits;
  return schemaIssue(
    'name-conflict',
    'ERROR',
    `"${first?.name}" is defined ${hits.length} times inside the ${first?.root} root: ${hits
      .map((hit) => hit.path)
      .join(', ')}`,
    { schema: first?.name, path: first?.rootPath },
  );
}

/**
 * The real convention-based resolver P1's validate engine was designed around
 * (OD-2). Implements `SchemaResolver` exactly; everything richer — provenance,
 * shadow chains, listings — hangs off the extra methods so the frozen core seam
 * stays one method wide.
 *
 * Precedence is D14's, first-hit-wins with EVERY hit recorded: doc-folder →
 * `<gitroot>/.dd` → `.harness/.dd` → `~/.dd`. A duplicate qualified name *within
 * one root* is a hard error (nothing can arbitrate it); the same name in a
 * *lower-precedence* root is a WARN-class shadow, because local override is the
 * feature — silently forking validation is the bug it must not become.
 *
 * Scans and parses are memoised per instance: one `dd validate --depth 3` walk
 * resolves the same schema for every hop, and re-walking four roots per hop
 * would make depth quadratic in the corpus.
 */
export class ConventionSchemaResolver implements SchemaResolver {
  private readonly scans = new Map<string, RootScan>();
  private readonly declarations = new Map<string, DeclarationResult>();

  constructor(private readonly options: SchemaResolverOptions) {}

  /** The frozen P1 seam: one schema ref plus the document asking for it. */
  resolve(schemaRef: string, fromPath: string): SchemaResolveResult {
    const resolution = this.resolveDetailed(schemaRef, fromPath);
    if (resolution.record) return { ok: true, schema: resolution.record.schema };
    const blocking = resolution.issues.find((issue) => issue.severity === 'ERROR');
    return { ok: false, message: blocking?.message ?? `schema not found: ${schemaRef}` };
  }

  /** Everything the CLI surfaces: the winning record, its shadows, and every finding. */
  resolveDetailed(schemaRef: string, fromPath?: string): SchemaResolution {
    const invalid = nameIssues(schemaRef);
    if (invalid.length > 0) return { issues: invalid };

    const issues: SchemaIssue[] = [];
    const matches: SchemaHit[] = [];
    for (const root of this.rootsFor(fromPath)) {
      const scan = this.scanFor(root);
      issues.push(
        ...scan.issues.filter((issue) => issue.schema === undefined || issue.schema === schemaRef),
      );
      const hits = scan.hits.filter((hit) => hit.name === schemaRef);
      if (hits.length > 1) {
        issues.push(conflictIssue(hits));
        return { issues };
      }
      matches.push(...hits);
    }
    if (issues.some((issue) => issue.severity === 'ERROR')) return { issues };

    const [winner, ...shadows] = matches;
    if (!winner) {
      issues.push(
        schemaIssue(
          'schema-not-found',
          'ERROR',
          `schema "${schemaRef}" was not found in any discovery root (${this.rootsFor(fromPath)
            .map((root) => root.path)
            .join(', ')})`,
          { schema: schemaRef },
        ),
      );
      return { issues };
    }

    const declared = this.declarationFor(winner);
    issues.push(...declared.issues);
    if (!declared.ok) return { issues };

    issues.push(...shadows.map((shadow) => shadowIssue(winner, shadow)));
    return {
      issues,
      record: {
        name: winner.name,
        description: declared.declaration.description,
        version: declared.declaration.version,
        path: winner.path,
        root: winner.root,
        schema: declared.declaration.schema,
        gateTerminal: declared.declaration.gateTerminal,
        shadows,
      },
    };
  }

  /** Every schema visible from `fromPath`, winners first with their shadow chains. */
  list(fromPath?: string): SchemaListing {
    const roots = this.rootsFor(fromPath);
    const issues: SchemaIssue[] = [];
    const byName = new Map<string, SchemaHit[]>();
    for (const root of roots) {
      const scan = this.scanFor(root);
      issues.push(...scan.issues);
      for (const hit of scan.hits) {
        byName.set(hit.name, [...(byName.get(hit.name) ?? []), hit]);
      }
    }

    const entries: SchemaListEntry[] = [...byName.keys()].sort().map((name) => {
      const resolution = this.resolveDetailed(name, fromPath);
      return {
        name,
        ...(resolution.record && { record: resolution.record }),
        issues: resolution.issues,
      };
    });
    return { roots, entries, issues };
  }

  /** The precedence chain for a document, deduped by path. */
  rootsFor(fromPath?: string): SchemaRoot[] {
    const repoRoot = toPosix(this.options.repoRoot);
    const candidates: SchemaRoot[] = [];
    if (fromPath) {
      candidates.push({ kind: 'doc-folder', path: posixDirname(toPosix(fromPath)) });
    }
    candidates.push({ kind: 'gitroot', path: posixJoin(repoRoot, '.dd') });
    candidates.push({ kind: 'harness', path: posixJoin(repoRoot, '.harness', '.dd') });
    if (this.options.home) {
      candidates.push({ kind: 'home', path: posixJoin(toPosix(this.options.home), '.dd') });
    }
    const seen = new Set<string>();
    return candidates.filter((root) =>
      seen.has(root.path) ? false : seen.add(root.path) !== null,
    );
  }

  private scanFor(root: SchemaRoot): RootScan {
    const cached = this.scans.get(root.path);
    if (cached) return cached;
    const scan = scanRoot(this.options.fs, root);
    this.scans.set(root.path, scan);
    return scan;
  }

  private declarationFor(hit: SchemaHit): DeclarationResult {
    const cached = this.declarations.get(hit.path);
    if (cached) return cached;
    const raw = this.options.fs.readText(hit.path);
    const result: DeclarationResult =
      raw === null
        ? {
            ok: false,
            issues: [
              schemaIssue('package-invalid', 'ERROR', `schema file is unreadable: ${hit.path}`, {
                schema: hit.name,
                path: hit.path,
              }),
            ],
          }
        : parseSchemaDeclaration(raw, hit.name, hit.path);
    this.declarations.set(hit.path, result);
    return result;
  }
}

/**
 * Derive a section's completion state through the schema's OWN gate-terminal
 * declaration — the injected-terminal-set seam P1 left on `deriveState`. This is
 * what makes a custom enum's `gate_terminal` change what "complete" means for
 * the documents that use it (workshop 002, Ruling 2).
 */
export function deriveSchemaState(record: SchemaRecord, section: DdSection): DdDerivedState {
  return deriveState(section, record.gateTerminal);
}
