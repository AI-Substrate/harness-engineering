/**
 * Provenance splicing — a PURE string transform (no I/O, no `node:*`) that stamps
 * the CLI-owned provenance header into a record template's frontmatter, so the
 * record service stays hexagonally pure (Constitution P2). All values come from
 * injected ports (git/clock/env) + the injected version string, resolved by the
 * caller; this module only formats + splices.
 *
 * The Frozen Frontmatter Contract is 8 keys: `schema_version` is TEMPLATE-OWNED
 * (never spliced) plus the 7 environment/identity keys spliced here. So every
 * written record carries all 8, **exactly one each** — even when the template
 * already declares one of the 7 (e.g. `RETRO_TEMPLATE` ships its own `agent` /
 * `plan_id` placeholders): an existing TOP-LEVEL declaration of a spliced key is
 * stripped first, then the stamped block is prepended, so the CLI's value wins
 * and a YAML-first scanner never sees a duplicate key.
 */

/** The 7 CLI-stamped provenance keys — everything in the Frozen Contract except the template-owned `schema_version`. */
export interface ProvenanceFields {
  /** The record type — `harness-bypass` / `harness-change` / `retro`. */
  record_kind: string;
  /** The CLI build version (injected string; `readVersion` is a bootstrap concern, never the service). */
  harness_version: string;
  /** `GitPort.currentBranch()` — null when detached / not a repo. */
  branch: string | null;
  /** `GitPort.remoteUrl()` — null when there is no `origin` remote. */
  repo: string | null;
  /** `Clock.nowIso()` — the write instant. */
  created_at: string;
  /** `HARNESS_AGENT` — null when unset. */
  agent: string | null;
  /** `HARNESS_PLAN_ID` — null when unset (branch/cwd inference deferred). */
  plan_id: string | null;
}

/** Canonical key order for the stamped block. */
const PROVENANCE_KEYS: (keyof ProvenanceFields)[] = [
  'record_kind',
  'harness_version',
  'branch',
  'repo',
  'created_at',
  'agent',
  'plan_id',
];

const FENCE = '---\n';

/** Render a value as a YAML scalar: a double-quoted string (special chars escaped) or bare `null`. */
function yamlScalar(value: string | null): string {
  // JSON.stringify yields a double-quoted, escaped string — a valid YAML flow
  // scalar — so a value like `feat/x` round-trips unambiguously for the scanner.
  return value === null ? 'null' : JSON.stringify(value);
}

/**
 * Splice the 7 provenance keys into the FIRST frontmatter block of `template`.
 * Pure + idempotent: re-running strips the keys it added and re-adds identical
 * lines. `schema_version` is never in the key set, so it is never touched. A
 * template that doesn't open with a `---` frontmatter fence is returned
 * unchanged (defensive — every core/extension template opens with one).
 */
export function spliceProvenance(template: string, fields: ProvenanceFields): string {
  if (!template.startsWith(FENCE)) {
    return template;
  }
  const rest = template.slice(FENCE.length);
  // Closing fence of the first frontmatter block: the first line that is exactly
  // `---` (allowing trailing spaces), matched at line start.
  const close = /^---[ \t]*$/m.exec(rest);
  if (close === null) {
    return template; // no closing fence → not valid frontmatter; leave as-is.
  }
  const block = rest.slice(0, close.index); // the YAML keys (each line \n-terminated)
  const after = rest.slice(close.index); // closing `---\n` onward (+ body)

  // Strip any existing TOP-LEVEL declaration of a spliced key (anchored at line
  // start, no leading whitespace → never a nested key), so the stamped value is
  // the only occurrence. `schema_version` is absent from the set → untouched.
  const stripRe = new RegExp(`^(?:${PROVENANCE_KEYS.join('|')}):.*\\r?\\n?`, 'gm');
  const cleaned = block.replace(stripRe, '');

  const header = PROVENANCE_KEYS.map((key) => `${key}: ${yamlScalar(fields[key])}\n`).join('');
  return FENCE + header + cleaned + after;
}
