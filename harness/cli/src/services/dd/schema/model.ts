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
  | 'rel-invalid'
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

/**
 * One evidence item read through a schema: its id, the state value it carries, and
 * whether that state is gate-terminal under that schema's own declaration.
 *
 * The per-item counterpart to `DdDerivedState`'s aggregate — see `deriveSchemaItems`.
 */
export interface DdSchemaItem {
  id: string;
  state: string;
  terminal: boolean;
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

/**
 * Directories the scan skips by their POSITION, not by their name.
 *
 * {@link SCAN_SKIP_DIRS} holds BASENAMES — `node_modules` anywhere is never
 * source. `.harness/temp` is different in kind: `temp` is an ordinary word, and a
 * `temp/` directory somewhere in a source tree may be entirely real. Only *this*
 * path is scratch, so only this path is skipped, and the matching below is on the
 * path rather than the name.
 *
 * **Why it is here at all**: `.harness/temp` is the harness's declared gitignored
 * scratch area — agents, sensors and the flow all write there. Once `dd doctor`
 * feeds a quality gate, a stray scratch document would report findings about
 * files that are not repository content and degrade that gate. That is the same
 * judgement `sweep_exclude` and the test-fixture rule already make, on its third
 * occasion: deliberately-not-repo-content must never shape a gate (AC-15).
 *
 * The skip is POSITIONAL, so it yields to an explicit root: pointing the sweep
 * INSIDE the scratch dir sweeps it, mirroring OD-1's direct-invocation-never-skips.
 */
export const SCAN_SKIP_PATHS = ['.harness/temp'] as const;

export function schemaIssue(
  issueClass: SchemaIssueClass,
  severity: SchemaSeverity,
  message: string,
  extra: Omit<SchemaIssue, 'class' | 'severity' | 'message'> = {},
): SchemaIssue {
  return { class: issueClass, severity, message, ...extra };
}
