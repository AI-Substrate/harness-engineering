/**
 * PUBLIC record-type contract — the type an extension author imports to declare a
 * new kind of record (alongside the verb contract).
 *
 * Authors `import type { HarnessRecordType } from 'harness-engineering/contract'`
 * (re-exported from `services/extensions/contract.ts`, which the package's
 * `exports["./contract"]` map resolves). Everything here is **types only**, so it
 * is erased at runtime — even a plain `.js` record extension can reference it via
 * JSDoc with no runtime dependency on the core.
 *
 * The CLI is deliberately **schema-agnostic**: it knows only these four fields and
 * writes the `template` to a path. The record's *actual* schema lives INSIDE the
 * `template` body (frontmatter keys + commented guidance), so adding the next
 * record type is "a template + four fields", never a change to `harness record`.
 */

/** A record type: a named template the `record` command scaffolds into `.harness/records/<type>/`. */
export interface HarnessRecordType {
  /** Discriminator — distinguishes a record-type export from a verb export. REQUIRED. */
  kind: 'record';
  /**
   * The `<type>` arg + the `.harness/records/<type>/` directory name.
   * Pattern: `^[a-z][a-z0-9-]*$` (same rule as verb names).
   */
  type: string;
  /** One line — shown by `harness record --list` and `doctor`. */
  description: string;
  /**
   * The file body the agent fills. The record's "schema" lives HERE as
   * frontmatter + commented field guidance — the CLI never parses it.
   */
  template: string;

  // ── Deferred (NOT built in v1; reserved so the contract can grow without a break) ──
  // schema?: object;            // JSON Schema for later OPTIONAL runtime validation.
  // placement?: PlacementRule;  // override the uniform .harness/records/<type>/<date>/<NNN>-<slug>.md.
}
