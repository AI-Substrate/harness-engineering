import type { HarnessRecordType } from '../../record/contract.js';
import type { CustomItem, HarnessVerb, SensorDecl, VerbArg, VerbOption } from '../contract.js';

/** A normalized nested command. Its runtime shape is commander-ready. */
export interface NormalizedSubverb extends HarnessVerb {
  options?: VerbOption[];
  args?: VerbArg[];
}

/**
 * Versionless verb shape consumed by help, validation, and dispatch. V1 verbs
 * are already structurally valid instances; v2 adds a one-level subverb list.
 */
export interface NormalizedVerb extends HarnessVerb {
  subverbs?: NormalizedSubverb[];
  /** False only for a v2 parent whose bare invocation is kernel-owned. */
  hasOwnRun?: boolean;
}

/** Typed sensor declaration rebuilt from kernel-known fields only. */
export interface NormalizedSensor {
  name: string;
  declaration: SensorDecl;
}

/** User-defined custom item carried for registry discovery; behavior stays user-owned. */
export interface NormalizedCustomItem {
  type: string;
  name: string;
  declaration: CustomItem;
}

/**
 * The one internal, versionless extension shape. Compatibility is confined to
 * the two normalizers; downstream consumers never parse authoring formats.
 */
export interface NormalizedExtension {
  name: string;
  source: 'v1' | 'v2';
  api: number;
  entryPath: string;
  verbs: NormalizedVerb[];
  sensors: NormalizedSensor[];
  recordTypes: HarnessRecordType[];
  customItems: NormalizedCustomItem[];
  info: string[];
}
