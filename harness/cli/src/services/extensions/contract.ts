/**
 * PUBLIC verb contract — the types an extension author imports.
 *
 * Authors `import type { HarnessVerb } from 'harness-engineering/contract'`
 * (resolved by the `exports["./contract"]` map added in T023). Everything here is
 * **types only**, so it is erased at runtime — even a plain `.js` extension can
 * reference these via JSDoc with no runtime dependency on the core (plan D4).
 *
 * The core provides the implementation: it discovers + loads each extension's
 * default export (a {@link HarnessVerb} or array), registers one commander
 * subcommand per verb, builds the {@link VerbContext}, and finalizes the
 * returned {@link VerbResult} into a canonical Envelope (adding `command` +
 * `timestamp` and mapping `status` → exit code). Authors return intent; the
 * kernel stays the sole owner of `command`/`timestamp`/exit/`process.exit`.
 */

import type { ExecResult } from '../../adapters/exec/exec-port.js';
import type { Evidence } from '../../output/envelope.js';
import type { HarnessRecordType } from '../record/contract.js';

export type { ExecResult } from '../../adapters/exec/exec-port.js';
export type { Evidence } from '../../output/envelope.js';
export type { HarnessRecordType } from '../record/contract.js';

/** The four states a verb can report — mirrors the kernel's Envelope statuses. */
export type VerbStatus = 'ok' | 'degraded' | 'unconfigured' | 'error';

export interface VerbOption {
  /** commander-style flags, e.g. '--name <name>' or '-f, --force'. */
  flags: string;
  description: string;
  defaultValue?: string | boolean;
}

export interface VerbArg {
  /** commander-style, e.g. '<target>' (required) or '[target]' (optional). */
  name: string;
  description: string;
}

/**
 * What a handler RETURNS. The core finalizes it into a full Envelope (adds
 * `command` = the verb name + `timestamp` from the clock, maps status → exit).
 * `next_action` is REQUIRED by the core for any non-`ok` status (P5).
 */
export interface VerbResult {
  status: VerbStatus;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
  evidence?: Evidence[];
  next_action?: string;
}

/**
 * Injected per-invocation by the core from its ports. Authors never build this.
 * The shapes are inlined (not adapter imports) so the published contract is
 * self-contained.
 */
export interface VerbContext {
  /** The developer-repo cwd discovery resolved against. */
  cwd: string;
  /** Parsed positional args, by arg name. */
  args: Record<string, string | undefined>;
  /** Parsed flags, by camelCased name. */
  options: Record<string, unknown>;
  /** Run a REAL repo command (P8 — "wrap, don't rebuild"). cwd defaults to ctx.cwd. */
  exec(command: string, args?: string[], opts?: { cwd?: string }): Promise<ExecResult>;
  fs: {
    exists(path: string): boolean;
    readText(path: string): string | null;
    readdir(path: string): string[];
  };
  env: { get(name: string): string | undefined };
  git: { isRepo(): boolean; currentBranch(): string | null };
  clock: { nowIso(): string };
  // Envelope helpers so authors don't import the kernel:
  ok<T>(data: T, opts?: { evidence?: Evidence[]; next_action?: string }): VerbResult;
  degraded<T>(data: T, next_action: string, opts?: { evidence?: Evidence[] }): VerbResult;
  unconfigured(next_action: string, opts?: { data?: unknown }): VerbResult;
  error(
    code: string,
    message: string,
    opts?: { details?: unknown; next_action?: string },
  ): VerbResult;
}

/** The verb an extension declares. */
export interface HarnessVerb {
  /**
   * Discriminator — distinguishes a verb export from a {@link HarnessRecordType}.
   * OPTIONAL and defaults to `'verb'` when absent, so every existing verb
   * extension (which never set it) keeps working unchanged.
   */
  kind?: 'verb';
  /** e.g. 'build' → `harness build`. */
  name: string;
  /** One line — shown in `help`'s list + `doctor`. */
  summary: string;
  /** Longer body shown by `harness <verb> --help`. */
  description?: string;
  options?: VerbOption[];
  args?: VerbArg[];
  run(ctx: VerbContext): VerbResult | Promise<VerbResult>;
}

/** A `.harness/extensions/*` entry's DEFAULT export (verb-only — kept for back-compat). */
export type ExtensionExport = HarnessVerb | HarnessVerb[];

/**
 * The widened default-export union: a `.harness/extensions/*` file may declare a
 * verb, a record type, or an array mixing both. The loader routes each by `kind`
 * (`kind:'record'` → record registry; absent/`'verb'` → verb registry).
 */
export type HarnessExtensionExport =
  | HarnessVerb
  | HarnessRecordType
  | Array<HarnessVerb | HarnessRecordType>;

/** What `doctor` enumerates per discovered extension file (P7). */
export interface ExtensionRecord {
  /** Resolved absolute path. */
  entryPath: string;
  status: 'loaded' | 'failed' | 'conflict';
  /** Declared verbs accepted from this file (empty when `failed` or record-only). */
  verbs: HarnessVerb[];
  /** Declared record types accepted from this file (present only when non-empty). */
  recordTypes?: HarnessRecordType[];
  /** Load/validation message (present when status !== 'loaded'). */
  error?: string;
  /** For 'conflict': the VERB name(s) shadowed by a core command or earlier extension. */
  shadows?: string[];
  /** For 'conflict': the RECORD-TYPE name(s) shadowed by a core type or earlier extension. */
  recordShadows?: string[];
}
