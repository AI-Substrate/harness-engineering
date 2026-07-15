import type { HarnessRecordType } from '../../record/contract.js';
import type { ExtensionDefinition, HarnessVerb } from '../contract.js';

export type ClassifiedExtensionEntry =
  | { kind: 'v1-verb'; value: HarnessVerb }
  | { kind: 'v1-record'; value: HarnessRecordType }
  | { kind: 'v2'; value: ExtensionDefinition };

/**
 * Classify an array-coerced default export per entry, solely by its `kind`
 * discriminator. Shape validation happens after routing; this function never
 * guesses that primitives/functions are extensions.
 */
export function classifyExtensionExport(mod: unknown): ClassifiedExtensionEntry[] | null {
  const values = Array.isArray(mod) ? mod : [mod];
  if (values.length === 0) return null;
  if (values.some((value) => value === null || typeof value !== 'object')) return null;

  return values.map((value) => {
    const candidate = value as { kind?: unknown };
    if (candidate.kind === 'extension') {
      return { kind: 'v2' as const, value: value as ExtensionDefinition };
    }
    if (candidate.kind === 'record') {
      return { kind: 'v1-record' as const, value: value as HarnessRecordType };
    }
    return { kind: 'v1-verb' as const, value: value as HarnessVerb };
  });
}
