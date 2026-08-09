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
}

export interface InstallRecord {
  version: number;
  entries: InstallRecordEntry[];
}

/** `<stateDir>/install-record.json`. */
export function installRecordPath(stateDir: string): string {
  return `${stateDir.replace(/\/+$/, '')}/install-record.json`;
}

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
  outcomes: readonly { path: string; created: boolean; createdKeys: readonly string[] }[],
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
    });
  }

  try {
    fs.mkdirp(stateDir);
    fs.writeText(
      installRecordPath(stateDir),
      `${JSON.stringify({ version: INSTALL_RECORD_VERSION, entries: [...byPath.values()] }, null, 2)}\n`,
    );
    return true;
  } catch {
    return false;
  }
}

/** Forget these paths — called after a successful uninstall. */
export function forgetInstalled(fs: FsPort, stateDir: string, paths: readonly string[]): void {
  if (paths.length === 0) return;
  const record = readInstallRecord(fs, stateDir);
  const drop = new Set(paths);
  const entries = record.entries.filter((e) => !drop.has(e.path));
  try {
    fs.mkdirp(stateDir);
    fs.writeText(
      installRecordPath(stateDir),
      `${JSON.stringify({ version: INSTALL_RECORD_VERSION, entries }, null, 2)}\n`,
    );
  } catch {
    // A record we could not prune leaves stale provenance, which can only ever cause
    // us to remove a key we did create. Never fatal.
  }
}
