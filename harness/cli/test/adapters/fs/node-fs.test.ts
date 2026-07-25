import { spawnSync } from 'node:child_process';
import {
  constants,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'harness-bounded-read-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('NodeFs — bounded no-follow text reads (P063 T003)', () => {
  it('probes and reads a regular file using its UTF-8 byte length', () => {
    withTempDir((dir) => {
      const path = join(dir, 'session.jsonl');
      writeFileSync(path, 'é\n', 'utf8');
      const fs = new NodeFs();

      expect(fs.probeRegularFileNoFollow(dir, path, 3)).toEqual({ status: 'ok', bytes: 3 });
      expect(fs.readTextFileNoFollow(dir, path, 3)).toEqual({
        status: 'ok',
        bytes: 3,
        text: 'é\n',
      });
    });
  });

  it('distinguishes missing, symlink, non-file, and oversize paths without following them', () => {
    withTempDir((dir) => {
      const fs = new NodeFs();
      const target = join(dir, 'target.jsonl');
      const link = join(dir, 'link.jsonl');
      const directory = join(dir, 'directory');
      const oversize = join(dir, 'oversize.jsonl');
      writeFileSync(target, '{}\n', 'utf8');
      symlinkSync(target, link);
      mkdirSync(directory);
      writeFileSync(oversize, '12345', 'utf8');

      expect(fs.probeRegularFileNoFollow(dir, join(dir, 'missing.jsonl'), 4)).toEqual({
        status: 'unavailable',
        reason: 'missing',
      });
      expect(fs.probeRegularFileNoFollow(dir, link, 4)).toEqual({
        status: 'unavailable',
        reason: 'symlink',
      });
      expect(fs.readTextFileNoFollow(dir, link, 4)).toEqual({
        status: 'unavailable',
        reason: 'symlink',
      });
      expect(fs.probeRegularFileNoFollow(dir, directory, 4)).toEqual({
        status: 'unavailable',
        reason: 'non-file',
      });
      expect(fs.readTextFileNoFollow(dir, directory, 4)).toEqual({
        status: 'unavailable',
        reason: 'non-file',
      });
      expect(fs.probeRegularFileNoFollow(dir, oversize, 4)).toEqual({
        status: 'unavailable',
        reason: 'oversize',
      });
    });
  });

  it('rejects a sparse oversized file from metadata before content allocation', () => {
    withTempDir((dir) => {
      const path = join(dir, 'sparse.jsonl');
      writeFileSync(path, '', 'utf8');
      truncateSync(path, 3 * 1024 * 1024 * 1024);

      expect(new NodeFs().readTextFileNoFollow(dir, path, 1024)).toEqual({
        status: 'unavailable',
        reason: 'oversize',
      });
    });
  });

  it('rejects a regular transcript reached through an ancestor symlink outside its root', () => {
    withTempDir((dir) => {
      const root = join(dir, 'selected-root');
      const outside = join(dir, 'outside');
      const projects = join(root, 'projects');
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(join(outside, 'session.jsonl'), '{}\n', 'utf8');
      symlinkSync(outside, projects, 'dir');
      const path = join(projects, 'session.jsonl');
      const fs = new NodeFs();

      expect(fs.probeRegularFileNoFollow(root, path, 16)).toEqual({
        status: 'unavailable',
        reason: 'symlink',
      });
      expect(fs.readTextFileNoFollow(root, path, 16)).toEqual({
        status: 'unavailable',
        reason: 'symlink',
      });
    });
  });

  it('rejects every symlink component even when its target remains inside the root', () => {
    withTempDir((dir) => {
      const root = join(dir, 'selected-root');
      const targetDir = join(root, 'other-project');
      const projects = join(root, 'projects');
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(join(targetDir, 'session.jsonl'), '{}\n', 'utf8');
      symlinkSync(targetDir, projects, 'dir');
      const path = join(projects, 'session.jsonl');

      expect(new NodeFs().readTextFileNoFollow(root, path, 16)).toEqual({
        status: 'unavailable',
        reason: 'symlink',
      });
    });
  });

  it('fails closed when the platform has no no-follow open flag', () => {
    withTempDir((dir) => {
      const path = join(dir, 'session.jsonl');
      writeFileSync(path, '{}\n', 'utf8');

      expect(new NodeFs(null).readTextFileNoFollow(dir, path, 16)).toEqual({
        status: 'unavailable',
        reason: 'io-error',
      });
    });
  });

  it.skipIf(platform() === 'win32')('classifies a FIFO without blocking', () => {
    withTempDir((dir) => {
      const path = join(dir, 'session.fifo');
      const made = spawnSync('mkfifo', [path]);
      expect(made.status).toBe(0);

      expect(new NodeFs().readTextFileNoFollow(dir, path, 16)).toEqual({
        status: 'unavailable',
        reason: 'non-file',
      });
    });
  });

  it('rejects a file swapped between resolution and opened-handle validation', () => {
    withTempDir((dir) => {
      const path = join(dir, 'session.jsonl');
      const replacement = join(dir, 'replacement.jsonl');
      writeFileSync(path, 'safe\n', 'utf8');
      writeFileSync(replacement, 'replacement\n', 'utf8');
      const fs = new NodeFs(constants.O_NOFOLLOW, () => renameSync(replacement, path));

      expect(fs.readTextFileNoFollow(dir, path, 32)).toEqual({
        status: 'unavailable',
        reason: 'io-error',
      });
    });
  });
});
