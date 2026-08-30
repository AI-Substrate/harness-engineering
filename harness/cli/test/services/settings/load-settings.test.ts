import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import {
  LOCAL_SETTINGS_PATH,
  loadSettings,
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
});
