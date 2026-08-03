import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DdDoc, ResolvedDdSchema } from '../../../../src/services/dd/core/model.js';
import { parse } from '../../../../src/services/dd/core/parse.js';
import type {
  SchemaResolveResult,
  SchemaResolver,
} from '../../../../src/services/dd/core/validate.js';
import type { DocLoader, DocLoadResult } from '../../../../src/services/dd/core/walk.js';
import type { SchemaFs } from '../../../../src/services/dd/schema/model.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/**
 * The corpus is mounted at a synthetic absolute root rather than read through its
 * real path on purpose: the real path contains `test/.../fixtures/`, which the
 * sweep-exclusion contract skips, so a sweep test rooted there would prove
 * nothing. Mounting at `/repo` lets the exclusion be exercised deliberately by
 * the one fixture that opts out, and by a path chosen to look like a fixture.
 */
export const REPO = '/repo';

function realPath(logical: string): string {
  const relative = logical === REPO ? '' : logical.slice(`${REPO}/`.length);
  return `${FIXTURES}repo/${relative}`;
}

const NOT_A_DIRECTORY = new Set(['ENOENT', 'ENOTDIR']);

/** `SchemaFs` over the real fixture tree, mounted at {@link REPO}. */
export class FixtureFs implements SchemaFs {
  readonly reads: string[] = [];

  readdir(path: string): string[] {
    try {
      return readdirSync(realPath(path));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== undefined && NOT_A_DIRECTORY.has(code)) return [];
      throw error;
    }
  }

  exists(path: string): boolean {
    return existsSync(realPath(path));
  }

  readText(path: string): string | null {
    this.reads.push(path);
    try {
      return readFileSync(realPath(path), 'utf8');
    } catch {
      return null;
    }
  }
}

/** Deterministic stand-in for a content digest: `evidence.dd.json` → `sha-evidence`. */
export function fixtureSha(path: string): string {
  return `sha-${(path.split('/').at(-1) ?? path).replace(/\.dd\.json$/, '')}`;
}

export const UNTRACKED = `${REPO}/docs/untracked.dd.json`;

export class FixtureDocLoader implements DocLoader {
  readonly loads: string[] = [];

  constructor(private readonly fs: SchemaFs = new FixtureFs()) {}

  load(path: string): DocLoadResult {
    this.loads.push(path);
    const text = this.fs.readText(path);
    if (text === null) {
      return { ok: false, path, reason: 'missing', message: `address target is missing: ${path}` };
    }
    const doc = parse(text);
    if (Array.isArray(doc)) {
      return {
        ok: false,
        path,
        reason: 'missing',
        message: `address target is not a readable dd document: ${path}`,
      };
    }
    return { ok: true, path, doc, sha: fixtureSha(path), tracked: path !== UNTRACKED };
  }
}

function schema(name: string): ResolvedDdSchema {
  return JSON.parse(readFileSync(`${FIXTURES}schemas/${name}.schema.json`, 'utf8'));
}

export const PLAN_SCHEMA = schema('links-plan');
export const EVIDENCE_SCHEMA = schema('links-evidence');

export class FixtureSchemaResolver implements SchemaResolver {
  private readonly byName = new Map([
    [PLAN_SCHEMA.name, PLAN_SCHEMA],
    [EVIDENCE_SCHEMA.name, EVIDENCE_SCHEMA],
  ]);

  resolve(schemaRef: string): SchemaResolveResult {
    const found = this.byName.get(schemaRef);
    return found
      ? { ok: true, schema: found }
      : { ok: false, message: `schema not found: ${schemaRef}` };
  }
}

export function deps(loader: DocLoader = new FixtureDocLoader()) {
  return { schemaResolver: new FixtureSchemaResolver(), docLoader: loader };
}

export function doc(relative: string): DdDoc {
  const result = parse(readFileSync(`${FIXTURES}repo/${relative}`, 'utf8'));
  if (Array.isArray(result)) throw new Error(`fixture failed to parse: ${relative}`);
  return result;
}

export function docPath(relative: string): string {
  return `${REPO}/${relative}`;
}
