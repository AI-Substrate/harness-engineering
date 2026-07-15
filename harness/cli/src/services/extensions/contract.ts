/**
 * PUBLIC verb contract — the types an extension author imports.
 *
 * Authors `import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract'`
 * (resolved by the `exports["./contract"]` map added in T023). Everything here is
 * v1 declarations remain **types only**. The sole runtime export is the additive
 * {@link defineExtension} identity/branding helper; plain `.js` extensions use the
 * documented bare literal and therefore keep zero runtime dependency on the core.
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

/** One deterministic entry in a {@link StepRunner} rollup. */
export interface StepReport {
  name: string;
  status: 'passed' | 'failed';
  mark: '✅' | '❌';
  durationMs: number;
  message?: string;
  details?: unknown;
}

/** Machine- and human-readable aggregate returned by `steps.finish()`. */
export interface StepRollup {
  steps: StepReport[];
  passed: number;
  failed: number;
  summary: string;
}

export interface StepFinishOptions {
  errorCode?: string;
  next_action?: string;
}

/**
 * Optional kernel-owned step runner. `fail()` aborts only the current step;
 * `run()` records it and continues, so `finish()` can aggregate every failure.
 */
export interface StepRunner {
  run<T>(name: string, fn: () => T | Promise<T>): Promise<T | undefined>;
  fail(message: string, details?: unknown): never;
  finish(options?: StepFinishOptions): VerbResult;
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
  exec(
    command: string,
    args?: string[],
    opts?: {
      cwd?: string;
      timeoutMs?: number;
      env?: Record<string, string | undefined>;
    },
  ): Promise<ExecResult>;
  fs: {
    exists(path: string): boolean;
    readText(path: string): string | null;
    readdir(path: string): string[];
    /** Canonical absolute path with symlinks resolved, or null if missing (never throws). */
    realpath(path: string): string | null;
  };
  /**
   * OPTIONAL write-side filesystem capability (plan 031). Present when the core
   * provides it; an author should feature-detect (`if (ctx.fsWrite)`) so a verb
   * degrades gracefully on an older core. Lets a verb create dirs, write files,
   * and copy artifacts portably — no POSIX `mkdir`/`cp`/`bash` shell-out. The
   * confined `copy` is the CWE-59-safe artifact import (resolve+contain+copy in
   * one call — no skip-all, no check-then-copy TOCTOU).
   */
  fsWrite?: {
    writeText(path: string, contents: string): void;
    mkdirp(path: string): void;
    rename(from: string, to: string): void;
    copy(src: string, destDir: string, opts?: { confineRoot?: string }): boolean;
    copyDir(src: string, dest: string): boolean;
    mkdtemp(prefix: string): string;
  };
  /**
   * OPTIONAL detached background-spawn capability (plan 031). Present when the
   * core provides it; feature-detect (`if (ctx.background)`) for graceful
   * degradation on an older core. `spawnDetached` launches a fire-and-forget
   * child that OUTLIVES the verb (stdout+stderr → `logPath`), returning its pid
   * — the portable, injection-safe replacement for a `nohup … &` shell-out. On
   * Windows a `.cmd` shim is launched via `cmd.exe` (never a bare `.cmd` spawn —
   * it EINVALs on patched Node; see the core resolver).
   */
  background?: {
    spawnDetached(input: {
      command: string;
      args: string[];
      cwd: string;
      env?: Record<string, string | undefined>;
      logPath: string;
    }): { pid: number };
  };
  env: { get(name: string): string | undefined };
  git: { isRepo(): boolean; currentBranch(): string | null };
  clock: {
    nowIso(): string;
    /** Resolve after `ms` — the portable, fakeable replacement for a `sleep` shell-out in poll loops (plan 031). */
    sleep(ms: number): Promise<void>;
  };
  /** Optional additive capability; feature-detect for compatibility with older cores. */
  steps?: () => StepRunner;
  /** Optional additive registry reader for user-defined `custom.<type>` items (D6-a). */
  registry?: ExtensionItemRegistry;
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

/**
 * V2-only invocation context. The published v1 {@link VerbContext.args} contract
 * deliberately stays `string | undefined`; only v2 declarations can receive a
 * commander variadic as `string[]`.
 */
export type V2VerbContext = Omit<VerbContext, 'args'> & {
  args: Record<string, string | string[] | undefined>;
};

/** A one-level v2 subverb declaration. Nested `sub` is intentionally absent. */
export interface SubverbDecl {
  summary: string;
  description?: string;
  options?: VerbOption[];
  args?: VerbArg[];
  run(ctx: V2VerbContext): VerbResult | Promise<VerbResult>;
}

/** A v2 verb declaration. `run` is optional only when at least one `sub` exists. */
export interface VerbDecl {
  summary: string;
  description?: string;
  options?: VerbOption[];
  args?: VerbArg[];
  run?(ctx: V2VerbContext): VerbResult | Promise<VerbResult>;
  sub?: Record<string, SubverbDecl>;
}

/** Narrow deterministic context passed to a sensor measurement (workshop 002 S11). */
export interface SensorRunContext {
  cwd: string;
  exec(
    command: string,
    args?: string[],
    opts?: {
      cwd?: string;
      timeoutMs?: number;
      env?: Record<string, string | undefined>;
    },
  ): Promise<ExecResult>;
}

/** One deterministic sensor reading; run outcome is recorded separately (S2/S3). */
export interface SensorReading {
  state: 'pass' | 'warn' | 'fail' | 'skip';
  score?: number;
  direction?: 'lower' | 'higher';
  threshold?: number;
  /** One author-written line, never raw command output (S12). */
  details?: string;
  guidance?: string;
}

/** One declaration under the api-2 `sensors:` keyed section (S1). */
export interface SensorDecl {
  summary: string;
  run(ctx: SensorRunContext): SensorReading | Promise<SensorReading>;
  watch?: string[];
  trigger?: 'watch' | 'manual';
  timeoutMs?: number;
  guidance?: string;
}

/** A user-defined item under `custom.<type>.<name>`; only `summary` is kernel-owned. */
export interface CustomItem {
  summary: string;
  [key: string]: unknown;
}

/** Provenance-preserving custom item returned by `ctx.registry.items(type)`. */
export interface CustomRegistryItem {
  type: string;
  name: string;
  extension: string;
  entryPath: string;
  declaration: CustomItem;
}

/** Presence-detected reader; behavior remains owned by the defining repository. */
export interface ExtensionItemRegistry {
  items(type: string): readonly CustomRegistryItem[];
}

/** V2 keyed record declaration (`type` and `kind` come from the containing key). */
export type RecordDecl = Omit<HarnessRecordType, 'kind' | 'type'>;

/**
 * V2 extension definition. A plain-JS author may export this exact bare literal;
 * the factory is a type-safe convenience, never a loader requirement.
 */
export interface ExtensionDefinition {
  kind: 'extension';
  /** Contract vocabulary/semantics level. Absent means api 2; the factory never stamps it. */
  api?: number;
  name: string;
  summary: string;
  description?: string;
  verbs?: Record<string, VerbDecl>;
  /** Deterministic typed measurements keyed by flat sensor name. */
  sensors?: Record<string, SensorDecl>;
  records?: Record<string, RecordDecl>;
  /** Reserved in api 2; carried through normalization but has no Phase 1 handler. */
  custom?: Record<string, Record<string, CustomItem>>;
}

/** Factory input omits the discriminator; {@link defineExtension} adds it. */
export type ExtensionInput = Omit<ExtensionDefinition, 'kind'>;

/**
 * Api-level section vocabulary. Metadata (`kind`, `api`, `name`, `summary`,
 * `description`) is stable and checked separately by the gate.
 */
export const API_VOCABULARY = {
  2: ['verbs', 'sensors', 'records', 'custom'],
} as const satisfies Record<number, readonly string[]>;

/** The highest v2 vocabulary this core can normalize. */
export const CORE_EXTENSION_API = 2;

/**
 * Type-preserving identity + brand helper. It intentionally does NOT add `api`:
 * absence means api 2 by contract, rather than whichever core happens to load it.
 */
export function defineExtension<const T extends ExtensionInput>(
  definition: T,
): T & { kind: 'extension' } {
  return { kind: 'extension', ...definition };
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
  | ExtensionDefinition
  | Array<HarnessVerb | HarnessRecordType | ExtensionDefinition>;

/** What `doctor` enumerates per discovered extension file (P7). */
export interface ExtensionRecord {
  /** Resolved absolute path. */
  entryPath: string;
  status: 'loaded' | 'failed' | 'conflict';
  /** Declared verbs accepted from this file (empty when `failed` or record-only). */
  verbs: HarnessVerb[];
  /** Declared record types accepted from this file (present only when non-empty). */
  recordTypes?: HarnessRecordType[];
  /** Declared sensors accepted from this file (present only when non-empty). */
  sensors?: Array<{ name: string; summary: string }>;
  /** User-defined custom items accepted from this file (present only when non-empty). */
  customItems?: Array<{ type: string; name: string; summary: string }>;
  /** Authoring format(s) represented by this file (`v1`, `v2 (api N)`, or mixed). */
  format?: string;
  /** Non-failing loader/validator observations surfaced by doctor. */
  info?: string[];
  /** Stable error code for failed/conflict records. */
  code?: string;
  /** Load/validation message (present when status !== 'loaded'). */
  error?: string;
  /** Actionable recovery for every failed/conflict record. */
  next_action?: string;
  /** For 'conflict': the VERB name(s) shadowed by a core command or earlier extension. */
  shadows?: string[];
  /** For 'conflict': the RECORD-TYPE name(s) shadowed by a core type or earlier extension. */
  recordShadows?: string[];
}
