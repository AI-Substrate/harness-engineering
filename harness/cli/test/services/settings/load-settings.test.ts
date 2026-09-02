import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import {
  LOCAL_SETTINGS_PATH,
  loadSettings,
  mainWorktreeRoot,
  REPO_SETTINGS_PATH,
} from '../../../src/services/settings/load-settings.js';

const ROOT = '/repo';
const repoPath = `${ROOT}/${REPO_SETTINGS_PATH}`;
const localPath = `${ROOT}/${LOCAL_SETTINGS_PATH}`;

describe('settings loader', () => {
  it('reads both fixed paths and delegates resolution', () => {
    const fs = new FakeFs({
      [repoPath]: JSON.stringify({
        schema_version: 1,
        machine: { command: 'repo-command' },
        flowspace: { ingest: { enabled: true } },
      }),
      [localPath]: JSON.stringify({ schema_version: 1, machine: { command: 'local-command' } }),
    });

    expect(loadSettings(ROOT, { fs, env: new FakeEnv() })).toMatchObject({
      ok: true,
      settings: {
        machine: { command: { value: 'local-command', origin: 'local' } },
        flowspace: { ingest: { enabled: { value: true, origin: 'repo' } } },
      },
    });
    expect(fs.reads).toEqual([repoPath, repoPath, localPath, localPath]);
  });

  it('treats absent files as defaults', () => {
    expect(loadSettings(ROOT, { fs: new FakeFs(), env: new FakeEnv() })).toMatchObject({
      ok: true,
      settings: { flowspace: { ingest: { enabled: { value: false, origin: 'default' } } } },
    });
  });

  it('returns a coded refusal when an existing file is unreadable', () => {
    const fs = {
      exists: (path: string) => path === repoPath,
      readText: (_path: string) => null,
    };
    expect(loadSettings(ROOT, { fs, env: new FakeEnv() })).toMatchObject({
      ok: false,
      code: ErrorCodes.SETTINGS_INVALID,
      next_action: expect.stringMatching(/permissions/),
    });
  });

  describe("linked worktree inherits the main checkout's TRACKED settings", () => {
    const MAIN = '/main';
    const WT = '/main-worktrees/s5';
    const consenting = JSON.stringify({
      schema_version: 1,
      flowspace: { ingest: { enabled: true } },
    });
    const linked = { [`${WT}/.git`]: `gitdir: ${MAIN}/.git/worktrees/s5\n` };

    it('finds the main root from a linked worktree .git file, and nothing else', () => {
      const fs = new FakeFs({ ...linked, [`${MAIN}/.git`]: 'not a gitdir line' });
      expect(mainWorktreeRoot(WT, fs)).toBe(MAIN);
      expect(mainWorktreeRoot(MAIN, fs)).toBeNull();
      expect(mainWorktreeRoot('/nowhere', fs)).toBeNull();
      expect(
        mainWorktreeRoot(WT, new FakeFs({ [`${WT}/.git`]: 'gitdir: /elsewhere/.git\n' })),
      ).toBeNull();
    });

    it('a worktree with no tracked file takes consent from main, at origin repo', () => {
      const fs = new FakeFs({ ...linked, [`${MAIN}/${REPO_SETTINGS_PATH}`]: consenting });
      expect(loadSettings(WT, { fs, env: new FakeEnv() })).toMatchObject({
        ok: true,
        settings: { flowspace: { ingest: { enabled: { value: true, origin: 'repo' } } } },
      });
    });

    it('a worktree WITH its own tracked file is not overridden by main', () => {
      const fs = new FakeFs({
        ...linked,
        [`${MAIN}/${REPO_SETTINGS_PATH}`]: consenting,
        [`${WT}/${REPO_SETTINGS_PATH}`]: JSON.stringify({
          schema_version: 1,
          flowspace: { ingest: { enabled: false } },
        }),
      });
      expect(loadSettings(WT, { fs, env: new FakeEnv() })).toMatchObject({
        ok: true,
        settings: { flowspace: { ingest: { enabled: { value: false, origin: 'repo' } } } },
      });
    });

    it('never inherits LOCAL settings from main, and main with no file stays default', () => {
      const fs = new FakeFs({
        ...linked,
        [`${MAIN}/${LOCAL_SETTINGS_PATH}`]: JSON.stringify({
          schema_version: 1,
          machine: { command: 'main-local' },
        }),
      });
      expect(loadSettings(WT, { fs, env: new FakeEnv() })).toMatchObject({
        ok: true,
        settings: { flowspace: { ingest: { enabled: { value: false, origin: 'default' } } } },
      });
    });

    it('still refuses when the inherited main file is unreadable', () => {
      const mainRepo = `${MAIN}/${REPO_SETTINGS_PATH}`;
      const fs = {
        exists: (path: string) => path === `${WT}/.git` || path === mainRepo,
        readText: (path: string) => (path === `${WT}/.git` ? linked[`${WT}/.git`] : null),
      };
      expect(loadSettings(WT, { fs, env: new FakeEnv() })).toMatchObject({
        ok: false,
        code: ErrorCodes.SETTINGS_INVALID,
      });
    });
  });
});
