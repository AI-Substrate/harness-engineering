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

/** Read the two fixed settings files and delegate all merge policy to the pure resolver. */
export function loadSettings(repoRoot: string, deps: LoadSettingsDeps): SettingsResolution {
  const root = toPosix(repoRoot);
  const repo = readOptional(deps.fs, posixJoin(root, REPO_SETTINGS_PATH));
  if (!repo.ok) return repo;
  const local = readOptional(deps.fs, posixJoin(root, LOCAL_SETTINGS_PATH));
  if (!local.ok) return local;
  return resolve(repo.text, local.text, deps.env);
}
