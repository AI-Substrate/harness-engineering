import type { DdDoc, DdShape, ResolvedDdSchema } from '../core/model.js';
import { isRecord } from '../core/value.js';
import type {
  DdAdapter,
  DdAdapterContext,
  DdAdapterIssue,
  DdAdapterIssueClass,
  DdAdapterSet,
} from './contract.js';

/**
 * The convention folder inside a schema package (workshop-003 W1 rule 2):
 * presence IS registration — there is no manifest to keep in sync.
 */
export const ADAPTERS_DIR = 'adapters';

/**
 * The one extension an adapter may have. W1 locked `adapters/<type-name>.ts`, and
 * probing a list of extensions would invent a precedence order nobody asked for;
 * a `.js` home can be added additively the day a consumer needs one.
 */
export const ADAPTER_EXTENSION = '.ts';

/** Types the renderer handles itself — everything else needs an adapter. */
const BUILTIN_TYPES = new Set([
  'array',
  'bool',
  'enum',
  'int',
  'link',
  'number',
  'object',
  'state',
  'string',
  'text',
]);

/**
 * The narrow read surface this layer needs, declared here rather than imported:
 * `services/dd/render` never names an adapter, exactly as the schema layer never
 * names one (P2 `SchemaFs`). `NodeSchemaFs` satisfies it structurally.
 */
export interface DdAdapterFs {
  exists(path: string): boolean;
}

/** Same reasoning: `JitiLoader` satisfies this structurally, and tests inject a fake. */
export interface DdAdapterModuleLoader {
  /** Import by absolute path and return the module's default export. */
  load(absPath: string): Promise<unknown>;
}

/**
 * The read surface Phase 4's doctor consumes to repeat a degraded render repo-wide
 * as WARN (plan 3.3). Declared here as an INTERFACE only — the doctor wiring is
 * P4/P5's to build; this phase's job is to make sure there is something honest to
 * wire, and that a build never hides a gap the sweep would later have to discover.
 */
export interface DdAdapterWarnSource {
  adapterWarnings(): readonly DdAdapterIssue[];
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function collectFromShape(value: unknown, shape: DdShape | undefined, types: Set<string>): void {
  if (shape === undefined || isBlank(value)) return;
  if (!BUILTIN_TYPES.has(shape.type)) {
    types.add(shape.type);
    return;
  }
  if (shape.type === 'array' && Array.isArray(value)) {
    for (const entry of value) collectFromShape(entry, shape.items, types);
    return;
  }
  if (shape.type === 'object' && isRecord(value)) {
    for (const [field, fieldShape] of Object.entries(shape.fields ?? {})) {
      collectFromShape(value[field], fieldShape, types);
    }
  }
}

/**
 * The custom types this document actually populates — never merely the ones its
 * schema declares. A schema may offer a custom column no document fills; warning
 * "no adapter for it" would be a gap the reader cannot act on and does not have.
 */
export function collectCustomTypes(doc: DdDoc, schema: ResolvedDdSchema): string[] {
  const types = new Set<string>();
  for (const section of doc.sections) {
    collectFromShape(section.value, schema.sections[section.name]?.shape, types);
  }
  return [...types].sort();
}

/** `<schema package>/adapters/<type>.ts` — derived from the resolved schema file's own folder. */
export function adapterPath(schemaFilePath: string, type: string): string {
  const posix = schemaFilePath.replaceAll('\\', '/');
  const packageDir = posix.slice(0, Math.max(0, posix.lastIndexOf('/')));
  return `${packageDir}/${ADAPTERS_DIR}/${type}${ADAPTER_EXTENSION}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A pre-loaded adapter set. Loading is async (jiti), rendering is not — so every
 * import happens here, before the pure renderer is ever called.
 *
 * Every failure class produces the SAME visible outcome (return `null`, take the
 * honest fallback) and a DIFFERENT recorded issue. That split is the whole design:
 * the reader never gets a blank cell or a crash (W1 rule 4), and the operator never
 * gets a silent degradation (W1 rule 5).
 */
export class LoadedAdapterSet implements DdAdapterSet, DdAdapterWarnSource {
  private readonly recorded = new Map<string, DdAdapterIssue>();

  constructor(private readonly adapters: ReadonlyMap<string, DdAdapter>) {}

  get issues(): readonly DdAdapterIssue[] {
    return [...this.recorded.values()];
  }

  /** The P4/P5 doctor seam — the same findings, named for the consumer that repeats them. */
  adapterWarnings(): readonly DdAdapterIssue[] {
    return this.issues;
  }

  /** Record a load-time failure; the first one per type wins, so a table cannot spam. */
  record(
    issueClass: DdAdapterIssueClass,
    type: string,
    text: string,
    extra: { path?: string; location?: string } = {},
  ): void {
    const key = `${issueClass}:${type}`;
    if (this.recorded.has(key)) return;
    this.recorded.set(key, {
      class: issueClass,
      severity: 'WARN',
      type,
      message: text,
      ...(extra.path !== undefined && { path: extra.path }),
      ...(extra.location !== undefined && { location: extra.location }),
    });
  }

  render(value: unknown, ctx: DdAdapterContext): string | null {
    const adapter = this.adapters.get(ctx.type);
    if (!adapter) {
      // The load-time issue is already recorded; this only pins WHERE it first bit,
      // so an operator gets a document location instead of a bare type name.
      this.attachLocation(ctx);
      return null;
    }
    let rendered: unknown;
    try {
      rendered = adapter(value, ctx);
    } catch (error) {
      this.record(
        'adapter-runtime-failed',
        ctx.type,
        `adapter for "${ctx.type}" threw while rendering: ${message(error)}`,
        { location: ctx.location },
      );
      return null;
    }
    if (typeof rendered !== 'string') {
      this.record(
        'adapter-output-invalid',
        ctx.type,
        `adapter for "${ctx.type}" returned ${typeof rendered}, expected a markdown string`,
        { location: ctx.location },
      );
      return null;
    }
    return rendered;
  }

  private attachLocation(ctx: DdAdapterContext): void {
    for (const [key, issue] of this.recorded) {
      if (issue.type === ctx.type && issue.location === undefined) {
        this.recorded.set(key, { ...issue, location: ctx.location });
      }
    }
  }
}

export interface LoadAdaptersOptions {
  /** The custom types to resolve — normally `collectCustomTypes(doc, schema)`. */
  types: readonly string[];
  /** Absolute path of the WINNING `schema.json`; adapters ship beside it (D14). */
  schemaPath: string;
  fs: DdAdapterFs;
  loader: DdAdapterModuleLoader;
}

/**
 * Resolve every custom type to an adapter, recording exactly why each one that
 * cannot be resolved could not be. Never throws: a schema package with six broken
 * adapters still renders a complete document, loudly.
 */
export async function loadAdapters(options: LoadAdaptersOptions): Promise<LoadedAdapterSet> {
  const resolved = new Map<string, DdAdapter>();
  const set = new LoadedAdapterSet(resolved);

  for (const type of options.types) {
    const path = adapterPath(options.schemaPath, type);
    if (!options.fs.exists(path)) {
      set.record('adapter-not-found', type, `no adapter for custom type "${type}"`, { path });
      continue;
    }
    let loaded: unknown;
    try {
      loaded = await options.loader.load(path);
    } catch (error) {
      set.record('adapter-load-failed', type, `adapter failed to load: ${message(error)}`, {
        path,
      });
      continue;
    }
    if (typeof loaded !== 'function') {
      // The module imported cleanly but exported nothing callable, so nothing
      // usable was ever obtained — a load failure, not an output failure
      // (T006 ruling a: `adapter-output-invalid` means the adapter RAN).
      set.record(
        'adapter-load-failed',
        type,
        `adapter default export is ${loaded === undefined ? 'missing' : typeof loaded}, expected a (value, ctx) => string function`,
        { path },
      );
      continue;
    }
    resolved.set(type, loaded as DdAdapter);
  }

  return set;
}
