import type { FsPort } from '../../adapters/fs/fs-port.js';

/**
 * WHAT INSTALL CREATED, remembered across processes (plan 082, phase-2 review F003).
 *
 * WHY THIS FILE EXISTS. Uninstall promised surgical removal of only what we added,
 * and then removed any event array it had emptied — inferring *we created this key*
 * from *this array is now empty*. Those are different questions, and the cross-model
 * review confirmed the gap: a user whose config already carried an empty
 * `PreToolUse: []` lost that key. Whether a particular agent treats absent and empty
 * alike is INFERRED and unmeasured, and the PM's ruling is the right one — that
 * uncertainty is not a licence to delete state we did not create.
 *
 * The distinction is knowable at exactly one instant — before the first write — and
 * unrecoverable from the file afterwards. So it is captured there and persisted here.
 *
 * ABSENCE MEANS "NOT OURS". A machine that installed with an older build, or whose
 * record was deleted, has NO provenance — and the safe reading of no provenance is
 * that we created nothing, so uninstall removes our entries and leaves every key
 * alone. It leaves a `"PreToolUse": []` we may in fact have created; that is cruft,
 * and cruft is the strictly recoverable error. Deleting a user's key is not.
 *
 * NOT A LOCK, NOT A SOURCE OF TRUTH ABOUT THE CONFIG. The config file is always
 * authoritative for what is installed — `status` reads the marker, never this. This
 * answers one question the file cannot: what was there before.
 */

export const INSTALL_RECORD_VERSION = 1;

export interface InstallRecordEntry {
  /** Absolute config path. */
  path: string;
  /** True when we created the file itself, so uninstall deletes rather than edits. */
  createdFile: boolean;
  /** Event-array keys we created in it. Only these may be removed. */
  createdKeys: string[];
  /**
   * Root-field paths we created in it, e.g. `['tools','enableHooks']` (phase-5
   * review F2). Only these MAY be removed, and only when nothing else in the file
   * still depends on them — see `uninstall-strategy-a.ts`.
   *
   * OPTIONAL, DELIBERATELY. A record written by an older build carries no such
   * field, and `undefined` must read as *we created nothing*, not as *unknown, so
   * guess*. That is the same direction every other provenance question fails in
   * here: retain.
   */
  createdRootExtras?: string[][];
}

export interface InstallRecord {
  version: number;
  entries: InstallRecordEntry[];
}

/** `<stateDir>/install-record.json`. */
export function installRecordPath(stateDir: string): string {
  return `${stateDir.replace(/\/+$/, '')}/install-record.json`;
}

/**
 * CAN we persist provenance? Asked BEFORE the first config is touched.
 *
 * WHY A PROBE AND NOT JUST A RETURN VALUE (plan 082, phase-3 review F001). The
 * record is the single point of truth for what uninstall may delete, so a config
 * written without one is a config uninstall under-removes — the safe direction, and
 * still a file left on a user's machine after a cleanup they believe succeeded. The
 * review reproduced exactly that with `~/.harness` occupied by a regular file: the
 * install reported `created: true` and `failed: []`, and the created config survived
 * the uninstall.
 *
 * ASKING FIRST IS STRICTLY BETTER THAN COMPENSATING AFTER, because the end state is
 * the original one rather than a restored one — nothing was written, so nothing has
 * to be un-written correctly. It does not REPLACE the return-value check in
 * {@link recordInstall}: a probe answers for the instant it ran, and the disk can
 * fill between the probe and the write. Both, therefore: this closes the
 * reproducible case, and the caller's compensation closes the race.
 *
 * IT WRITES THE RECORD IT READ — an idempotent round trip rather than a probe file,
 * so a failed probe leaves no litter and a successful one leaves only the empty
 * record it would have created anyway.
 */
export function ensureRecordWritable(fs: FsPort, stateDir: string): boolean {
  const record = readInstallRecord(fs, stateDir);
  try {
    fs.mkdirp(stateDir);
    fs.writeText(installRecordPath(stateDir), serialize(record.entries));
    return true;
  } catch {
    return false;
  }
}

const serialize = (entries: readonly InstallRecordEntry[]): string =>
  `${JSON.stringify({ version: INSTALL_RECORD_VERSION, entries }, null, 2)}\n`;

const EMPTY: InstallRecord = { version: INSTALL_RECORD_VERSION, entries: [] };

/** Read the record, or an empty one. NEVER throws — absence is a normal state. */
export function readInstallRecord(fs: FsPort, stateDir: string): InstallRecord {
  const raw = fs.readText(installRecordPath(stateDir));
  if (raw === null) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as InstallRecord;
    if (parsed.version !== INSTALL_RECORD_VERSION || !Array.isArray(parsed.entries)) return EMPTY;
    return parsed;
  } catch {
    // A record we cannot read is treated as no record — which is the conservative
    // reading, not the convenient one: uninstall will remove fewer things.
    return EMPTY;
  }
}

/**
 * Merge these outcomes into the record.
 *
 * MERGED, NOT REPLACED, and the union of `createdKeys` is deliberate: installing
 * twice must not lose the first install's provenance. The FIRST install is the one
 * that created the key, and a second install — finding it present — would record
 * nothing, so an overwrite would silently forget that we own it.
 *
 * Returns false when the record could not be written. The caller decides what that
 * means; nothing here throws, because a provenance write must never break an install
 * that otherwise worked.
 */
export function recordInstall(
  fs: FsPort,
  stateDir: string,
  outcomes: readonly {
    path: string;
    created: boolean;
    createdKeys: readonly string[];
    createdRootExtras?: readonly string[][];
  }[],
): boolean {
  if (outcomes.length === 0) return true;
  const record = readInstallRecord(fs, stateDir);
  const byPath = new Map(record.entries.map((e) => [e.path, e]));

  for (const outcome of outcomes) {
    const existing = byPath.get(outcome.path);
    byPath.set(outcome.path, {
      path: outcome.path,
      createdFile: (existing?.createdFile ?? false) || outcome.created,
      createdKeys: [...new Set([...(existing?.createdKeys ?? []), ...outcome.createdKeys])],
      // Union by PATH, not by key, so `['tools']` and `['tools','enableHooks']`
      // stay distinct: they license different removals.
      createdRootExtras: unionPaths(existing?.createdRootExtras, outcome.createdRootExtras),
    });
  }

  try {
    fs.mkdirp(stateDir);
    fs.writeText(installRecordPath(stateDir), serialize([...byPath.values()]));
    return true;
  } catch {
    return false;
  }
}

/** Merge two path lists, deduplicated structurally rather than by reference. */
function unionPaths(
  existing: readonly string[][] | undefined,
  added: readonly string[][] | undefined,
): string[][] {
  const seen = new Map<string, string[]>();
  for (const path of [...(existing ?? []), ...(added ?? [])]) {
    seen.set(JSON.stringify(path), [...path]);
  }
  return [...seen.values()];
}

/** Forget these paths — called after a successful uninstall. */
export function forgetInstalled(fs: FsPort, stateDir: string, paths: readonly string[]): void {
  if (paths.length === 0) return;
  const record = readInstallRecord(fs, stateDir);
  const drop = new Set(paths);
  const entries = record.entries.filter((e) => !drop.has(e.path));
  try {
    fs.mkdirp(stateDir);
    fs.writeText(installRecordPath(stateDir), serialize(entries));
  } catch {
    // A record we could not prune leaves stale provenance, which can only ever cause
    // us to remove a key we did create. Never fatal.
  }
}
