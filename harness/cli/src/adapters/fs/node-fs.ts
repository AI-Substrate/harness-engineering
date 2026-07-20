import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FileSystemWritePort, FsPort } from './fs-port.js';

/** Real filesystem — the only place `node:fs` is touched. */
export class NodeFs implements FsPort, FileSystemWritePort {
  exists(path: string): boolean {
    return existsSync(path);
  }

  readText(path: string): string | null {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  }

  readBytesNoFollow(path: string): Uint8Array | null {
    try {
      const stat = lstatSync(path);
      return stat.isFile() && !stat.isSymbolicLink() ? Uint8Array.from(readFileSync(path)) : null;
    } catch {
      return null;
    }
  }

  listRegularFilesNoFollow(root: string): string[] | null {
    try {
      const rootStat = lstatSync(root);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
      const out: string[] = [];
      const walk = (dir: string): boolean => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isSymbolicLink()) return false;
          if (entry.isDirectory()) {
            if (!walk(path)) return false;
          } else if (entry.isFile()) {
            out.push(relative(root, path).split(sep).join('/'));
          } else return false;
        }
        return true;
      };
      if (!walk(root)) return null;
      return out.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    } catch {
      return null;
    }
  }

  mtimeMs(path: string): number | null {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return null;
    }
  }

  readdir(path: string): string[] {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  }

  mkdirp(path: string): void {
    mkdirSync(path, { recursive: true });
  }

  writeText(path: string, contents: string): void {
    writeFileSync(path, contents, 'utf8');
  }

  writeBytes(path: string, contents: Uint8Array): void {
    writeFileSync(path, contents);
  }

  normalizeBundleTargetIdentity(target: string): string {
    return resolve(target);
  }

  createSiblingTempDir(target: string, prefix: string): string {
    const parent = dirname(target);
    mkdirSync(parent, { recursive: true });
    return mkdtempSync(join(parent, `.${basename(target)}.${prefix}`));
  }

  publishDirectoryExclusive(temp: string, target: string, lockKey: string): void {
    const parent = dirname(target);
    mkdirSync(parent, { recursive: true });
    const lock = join(parent, `.${lockKey}.lock`);
    let descriptor: number | null = null;
    try {
      descriptor = openSync(lock, 'wx');
      if (existsSync(target)) throw new Error('bundle target exists');
      renameSync(temp, target);
    } finally {
      if (descriptor !== null) {
        closeSync(descriptor);
        unlinkSync(lock);
      }
    }
  }

  rename(from: string, to: string): void {
    // Atomic on the same filesystem (POSIX rename(2) / Windows MoveFileEx replace).
    renameSync(from, to);
  }

  deleteFile(path: string): void {
    // `force` makes a missing path a no-op (idempotent prune) — never throws ENOENT.
    rmSync(path, { force: true });
  }

  removeDir(path: string): void {
    // Recursive + force: remove the whole tree, tolerate an already-gone dir.
    rmSync(path, { recursive: true, force: true });
  }

  copyDir(src: string, dest: string): boolean {
    try {
      cpSync(src, dest, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  realpath(path: string): string | null {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  }

  copy(src: string, destDir: string, opts?: { confineRoot?: string }): boolean {
    // Default to copying the path as given; under confinement we copy from the
    // RESOLVED real path instead, so a symlink swapped after the check can't
    // redirect the read (no check-then-copy TOCTOU).
    let source = src;
    if (opts?.confineRoot !== undefined) {
      const realRoot = this.realpath(opts.confineRoot);
      const realSrc = this.realpath(src);
      // A missing/dangling source or root resolves to null ⇒ refuse (never a
      // silent skip-all the way a failed POSIX `realpath` shell-out would be).
      if (realRoot === null || realSrc === null) return false;
      // node:path is correct here (real, native, fully-resolved absolute paths);
      // adapters are leaves and must not import services/shared/posix-path.
      const rel = relative(realRoot, realSrc);
      // Refuse an escape (rel is `..` / starts `../`) or an absolute rel. Match
      // the SEPARATOR so an in-tree name that merely *starts* with `..` (e.g.
      // `..foo`) is NOT over-rejected — fail-closed either way (F003).
      if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
      source = realSrc;
    }
    try {
      mkdirSync(destDir, { recursive: true });
      // Preserve the caller-facing basename (src), copy the validated bytes (source).
      copyFileSync(source, join(destDir, basename(src)));
      return true;
    } catch {
      return false;
    }
  }

  mkdtemp(prefix: string): string {
    return mkdtempSync(join(tmpdir(), prefix));
  }
}
