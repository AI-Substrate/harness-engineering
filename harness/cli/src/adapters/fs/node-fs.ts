import {
  closeSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
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
  constructor(
    private readonly noFollowFlag: number | null = typeof constants.O_NOFOLLOW === 'number'
      ? constants.O_NOFOLLOW
      : null,
    private readonly beforeConfinedOpen: (() => void) | null = null,
  ) {}

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

  private confinedRegularFile(
    root: string,
    path: string,
    maxBytes: number,
  ):
    | { status: 'ok'; path: string; root: string; bytes: number; dev: number; ino: number }
    | {
        status: 'unavailable';
        reason: 'missing' | 'symlink' | 'non-file' | 'oversize' | 'io-error';
      } {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
      return { status: 'unavailable', reason: 'oversize' };
    }
    try {
      const lexicalRoot = resolve(root);
      const lexicalPath = resolve(path);
      const lexicalRelative = relative(lexicalRoot, lexicalPath);
      if (
        lexicalRelative === '..' ||
        lexicalRelative.startsWith(`..${sep}`) ||
        isAbsolute(lexicalRelative)
      ) {
        return { status: 'unavailable', reason: 'symlink' };
      }
      let component = lexicalRoot;
      for (const part of lexicalRelative.split(sep).filter((value) => value.length > 0)) {
        component = join(component, part);
        if (lstatSync(component).isSymbolicLink()) {
          return { status: 'unavailable', reason: 'symlink' };
        }
      }

      const realRoot = realpathSync(root);
      const realPath = realpathSync(path);
      const fromRoot = relative(realRoot, realPath);
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        return { status: 'unavailable', reason: 'symlink' };
      }

      const stat = statSync(realPath);
      if (!stat.isFile()) return { status: 'unavailable', reason: 'non-file' };
      if (stat.size > maxBytes) return { status: 'unavailable', reason: 'oversize' };
      return {
        status: 'ok',
        path: realPath,
        root: realRoot,
        bytes: stat.size,
        dev: stat.dev,
        ino: stat.ino,
      };
    } catch (error) {
      return { status: 'unavailable', reason: this.noFollowFailure(error) };
    }
  }

  probeRegularFileNoFollow(
    root: string,
    path: string,
    maxBytes: number,
  ): ReturnType<FsPort['probeRegularFileNoFollow']> {
    const confined = this.confinedRegularFile(root, path, maxBytes);
    return confined.status === 'ok' ? { status: 'ok', bytes: confined.bytes } : confined;
  }

  /**
   * Bounded read that must not follow a symlink.
   *
   * ## The guarantee is NOT the same on every platform, and that is deliberate
   *
   * Where the kernel offers `O_NOFOLLOW` (POSIX), the open itself refuses a symlink
   * and the guarantee is kernel-enforced. **Windows has no `O_NOFOLLOW`** — Node does
   * not define `fs.constants.O_NOFOLLOW` there at all — so on that platform the open
   * proceeds WITHOUT the flag and the protection is carried entirely by the `dev`/`ino`
   * cross-check below: the path is `lstat`ed before the open, re-`lstat`ed after it, and
   * both are compared against `fstat` of the OPEN DESCRIPTOR. A symlink swapped in
   * between resolution and open changes what the second `lstat` sees, and a file swapped
   * for another changes `dev`/`ino`, so either is refused.
   *
   * **This is WEAKER, not equivalent, and it is accepted knowingly** (plan 077 · #108).
   * Two limits, stated rather than glossed:
   *
   *   - it is a check we perform, not an invariant the kernel enforces, so it closes the
   *     window rather than removing it;
   *   - NTFS file-index semantics are NOT identical to POSIX inodes — `ino` there is a
   *     file index whose uniqueness and stability guarantees differ, so the comparison
   *     is a strong signal on that platform rather than a proof of identity; and
   *   - of the two comparisons below, only the pre-open-vs-post-open pair is exercised
   *     by a control (`node-fs.test.ts`, both swap kinds, verified by mutation). The
   *     comparison against `fstat` of the open descriptor is defence in depth and is
   *     NOT independently proven: the fixture has one injection point, so a swap that
   *     fools the `lstat` pair but not the descriptor cannot be staged deterministically.
   *     Do not read it as a second guarantee; read it as a narrowing.
   *
   * It was previously fail-closed: with no `O_NOFOLLOW` this returned `io-error` without
   * attempting any I/O. That was a considered choice, but its consequence was that the
   * primitive could never read ANY file on Windows — so every consumer of it
   * (`claude-adapter`, `copilot-adapter`, `copilot-vscode-adapter`) was silently blind
   * there, reporting null capabilities and empty file lists. The relaxation was chosen
   * because the alternative is not a stronger guarantee, it is a feature that does not
   * work at all on that platform.
   */
  readTextFileNoFollow(
    root: string,
    path: string,
    maxBytes: number,
  ): ReturnType<FsPort['readTextFileNoFollow']> {
    const confined = this.confinedRegularFile(root, path, maxBytes);
    if (confined.status === 'unavailable') return confined;

    const noFollow = this.noFollowFlag;
    const nonBlock = typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0;

    let descriptor: number | null = null;
    try {
      this.beforeConfinedOpen?.();
      descriptor = openSync(confined.path, constants.O_RDONLY | (noFollow ?? 0) | nonBlock);
      const opened = fstatSync(descriptor);
      if (!opened.isFile()) return { status: 'unavailable', reason: 'non-file' };
      if (opened.size > maxBytes) return { status: 'unavailable', reason: 'oversize' };

      const afterOpen = this.confinedRegularFile(root, path, maxBytes);
      if (afterOpen.status === 'unavailable') return afterOpen;
      if (
        afterOpen.path !== confined.path ||
        afterOpen.root !== confined.root ||
        afterOpen.dev !== confined.dev ||
        afterOpen.ino !== confined.ino ||
        afterOpen.dev !== opened.dev ||
        afterOpen.ino !== opened.ino
      ) {
        return { status: 'unavailable', reason: 'io-error' };
      }

      const contents = Buffer.allocUnsafe(opened.size);
      let offset = 0;
      while (offset < opened.size) {
        const count = readSync(descriptor, contents, offset, opened.size - offset, offset);
        if (count === 0) break;
        offset += count;
      }
      const sentinel = Buffer.allocUnsafe(1);
      if (readSync(descriptor, sentinel, 0, 1, offset) !== 0) {
        return { status: 'unavailable', reason: 'io-error' };
      }
      return {
        status: 'ok',
        bytes: offset,
        text: contents.subarray(0, offset).toString('utf8'),
      };
    } catch (error) {
      return { status: 'unavailable', reason: this.noFollowFailure(error) };
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
  }

  private noFollowFailure(error: unknown): 'missing' | 'symlink' | 'non-file' | 'io-error' {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'ENOENT') return 'missing';
    if (code === 'ELOOP' || code === 'EMLINK') return 'symlink';
    if (code === 'EISDIR') return 'non-file';
    return 'io-error';
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
