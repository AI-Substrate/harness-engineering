import type { ResolvedDdSchema } from '../core/model.js';

/**
 * The read surface the schema layer needs — nothing more. `FsPort` satisfies it
 * structurally, so production injects the real adapter and tests inject a
 * `FakeFs` (or a deliberately throwing stub, for the scan-failure class) without
 * this layer ever naming an adapter.
 */
export interface SchemaFs {
  /** Entry names directly inside a directory; `[]` for a file or a missing path. */
  readdir(path: string): string[];
  /** True when a path exists. Used to probe for `schema.json` without reading it. */
  exists(path: string): boolean;
  /** File contents as UTF-8, or null when missing/unreadable. */
  readText(path: string): string | null;
}

/** The four discovery roots, in precedence order (D14). */
export type SchemaRootKind = 'doc-folder' | 'gitroot' | 'harness' | 'home';

export interface SchemaRoot {
  kind: SchemaRootKind;
  /** Absolute POSIX-logical path of the root that gets deep-scanned. */
  path: string;
}

/**
 * Failure classes of the schema layer. Each maps 1:1 onto a frozen E-code, but
 * the mapping lives in the act — this layer stays free of `output/`, exactly
 * like dd-core, so a future MCP surface can reuse it unchanged.
 */
export type SchemaIssueClass =
  | 'schema-not-found'
  | 'package-invalid'
  | 'name-conflict'
  | 'shadowed'
  | 'version-unsupported'
  | 'enum-invalid'
  | 'scan-failed'
  | 'path-escape';

export type SchemaSeverity = 'ERROR' | 'WARN';

export interface SchemaIssue {
  class: SchemaIssueClass;
  severity: SchemaSeverity;
  message: string;
  /** Qualified `<pkg>/<schema>` name the issue concerns, when known. */
  schema?: string;
  /** Absolute path of the offending artifact, when known. */
  path?: string;
  /** Location inside the schema file (`$.enums.review.gate_terminal`), when known. */
  location?: string;
}

/** One `schemas/<pkg>/<schema>/schema.json` found by the scan. */
export interface SchemaHit {
  /** Qualified name, always `<pkg>/<schema>` — taken from the path, never the file. */
  name: string;
  /** Absolute path of the schema definition file. */
  path: string;
  root: SchemaRootKind;
  rootPath: string;
}

/** A resolved schema: the P1 shape the validate engine consumes, plus provenance. */
export interface SchemaRecord {
  name: string;
  description: string;
  version: number;
  /** Absolute path of the winning schema file — always carried, never inferred. */
  path: string;
  root: SchemaRootKind;
  /** The P1 `ResolvedDdSchema` the validate engine takes. */
  schema: ResolvedDdSchema;
  /** The gate-terminal set `deriveState` must use for this schema (T008 ruling b). */
  gateTerminal: readonly string[];
  /** Lower-precedence duplicates that lost, in precedence order. */
  shadows: SchemaHit[];
}

export interface SchemaResolution {
  /** Present only when resolution succeeded. */
  record?: SchemaRecord;
  /** Every finding — shadows are WARN-class and coexist with a successful record. */
  issues: SchemaIssue[];
}

/** One row of `dd schema list`. A row with no `record` failed to load; `issues` says why. */
export interface SchemaListEntry {
  name: string;
  record?: SchemaRecord;
  issues: SchemaIssue[];
}

export interface SchemaListing {
  roots: SchemaRoot[];
  entries: SchemaListEntry[];
  /** Root-level findings (scan failures) that belong to no single schema. */
  issues: SchemaIssue[];
}

/** The one `dd_schema` version this CLI speaks. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** The convention folder every root is deep-scanned for. */
export const SCHEMAS_DIR = 'schemas';

/** The single definition file inside `schemas/<pkg>/<schema>/` (T008 ruling a). */
export const SCHEMA_FILE = 'schema.json';

/** Directories the deep scan never descends into. */
export const SCAN_SKIP_DIRS = ['node_modules', '.git', 'dist', 'coverage'] as const;

/** How many directory levels below a root the scan descends. */
export const MAX_SCAN_DEPTH = 8;

export function schemaIssue(
  issueClass: SchemaIssueClass,
  severity: SchemaSeverity,
  message: string,
  extra: Omit<SchemaIssue, 'class' | 'severity' | 'message'> = {},
): SchemaIssue {
  return { class: issueClass, severity, message, ...extra };
}
