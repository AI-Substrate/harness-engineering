/**
 * Central error-code table (grep `Exxx` to find call sites). Start minimal;
 * grow as commands are added. Workshop 001 § Error code table.
 */
export const ErrorCodes = {
  /** Unclassified failure (last resort). */
  UNKNOWN: 'E100',
  /** Missing/invalid argument or flag. */
  INVALID_ARGS: 'E108',
  /** `.harness`/command-map config failed validation. */
  CONFIG_INVALID: 'E120',
  /** A doctor check raised an unexpected error (vs. reporting a failing layer). */
  DOCTOR_CHECK_FAILED: 'E130',
  /** An extension file couldn't be imported or failed shape validation (per-extension, non-fatal; surfaced by `doctor`). */
  EXTENSION_LOAD_FAILED: 'E140',
  /** A verb handler threw at invocation time, or returned an invalid result (isolated → error Envelope, never a raw stack). */
  EXTENSION_RUNTIME_ERROR: 'E141',
  /** Two extensions (or an extension + a reserved core name) declared the same verb name. */
  EXTENSION_VERB_CONFLICT: 'E142',
  /** A flat code file sits directly under `.harness/extensions/` — unsupported layout since plan 014; move it to `<name>/extension.ts`. */
  EXTENSION_FLAT_LAYOUT: 'E143',
  /** An extension folder is missing its conventional `instructions.md` agent briefing (doctor wails; the verb still runs). */
  EXTENSION_INSTRUCTIONS_MISSING: 'E144',
  /** `harness instructions <verb>`: the extension's `instructions.md` exists but could not be read. */
  INSTRUCTIONS_UNREADABLE: 'E145',
  /** `harness observe`: a bucket's session buffer exists but could not be read (never silent data loss). */
  OBSERVE_BUFFER_UNREADABLE: 'E146',
  /** A v2 extension declares an api newer than this core can normalize. */
  EXTENSION_API_ABOVE_CORE: 'E147',
  /** A v2 extension declares an unknown top-level section (typo or newer vocabulary). */
  EXTENSION_UNKNOWN_SECTION: 'E148',
  /** `harness new`: the requested verb name fails the name rules (empty, spaces, separators, etc.). */
  SCAFFOLD_INVALID_NAME: 'E150',
  /** `harness new`: the requested name is reserved by a core command (`help`/`doctor`/`new`). */
  SCAFFOLD_NAME_RESERVED: 'E151',
  /** `harness new`: a file already exists at the target path and `--force` was not passed. */
  SCAFFOLD_FILE_EXISTS: 'E152',
  /** `harness new`: the directory create or file write itself failed (permissions, etc.). */
  SCAFFOLD_WRITE_FAILED: 'E153',
  /** `harness docs <id>`: no curated doc is registered under that id. */
  DOC_NOT_FOUND: 'E160',
  /** `harness skills install`: the underlying `npx skills add` pass-through failed (non-zero exit / spawn error). */
  SKILLS_INSTALL_FAILED: 'E170',
  /** `harness record <type>`: no such record type in the merged registry (core ∪ extension). */
  RECORD_TYPE_UNKNOWN: 'E180',
  /** `harness record <type>`: the records directory create or file write itself failed (permissions, etc.). */
  RECORD_WRITE_FAILED: 'E181',
  /** `harness init`: writing the governance-doc skeleton (`.harness/engineering-harness.md`) failed (permissions, etc.). */
  INIT_WRITE_FAILED: 'E190',
  /** `harness update`/`self-install`: the global npm install failed (generic / unclassified). */
  UPDATE_FAILED: 'E200',
  /** `harness update`/`self-install`: the npm registry rejected the install — unexpected auth on the public package (wrong registry / stale login), or it isn't published yet / the registry is unreachable. */
  UPDATE_AUTH_FAILED: 'E201',
  /** `harness update`/`self-install`: the global npm install was denied (filesystem permissions). */
  UPDATE_PERMISSION_DENIED: 'E202',
  /** `harness update`/`self-install`: npm was not found on PATH. */
  UPDATE_NPM_MISSING: 'E203',
  /** `harness update --pin`: the requested version is not published in the registry. */
  UPDATE_VERSION_NOT_FOUND: 'E204',
  // --- `harness sensors` family (plan 059; E210–E217 are the complete Phase 2 block) ---
  /** A requested sensor is not registered. */
  SENSOR_NOT_FOUND: 'E210',
  /** A sensor run threw or rejected. */
  SENSOR_RUN_FAILED: 'E211',
  /** A sensor exceeded its hard timeout. */
  SENSOR_TIMEOUT: 'E212',
  /** Persisted sensor state is unparseable or has an unsupported schema. */
  SENSOR_STATE_UNREADABLE: 'E213',
  /** Atomic sensor state write failed. */
  SENSOR_STATE_WRITE_FAILED: 'E214',
  /** `sensors check` found failing, crashed, or timed-out sensors. */
  SENSORS_CHECK_FAILED: 'E215',
  /** A sensor declaration violates the api-2 contract. */
  SENSOR_DECL_INVALID: 'E216',
  /** Two extensions declared the same flat sensor name. */
  SENSOR_NAME_CONFLICT: 'E217',
  // --- `harness telemetry ls|pull` (P060; E220–E227 complete allocation) ---
  /** Required remote advertisement/fetch/auth/protocol/timeout/product-graph transport failure. */
  REMOTE_TELEMETRY_TRANSPORT_FAILED: 'E220',
  /** Conclusive exact-session absence after every repository advertised successfully. */
  REMOTE_TELEMETRY_SESSION_NOT_FOUND: 'E221',
  /** Selected telemetry history/tree/blob/schema/privacy/provenance is malformed or unsupported. */
  REMOTE_TELEMETRY_INVALID: 'E222',
  /** The remote telemetry namespace moved twice while establishing a verified snapshot. */
  REMOTE_TELEMETRY_MOVED: 'E223',
  /** A product commit endpoint is unknown, unreachable, or not a commit. */
  REMOTE_TELEMETRY_ENDPOINT_UNKNOWN: 'E224',
  /** Product start is not an ancestor of product end. */
  REMOTE_TELEMETRY_RANGE_DIVERGED: 'E225',
  /** Exact bundle target exists with a differing, extra, missing, or non-regular entry. */
  TELEMETRY_BUNDLE_CONFLICT: 'E226',
  /** Bundle temp/write/hash/lock/publish/cleanup failed. */
  TELEMETRY_BUNDLE_WRITE_FAILED: 'E227',
  // --- `harness flow` family (plan 024; additive — E300–E309 reserved, all free) ---
  /** `harness flow`: a flow document failed schema validation (shape/required fields/enum), or an invalid `--template` was supplied. */
  FLOW_SCHEMA_INVALID: 'E300',
  /** `harness flow`: the flow file could not be located (`--path`/`--plan-dir`/discovery all missed). */
  FLOW_NOT_FOUND: 'E301',
  /** `harness flow`: the atomic state write (temp + rename) itself failed (permissions, etc.). */
  FLOW_WRITE_FAILED: 'E302',
  /** `harness flow`: a WRITE path (`--path`/`--output`) escapes the repo root (`isWithin` guard). `--schema` is exempt (out-of-repo skill schemas allowed). */
  FLOW_PATH_ESCAPE: 'E303',
  /** `harness flow`: the flow type's schema could not be resolved — `--schema` › `.harness/schemas/flows/<type>.schema.json` › bundled built-in all exhausted. */
  FLOW_TYPE_UNKNOWN: 'E304',
  /** `harness flow`: a mutation targets a node that does not exist, OR requests an illegal status transition (one code, two related causes — `next_action` says which). */
  FLOW_NODE_INVALID: 'E305',
  /** `harness flow`: the flow's `schema_version` has an unknown major (version-gated validation). `next_action` → `harness update`. */
  FLOW_SCHEMA_VERSION: 'E306',
  /** `harness flow insert-node`: the placement TARGET reference is ambiguous — it resolves to more than one node. (Mutually-exclusive placement FLAGS are `E108`, not this; a target that matches nothing is `E305`.) */
  FLOW_AMBIGUOUS_TARGET: 'E307',
  /** `harness flow`: a pre-CLI / legacy-format flow (bare-integer `schema_version` and/or absent `provenance`) — clean break, no tolerant load. `next_action` hedges honestly. */
  FLOW_LEGACY_FORMAT: 'E308',
  /** `harness flow insert-node`: the post-splice DAG re-check failed (cycle or orphaned node) — nothing is written. */
  FLOW_EDGE_INVALID: 'E309',
  /** `harness flow render --check`: the rendered output drifted from the committed sibling `.md` (or none exists) — the derived artifact is stale. `next_action` → regenerate + commit. */
  FLOW_RENDER_DRIFT: 'E310',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
