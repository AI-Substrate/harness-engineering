import type { EnvPort } from '../../adapters/env/env-port.js';
import type { FsPort } from '../../adapters/fs/fs-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';
import {
  invalidSettings,
  LOCAL_SETTINGS_PATH,
  REPO_SETTINGS_PATH,
  resolve,
  type SettingsRefusal,
  type SettingsResolution,
} from './settings.js';

export { LOCAL_SETTINGS_PATH, REPO_SETTINGS_PATH } from './settings.js';

type SettingsFs = Pick<FsPort, 'exists' | 'readText'>;
type OptionalRead = { ok: true; text: string | null } | SettingsRefusal;

export interface LoadSettingsDeps {
  fs: SettingsFs;
  env: EnvPort;
}

function readOptional(fs: SettingsFs, path: string): OptionalRead {
  if (!fs.exists(path)) return { ok: true, text: null };
  const text = fs.readText(path);
  return text === null
    ? invalidSettings(
        path,
        'file exists but is unreadable',
        `Fix permissions for ${path}, or move the unreadable file aside, then retry.`,
      )
    : { ok: true, text };
}

/**
 * A LINKED git worktree carries a `.git` FILE (not a directory) whose single line
 * is `gitdir: <main>/.git/worktrees/<name>`. From it the main checkout's root is
 * `<main>`. Returns null for a main checkout, a bare/absent `.git`, or any
 * unexpected shape — never guesses.
 */
export function mainWorktreeRoot(root: string, fs: SettingsFs): string | null {
  const dotGit = posixJoin(root, '.git');
  if (!fs.exists(dotGit)) return null;
  const text = fs.readText(dotGit);
  if (text === null) return null;
  const match = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (match === null) return null;
  const gitdir = toPosix(match[1]);
  const marker = '/.git/worktrees/';
  const at = gitdir.indexOf(marker);
  if (at <= 0) return null;
  return gitdir.slice(0, at);
}

/**
 * Read the two fixed settings files and delegate all merge policy to the pure resolver.
 *
 * TRACKED settings are REPOSITORY data, not branch data: a linked worktree whose
 * branch predates the commit that added `.harness/settings.json` has no file of
 * its own, and before this fallback that meant "consent off" for every stream
 * worktree in a repo that had consented on main (2026-09-02: 57 pij seats and all
 * 10 voxel-flying-game streams were dark for exactly this reason). So when the
 * worktree has NO tracked file, the MAIN checkout's tracked file stands in for it,
 * still at origin `repo`. A tracked file in the worktree always wins — a branch
 * may legitimately carry different settings. LOCAL settings are never inherited:
 * they are per-checkout by definition.
 */
export function loadSettings(repoRoot: string, deps: LoadSettingsDeps): SettingsResolution {
  const root = toPosix(repoRoot);
  let repo = readOptional(deps.fs, posixJoin(root, REPO_SETTINGS_PATH));
  if (!repo.ok) return repo;
  if (repo.text === null) {
    const main = mainWorktreeRoot(root, deps.fs);
    if (main !== null && main !== root) {
      repo = readOptional(deps.fs, posixJoin(main, REPO_SETTINGS_PATH));
      if (!repo.ok) return repo;
    }
  }
  const local = readOptional(deps.fs, posixJoin(root, LOCAL_SETTINGS_PATH));
  if (!local.ok) return local;
  return resolve(repo.text, local.text, deps.env);
}
