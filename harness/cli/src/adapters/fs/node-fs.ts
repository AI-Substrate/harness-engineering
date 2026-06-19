import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
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

  rename(from: string, to: string): void {
    // Atomic on the same filesystem (POSIX rename(2) / Windows MoveFileEx replace).
    renameSync(from, to);
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
