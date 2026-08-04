import type { Clock } from '../../adapters/clock/clock-port.js';
import { SystemClock } from '../../adapters/clock/system-clock.js';
import { NodeEnv } from '../../adapters/env/node-env.js';
import type { ExecPort } from '../../adapters/exec/exec-port.js';
import { NodeExec } from '../../adapters/exec/node-exec.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { HashPort } from '../../adapters/hash/hash-port.js';
import { NodeHash } from '../../adapters/hash/node-hash.js';
import { NodeProcess } from '../../adapters/process/node-process.js';
import { formatUnconfigured } from '../../output/envelope.js';
import { ErrorCodes } from '../../output/error-codes.js';
import { exitWithEnvelope } from '../../output/exit.js';
import { type CliIo, createOutputPort, type OutputPort } from '../../output/output-port.js';
import { parse } from '../../services/dd/core/parse.js';
import type { DdIssueClass } from '../../services/dd/core/validate.js';
import type { DocLoader, DocLoadResult } from '../../services/dd/core/walk.js';
import { MemoizingDocLoader } from '../../services/dd/links/index.js';
import type { DdLinkIssue, DdLinkIssueClass } from '../../services/dd/links/model.js';
import { ConventionSchemaResolver } from '../../services/dd/schema/resolve.js';
import { posixJoin, toPosix } from '../../services/shared/posix-path.js';
import { NodeSchemaFs } from './schema-fs.js';

export interface DdActDeps {
  clock: Clock;
}

export type DdOwningPhase =
  | 'Phase 2: Schema layer & baked docs'
  | 'Phase 3: Render, adapters & freshness'
  | 'Phase 4: Links, ledger & doctor';

export function exitDdStub(
  command: string,
  owner: DdOwningPhase,
  io: CliIo,
  deps: DdActDeps,
): never {
  const envelope = formatUnconfigured(
    command,
    `${owner} owns this command body. Complete that phase, then retry.`,
    deps.clock,
    { data: { owner_phase: owner } },
  );
  return exitWithEnvelope(envelope, createOutputPort(io.mode, io.writers));
}

/**
 * Finding class → frozen E-code, for **every** class dd can produce.
 *
 * dd-core, the schema layer and the links layer all stay free of `output/`, so an
 * act is where a structured finding becomes the CLI's error vocabulary. There
 * used to be three copies of this table — one per act that reports findings — and
 * they had already drifted: `address-path-escape` answered to the generic address
 * code in `dd validate` and to the specific link-escape code in `dd doctor`, so
 * one finding had two codes depending on which verb reported it. One exported
 * map, one answer (P5 T004).
 *
 * The collapse arbitrates exactly ONE class — `address-path-escape`, where the
 * specific code was ruled the winner. Every other class keeps the code its
 * general consumers already gave it: `link-scan-failed` stays
 * `DD_LINK_SCAN_FAILED`, NOT the doctor's `DD_DOCTOR_SCAN_FAILED`, because a
 * class code says what went wrong and must not change with the verb that reports
 * it. `dd doctor` still answers a failed sweep with `DD_DOCTOR_SCAN_FAILED` —
 * that is its ENVELOPE code, hardcoded at its own exit site, so the sweep needs
 * no override in this table (P5 review F002).
 *
 * TypeScript's exhaustive `Record` is the guard that matters: a new issue class
 * cannot be added to any dd layer without this map failing to compile.
 */
export const DD_ISSUE_CODES: Record<DdIssueClass | DdLinkIssueClass, string> = {
  'address-malformed': ErrorCodes.DD_ADDRESS_INVALID,
  'address-path-absolute': ErrorCodes.DD_ADDRESS_INVALID,
  // The specific code wins over the generic one: a path that leaves the
  // repository is a link-path escape, and it is called that wherever it is
  // reported (P5 ruling, PM-confirmed).
  'address-path-escape': ErrorCodes.DD_LINK_PATH_ESCAPE,
  'address-path-non-posix': ErrorCodes.DD_ADDRESS_INVALID,
  'address-target-missing': ErrorCodes.DD_LINK_TARGET_MISSING,
  'address-target-untracked': ErrorCodes.DD_LINK_TARGET_UNTRACKED,
  'adapter-gap': ErrorCodes.DD_ADAPTER_NOT_FOUND,
  'basis-stale': ErrorCodes.DD_BASIS_STALE,
  'duplicate-id': ErrorCodes.DD_ID_DUPLICATE,
  'enum-invalid': ErrorCodes.DD_ENUM_INVALID,
  'human-skipped-receipt-required': ErrorCodes.DD_HUMAN_SKIP_RECEIPT_REQUIRED,
  'id-invalid': ErrorCodes.DD_ID_INVALID,
  'link-scan-failed': ErrorCodes.DD_LINK_SCAN_FAILED,
  'link-scan-incomplete': ErrorCodes.DD_LINK_SCAN_FAILED,
  'link-type-mismatch': ErrorCodes.DD_LINK_TYPE_MISMATCH,
  'link-unresolved': ErrorCodes.DD_LINK_UNRESOLVED,
  'schema-shape': ErrorCodes.DD_SCHEMA_SHAPE_INVALID,
  'schema-unresolvable': ErrorCodes.DD_SCHEMA_UNRESOLVABLE,
  'state-note-required': ErrorCodes.DD_STATE_NOTE_REQUIRED,
};

export function codedLinkIssues(issues: readonly DdLinkIssue[]) {
  return issues.map((issue) => ({ ...issue, code: DD_ISSUE_CODES[issue.class] }));
}

export function nextActionFor(issues: readonly DdLinkIssue[], address: string): string {
  const reason = issues[0]?.reason;
  if (reason === 'no-base-document') {
    return 'Address the file explicitly — `<path>#<interior>`. A bare-"#" address only means something inside its own document.';
  }
  if (reason === 'malformed') {
    return 'Generate the address instead of writing it: `harness dd address generate "<interior>" --path <file>`.';
  }
  return `Check the target with \`harness dd links <target>\`, then fix ${address}.`;
}

/**
 * Document loader for the outbound walk, over the real filesystem.
 *
 * `tracked` comes from ONE `git ls-files` snapshot taken before the walk — the
 * cheap, correct answer, rather than calling every readable file tracked and
 * silently suppressing the untracked-target WARN. A non-repo (or a failing git)
 * yields null, meaning "this host has no tracking concept", not "everything
 * happens to be tracked".
 */
export class FsDocLoader implements DocLoader {
  constructor(
    private readonly fs: Pick<FsPort, 'readText'>,
    private readonly hash: HashPort,
    private readonly tracked: ReadonlySet<string> | null,
  ) {}

  load(path: string): DocLoadResult {
    const text = this.fs.readText(path);
    if (text === null) {
      return { ok: false, path, reason: 'missing', message: `address target is missing: ${path}` };
    }
    const doc = parse(text);
    if (Array.isArray(doc)) {
      return {
        ok: false,
        path,
        reason: 'missing',
        message: `address target is not a readable dd document: ${path}`,
      };
    }
    return {
      ok: true,
      path,
      doc,
      sha: this.hash.sha256Hex(text),
      tracked: this.tracked === null ? true : this.tracked.has(path),
    };
  }
}

export async function trackedPaths(
  exec: ExecPort,
  repoRoot: string,
): Promise<ReadonlySet<string> | null> {
  try {
    const result = await exec.run('git', ['ls-files', '-z'], { cwd: repoRoot, timeoutMs: 20_000 });
    if (!result.ok) return null;
    return new Set(
      result.stdout
        .split('\0')
        .filter((entry) => entry.length > 0)
        .map((entry) => posixJoin(repoRoot, entry)),
    );
  } catch {
    return null;
  }
}

export interface DdLinkContext {
  clock: Clock;
  port: OutputPort;
  repoRoot: string;
  fs: NodeSchemaFs;
  resolver: ConventionSchemaResolver;
  loader: DocLoader;
}

/**
 * Compose the adapters every link-consuming dd verb needs, once.
 *
 * `dd address`, `dd link`, `dd links`, `dd graph` and `dd doctor` all resolve
 * schemas the same way and load documents the same way, and a second copy of that
 * wiring is a second place for the two to drift apart.
 *
 * It lives HERE, and the placement is load-bearing rather than tidy. Phase 4 put
 * it in `acts/dd/link.ts` for one stated reason — "that file belongs to Phase 1
 * and the parallel phases must not touch each other's files" — and the fan-in
 * retired that constraint. Keeping it there would now cost a real boundary:
 * `dd link verify-basis --update` regenerates a sibling, so `link.ts` reaches the
 * render layer, and `graph.ts`/`links.ts` take their context from it — which would
 * drag both across the `dd-graph-never-imports-render` line that Phases 3 and 4
 * were deliberately split along. One module move keeps that boundary honest.
 *
 * `tracked` comes from one `git ls-files` snapshot, so an untracked target is
 * reported honestly instead of every readable file being called tracked.
 */
export async function createLinkContext(
  io: CliIo,
  deps: DdActDeps,
  options: { tracked?: boolean } = {},
): Promise<DdLinkContext> {
  const clock = deps.clock ?? new SystemClock();
  const port = createOutputPort(io.mode, io.writers);
  const fs = new NodeSchemaFs();
  const repoRoot = toPosix(new NodeProcess().cwd());
  const home = new NodeEnv().home();
  const resolver = new ConventionSchemaResolver({
    fs,
    repoRoot,
    ...(home !== undefined && { home: toPosix(home) }),
  });
  const tracked = options.tracked === false ? null : await trackedPaths(new NodeExec(), repoRoot);
  const loader = new MemoizingDocLoader(new FsDocLoader(fs, new NodeHash(), tracked));
  return { clock, port, repoRoot, fs, resolver, loader };
}
