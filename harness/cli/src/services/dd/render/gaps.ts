import type { ResolvedDdSchema } from '../core/model.js';
import { parse } from '../core/parse.js';
import {
  collectCustomTypes,
  type DdAdapterFs,
  type DdAdapterModuleLoader,
  loadAdapters,
} from './adapters.js';
import type { DdAdapterIssue } from './contract.js';
import { renderDd } from './renderer.js';

/**
 * The doctor-facing shape of a render-layer adapter failure.
 *
 * Declared here rather than imported from the links layer, because that layer
 * must not be reachable from this one (the `dd-links-never-imports-render`
 * boundary works in both directions in spirit). `DdAdapterGapSource` in
 * `services/dd/links/model.ts` is structurally identical, so this collector
 * satisfies it without either module naming the other.
 */
export interface DdRenderAdapterGap {
  path: string;
  kind: 'load-failed' | 'not-found' | 'output-invalid' | 'runtime-failed';
  message: string;
  schema?: string;
  type?: string;
}

/** Issue class → the doctor's discriminator. The two vocabularies differ by prefix only. */
const GAP_KIND: Record<DdAdapterIssue['class'], DdRenderAdapterGap['kind']> = {
  'adapter-not-found': 'not-found',
  'adapter-load-failed': 'load-failed',
  'adapter-runtime-failed': 'runtime-failed',
  'adapter-output-invalid': 'output-invalid',
};

export interface SchemaRecordLike {
  name: string;
  /** Absolute path of the WINNING `schema.json` — adapters ship beside it. */
  path: string;
  schema: ResolvedDdSchema;
  /** The schema's gate-terminal set, when it declares one. */
  gateTerminal?: readonly string[];
}

export interface CollectAdapterGapsOptions {
  /** Documents to inspect. Normally the doctor's reached set. */
  paths: readonly string[];
  fs: DdAdapterFs & { readText(path: string): string | null };
  loader: DdAdapterModuleLoader;
  /** Resolve a document's schema to its winning record, or null when it does not resolve. */
  resolveSchema(schemaRef: string, fromPath: string): SchemaRecordLike | null;
}

/**
 * Collect every adapter gap across a set of documents, so `dd doctor` can repeat
 * a degraded render as a WARN (AC-04).
 *
 * **It renders, because two of the four failure classes only exist at render
 * time.** `adapter-not-found` and `adapter-load-failed` are answered by the load;
 * `adapter-runtime-failed` and `adapter-output-invalid` require actually calling
 * the adapter, and AC-04 says the doctor repeats a degraded render — all of it,
 * not the cheap half. The cost is bounded by the guard above it: a document that
 * populates NO custom type never renders here, which in a normal corpus is almost
 * every document. Only the documents that could have an adapter gap pay for the
 * question.
 *
 * The render is a throwaway — its markdown is discarded and only the adapter
 * set's recorded issues are kept — so this never writes, and never competes with
 * `dd build` for the sibling.
 *
 * A document that cannot be read, parsed, or schema-resolved yields no gaps: each
 * of those is already some other layer's finding, and repeating it here as an
 * adapter problem would misname it. A render that THROWS is likewise `dd build`'s
 * finding (a render failure is a dd bug, not a data error), so it is swallowed
 * here rather than renamed into an adapter gap.
 */
export async function collectAdapterGaps(
  options: CollectAdapterGapsOptions,
): Promise<DdRenderAdapterGap[]> {
  const gaps: DdRenderAdapterGap[] = [];

  for (const path of options.paths) {
    const text = options.fs.readText(path);
    if (text === null) continue;
    const doc = parse(text);
    if (Array.isArray(doc)) continue;
    const record = options.resolveSchema(doc.dd.schema, path);
    if (!record) continue;

    const types = collectCustomTypes(doc, record.schema);
    if (types.length === 0) continue;

    const set = await loadAdapters({
      types,
      schemaPath: record.path,
      fs: options.fs,
      loader: options.loader,
    });

    try {
      renderDd(doc, {
        path,
        schema: record.schema,
        ...(record.gateTerminal && { gateTerminal: record.gateTerminal }),
        adapters: set,
      });
    } catch {
      // A render failure is `dd build`'s finding, not an adapter gap.
    }

    for (const issue of set.issues) {
      gaps.push({
        path,
        kind: GAP_KIND[issue.class],
        message: issue.message,
        schema: record.name,
        type: issue.type,
      });
    }
  }

  return gaps;
}

/**
 * Freeze a collected set into the synchronous source the doctor consumes.
 *
 * The doctor is synchronous and adapter loading is not, so the collection happens
 * once, before the sweep, and the sweep then filters. That ordering is why the
 * source takes the paths it was built from: asking for a document that was never
 * collected returns nothing rather than a quiet lie about a clean render.
 */
export function adapterGapSource(gaps: readonly DdRenderAdapterGap[]): {
  adapterGaps(paths: readonly string[]): readonly DdRenderAdapterGap[];
} {
  return {
    adapterGaps(paths) {
      const wanted = new Set(paths);
      return gaps.filter((gap) => wanted.has(gap.path));
    },
  };
}
