import type { FsPort } from '../../../adapters/fs/fs-port.js';
import { resolveInRepo, toPosix } from '../../shared/posix-path.js';
import { AGENT_MARKERS, configPathsFor, detectAgents, UNDETECTED_INSTALLERS } from './agents.js';
import type { CollectorDeps } from './types.js';

/**
 * Copy the agent config files `install-hooks` rewrites, immediately before it
 * runs (plan 077).
 *
 * SCOPE, and it is deliberately small. Of git-ai's seven disclosed side effects
 * only ONE destroys content that cannot be reconstructed: it rewrites each
 * detected agent's config in place, reformatting it and DISCARDING JSONC
 * COMMENTS, and keeps no backup of its own. The global trace2 reset is a
 * debugging section nobody hand-authors, and our precondition only proceeds on
 * an observed-EMPTY one; the daemon restart is a restart; the skills removal is
 * already guarded by a nine-path inspection that refuses on real content. So
 * this is a file copy, not a transaction log, and it is not a safety mechanism
 * that makes anything else acceptable.
 *
 * NEVER THROWS. Every error is captured and reported as a `failed` entry rather
 * than raised — but a non-empty `failed` list now BLOCKS the install at the call
 * site (`installHooks`), and that reverses a judgement written here originally:
 * "a backup that could abort the thing it protects would be a worse failure than
 * the comment loss it prevents."
 *
 * That was wrong, and the cross-model review (2026-08-09) named why. The harm is
 * not the comment loss on its own; it is the CLAIM. Because this function is
 * non-blocking, the install's success line could name a backup directory to an
 * operator whose config had just been rewritten and NOT copied. Someone told
 * their originals are safe stops looking for them. So the copy still never
 * throws — the DECISION belongs to the caller, which is the only place that
 * knows what is about to be destroyed.
 *
 * PLATFORM. Paths are composed from `host.home`, which the composition root
 * resolves as `$HOME || %USERPROFILE% || os.homedir()`, and joined with `/` —
 * the repo's logical-POSIX convention, which Node accepts on win32.
 *
 * RESTORE (plan 082 phase 3, tk-0001). This module was WRITE-ONLY until that
 * task: it flattened each home-relative path into one directory by substituting
 * `__` for `/`, and nothing anywhere reversed the mapping. The reason it was
 * never reversed is that it CANNOT BE. Measured against this function on the
 * real filesystem, with `CLAUDE_CONFIG_DIR` pointing at a directory whose own
 * name contains the separator:
 *
 *   source  /var/…/cfg__a/settings.json
 *   stored  __var__…__cfg__a__settings.json
 *   inverse /var/…/cfg/a/settings.json      <- A DIFFERENT FILE
 *
 * The substitution is not injective, so "restore" through it would write to a
 * path that never existed while leaving the damaged original in place. Note the
 * trap: `.cursor/hooks.json` round-trips perfectly, so a demonstration built on
 * the paths we expect would have passed.
 *
 * So the flatten is gone. Copies now land in a TREE THAT PRESERVES THE PATH
 * verbatim (`files/home/<rel>` for a home-relative source, `files/abs/<path>`
 * for an absolute one — two namespaces so the two cannot collide), and a
 * `manifest.json` records the ABSOLUTE source beside its stored location. The
 * manifest is authoritative: restore never parses a filename, so no encoding
 * needs to be reversible. Injectivity is still CHECKED rather than assumed — a
 * collision is a `failed` entry, which blocks the install at the call site,
 * because a backup that silently overwrites one of its own copies is worse than
 * no backup at all.
 *
 * ABSENCES ARE RECORDED. A source that does not exist yet is not copied — there
 * is nothing to copy — but it IS written to the manifest with `existed: false`,
 * because our own installer CREATES config files (`install-strategy-a`), and for
 * a file we created the restore is to DELETE it. Phase 2 could only distinguish
 * that case through the installer's `created: true` flag; the manifest now
 * carries it too, which is what makes an install→restore round trip closed.
 */

export interface ConfigBackup {
  /** Where the copies went; `null` when nothing needed copying. */
  dir: string | null;
  /** Home-relative config paths successfully copied. */
  copied: string[];
  /** Config paths that exist but could not be copied, with the reason. */
  failed: string[];
  /**
   * Detected agents for which we declare NO config path — so the reader can see
   * the difference between "nothing to copy" and "we did not know where to look".
   */
  undeclared: string[];
  /**
   * Config paths that did NOT exist when the backup was taken, recorded so a
   * restore can DELETE a file the install created rather than leave it behind.
   * Deliberately NOT in `copied` (nothing was copied) and NOT in `failed`
   * (nothing went wrong) — phase 2 asserted that silence and it still holds.
   */
  absent: string[];
  /** One line for the operator, naming the location or why there is none. */
  detail: string;
}

/** The layout version `restoreAgentConfigs` understands. */
export const BACKUP_MANIFEST_VERSION = 1;

/** File name of the authoritative source→copy map inside a backup directory. */
export const BACKUP_MANIFEST_NAME = 'manifest.json';

export interface BackupManifestEntry {
  /** Absolute source path, recorded so restore never has to reconstruct one. */
  source: string;
  /** Location of the copy, relative to the backup directory; null when absent. */
  stored: string | null;
  /** Whether the source existed when the backup was taken. */
  existed: boolean;
}

export interface BackupManifest {
  version: number;
  takenAt: string;
  home: string;
  entries: BackupManifestEntry[];
}

/** `<home>/.git-ai/harness-backups/<iso-with-safe-separators>`. */
export function backupDirFor(home: string, nowIso: string): string {
  const stamp = nowIso.replace(/[:.]/g, '-');
  return `${home.replace(/\/+$/, '')}/.git-ai/harness-backups/${stamp}`;
}

/**
 * Where one source path's copy lives, relative to the backup directory.
 *
 * Two namespaces, and the split is what makes the map injective: a home-relative
 * `var/x` and an absolute `/var/x` are different files and land in different
 * subtrees.
 *
 * THE DRIVE LETTER IS THE ONE SUBSTITUTION, AND IT IS NOT COSMETIC (plan 083).
 * `files/abs/` used to keep the source path verbatim — which on Windows produced
 * `files/abs/C:/Users/dev/cfg/settings.json`. **A `:` is a reserved character in a
 * Windows path SEGMENT** (it is the drive separator, and NTFS reads it as an
 * alternate data stream), so that is not a path that can be created: the `mkdirp`
 * fails, or worse, `C:` is read as a drive-relative reference and the copy lands
 * somewhere entirely unrelated to the backup. An off-home config — any
 * `CLAUDE_CONFIG_DIR`/`GEMINI_CLI_HOME` pointing outside the home — is exactly the
 * case that reaches it.
 *
 * So `C:/x` stores at `files/abs/C/x`: the drive becomes an ordinary segment.
 * INJECTIVITY SURVIVES, and where it could not it REFUSES rather than corrupts —
 * the caller compares `usedStored` and fails the entry if two sources ever claim
 * one stored path. NOTHING NEEDS DECODING, because restore never inverts this:
 * `manifest.json` records the ABSOLUTE source beside its stored location, and the
 * restore reads `source` to decide where the bytes go.
 */
export function storedPathFor(source: string, home: string): string {
  // Both sides cross the boundary before they are compared: a caller may hand us a
  // native `home` (plan 083). Without this the prefix test answers falsely on
  // Windows and a home-relative config is filed under `files/abs/`, where restore
  // looks for it in the wrong namespace.
  const root = toPosix(home).replace(/\/+$/, '');
  const src = toPosix(source);
  if (src.startsWith(`${root}/`)) return `files/home/${src.slice(root.length + 1)}`;
  return `files/abs/${src.replace(/^([A-Za-z]):\//, '$1/').replace(/^\/+/, '')}`;
}

export function backupAgentConfigs(deps: CollectorDeps): ConfigBackup {
  // CONVERTED AT THE BOUNDARY (plan 083). `deps.host.home` is NATIVE — it comes
  // from `os.homedir()` — and every path built from it below is one this service
  // SURFACES (`restored`, the manifest `source`) or COMPARES (`storedPathFor`).
  // Interpolating it raw into `${home}/${rel}` produced a MIXED path on Windows,
  // `C:\Users\dev/.cursor/hooks.json`, which Node's fs accepts — so the copy
  // worked and only the comparison and the report were wrong. `storedPathFor`
  // then matched it only because the mixed shape happened to put a `/` exactly
  // where it looked for one: correct by coincidence. See services/shared/posix-path.ts.
  const home = toPosix(deps.host.home).replace(/\/+$/, '');
  const takenAt = deps.clock.nowIso();
  const dir = backupDirFor(home, takenAt);
  const copied: string[] = [];
  const failed: string[] = [];
  const undeclared: string[] = [];
  const absent: string[] = [];
  const entries: BackupManifestEntry[] = [];
  const usedStored = new Map<string, string>();

  let detected: readonly { id: string; label: string; configs: readonly string[] }[];
  try {
    detected = detectAgents(deps.fs, home);
  } catch (err) {
    return {
      dir: null,
      copied,
      failed: [`could not detect agents: ${message(err)}`],
      undeclared,
      absent,
      detail: `no agent configs were copied — detection failed: ${message(err)}`,
    };
  }

  for (const agent of detected) {
    const sources = configPathsFor(agent, home, deps.host.envOverrides ?? {});
    if (sources.length === 0) {
      undeclared.push(agent.id);
      continue;
    }
    for (const rel of sources) {
      /*
       * `resolveInRepo` RATHER THAN `rel.startsWith('/')` (plan 083).
       *
       * `configPathsFor` returns a home-RELATIVE key for an ordinary config and an
       * ABSOLUTE logical path for one that lives outside the home — which is what an
       * env override (`CLAUDE_CONFIG_DIR`, `GEMINI_CLI_HOME`) produces. The old test
       * asked whether the string began with `/`, and **a logical Windows absolute is
       * `C:/…`, which does not**. So every off-home config on Windows was treated as
       * relative and anchored onto the home: `C:/Users/dev/home/C:/Users/dev/cfg/settings.json`.
       * That path does not exist, so the file was silently recorded as ABSENT rather
       * than copied — and "absent" is a restore INSTRUCTION meaning *delete this*.
       * A backup that quietly resolves to nothing, then tells restore to remove the
       * user's real config, is the worst available reading of this data.
       *
       * `resolveInRepo` is the repo's own answer to exactly this question and
       * already treats a drive root as absolute (`services/shared/posix-path.ts`).
       */
      const source = resolveInRepo(rel, home);
      try {
        if (!deps.fs.exists(source)) {
          // Nothing to copy, but the ABSENCE is the restore instruction: if the
          // install creates this file, putting the machine back means removing it.
          if (!entries.some((e) => e.source === source)) {
            entries.push({ source, stored: null, existed: false });
            absent.push(rel);
          }
          continue;
        }
        const bytes = deps.fs.readBytesNoFollow(source);
        if (bytes === null) {
          failed.push(`${rel} (unreadable, or not a regular file)`);
          continue;
        }
        const stored = storedPathFor(source, home);
        const collidesWith = usedStored.get(stored);
        if (collidesWith !== undefined && collidesWith !== source) {
          // Injective by construction — so if this ever fires the construction is
          // wrong, and a backup that overwrites its own copy must refuse rather
          // than report a success it cannot honour.
          failed.push(`${rel} (would overwrite the copy of ${collidesWith} at ${stored})`);
          continue;
        }
        deps.fs.mkdirp(parentOf(`${dir}/${stored}`));
        deps.fs.writeBytes(`${dir}/${stored}`, bytes);
        usedStored.set(stored, source);
        if (!entries.some((e) => e.source === source)) {
          entries.push({ source, stored, existed: true });
        }
        copied.push(rel);
      } catch (err) {
        failed.push(`${rel} (${message(err)})`);
      }
    }
  }

  if (entries.length > 0) {
    const manifest: BackupManifest = {
      version: BACKUP_MANIFEST_VERSION,
      takenAt,
      home,
      entries,
    };
    try {
      deps.fs.mkdirp(dir);
      deps.fs.writeText(`${dir}/${BACKUP_MANIFEST_NAME}`, `${JSON.stringify(manifest, null, 2)}\n`);
    } catch (err) {
      // Copies with no manifest are the write-only state this task exists to end.
      failed.push(`${BACKUP_MANIFEST_NAME} (${message(err)})`);
    }
  }

  return {
    dir: copied.length === 0 ? null : dir,
    copied,
    failed,
    undeclared,
    absent,
    detail: describe(dir, copied, failed, undeclared),
  };
}

function describe(dir: string, copied: string[], failed: string[], undeclared: string[]): string {
  const parts: string[] = [];
  parts.push(
    copied.length === 0
      ? 'no agent config files needed copying'
      : `copied ${copied.length} agent config file(s) to ${dir} before install-hooks rewrote them (${copied.join(', ')})`,
  );
  if (failed.length > 0) parts.push(`could NOT copy: ${failed.join('; ')}`);
  if (undeclared.length > 0) {
    parts.push(
      `no config path is declared for ${undeclared.join(', ')}, so nothing was copied for them`,
    );
  }
  // The honest denominator: this copy covers the agents WE enumerate, and that
  // set is provably smaller than the one git-ai rewrites.
  parts.push(
    `this covers the ${AGENT_MARKERS.length} agent(s) harness detects; git-ai also installs for ${UNDETECTED_INSTALLERS.join(', ')}, which are NOT detected and NOT backed up here`,
  );
  return parts.join('; ');
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

export interface RestoreOutcome {
  /** Absolute source paths rewritten from their copy. */
  restored: string[];
  /** Absolute source paths REMOVED — they did not exist when the backup ran. */
  deleted: string[];
  /** Absolute source paths recorded as absent that were already absent. */
  alreadyAbsent: string[];
  /** Entries that could not be put back, with the reason. */
  failed: string[];
  /** One line for the operator. */
  detail: string;
}

/**
 * Put every file a backup recorded back the way it was — the reverse of
 * {@link backupAgentConfigs}, and the reason that function stopped flattening.
 *
 * READS THE MANIFEST, NEVER A FILENAME. The stored tree is for a human's eyes;
 * the mapping is `manifest.json`. That is what makes the round trip total rather
 * than merely usually-correct: no path is decoded, so no path can be decoded
 * wrongly.
 *
 * RESTORING AN ABSENCE MEANS DELETING. An entry with `existed: false` was a file
 * that did not exist when the backup was taken; if the install created it, the
 * restore is `unlink`. Rewriting it with empty content would leave the machine in
 * a state it was never in.
 *
 * NEVER THROWS. Every failure lands in `failed`, because this is the path an
 * operator reaches for when something has ALREADY gone wrong, and a throw here
 * would abandon the remaining entries — the ones still restorable.
 */
export function restoreAgentConfigs(fs: FsPort, dir: string): RestoreOutcome {
  const restored: string[] = [];
  const deleted: string[] = [];
  const alreadyAbsent: string[] = [];
  const failed: string[] = [];
  const root = dir.replace(/\/+$/, '');

  const raw = fs.readText(`${root}/${BACKUP_MANIFEST_NAME}`);
  if (raw === null) {
    return {
      restored,
      deleted,
      alreadyAbsent,
      failed: [`no ${BACKUP_MANIFEST_NAME} in ${root} — nothing here says what came from where`],
      detail: `restore refused: ${root} has no ${BACKUP_MANIFEST_NAME}`,
    };
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(raw) as BackupManifest;
  } catch (err) {
    return {
      restored,
      deleted,
      alreadyAbsent,
      failed: [`${BACKUP_MANIFEST_NAME} is not valid JSON (${message(err)})`],
      detail: `restore refused: ${root}/${BACKUP_MANIFEST_NAME} is unreadable`,
    };
  }

  if (manifest.version !== BACKUP_MANIFEST_VERSION || !Array.isArray(manifest.entries)) {
    return {
      restored,
      deleted,
      alreadyAbsent,
      failed: [
        `${BACKUP_MANIFEST_NAME} declares version ${String(manifest.version)}, and this build understands ${BACKUP_MANIFEST_VERSION}`,
      ],
      detail: `restore refused: ${root} was written by a different backup layout`,
    };
  }

  for (const entry of manifest.entries) {
    try {
      if (!entry.existed) {
        if (!fs.exists(entry.source)) {
          alreadyAbsent.push(entry.source);
          continue;
        }
        fs.deleteFile(entry.source);
        deleted.push(entry.source);
        continue;
      }
      if (entry.stored === null) {
        failed.push(`${entry.source} (recorded as existing but no copy was named)`);
        continue;
      }
      const bytes = fs.readBytesNoFollow(`${root}/${entry.stored}`);
      if (bytes === null) {
        failed.push(`${entry.source} (its copy at ${entry.stored} is missing or unreadable)`);
        continue;
      }
      fs.mkdirp(parentOf(entry.source));
      fs.writeBytes(entry.source, bytes);
      restored.push(entry.source);
    } catch (err) {
      failed.push(`${entry.source} (${message(err)})`);
    }
  }

  const parts = [`restored ${restored.length} file(s) from ${root}`];
  if (deleted.length > 0) parts.push(`removed ${deleted.length} file(s) that did not exist before`);
  if (alreadyAbsent.length > 0) {
    parts.push(`${alreadyAbsent.length} recorded-absent file(s) were already absent`);
  }
  if (failed.length > 0) parts.push(`could NOT restore: ${failed.join('; ')}`);
  return { restored, deleted, alreadyAbsent, failed, detail: parts.join('; ') };
}
