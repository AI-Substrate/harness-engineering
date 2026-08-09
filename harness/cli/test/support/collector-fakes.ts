import type { ExecOptions, ExecPort, ExecResult } from '../../src/adapters/exec/exec-port.js';
import type { ExecScript } from '../../src/adapters/exec/fake-exec.js';
import type { PathKind, PathKindPort } from '../../src/adapters/fs/path-kind-port.js';
import type {
  CollectorFsPort,
  DownloadOutcome,
  DownloadPort,
  ExecutableBitPort,
} from '../../src/services/doctor/collector/types.js';

/**
 * Fakes for the git-ai collector's own capability set (plan 073).
 *
 * `FakeFs` cannot serve here: its `rename` moves TEXT files only and throws on a
 * byte file, which is precisely the operation the verified-download path exists
 * to perform. Rather than bend the download away from an atomic publish to suit
 * a fake, the collector's narrow ports get their own byte-aware fakes — the
 * behaviour under test stays the behaviour that ships.
 *
 * Fakes over mocks throughout: every call is recorded, and assertions read the
 * history rather than a call expectation.
 */

export class FakeCollectorFs implements CollectorFsPort {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  readonly writes: string[] = [];
  readonly renames: string[] = [];
  readonly deletes: string[] = [];
  readonly removedDirs: string[] = [];
  readonly mkdtemps: string[] = [];
  /** Sibling temp dirs handed out, so a test can assert WHERE staging happened. */
  readonly siblingTempDirs: string[] = [];
  /** Paths whose write should FAIL — models a full disk / read-only mount. */
  readonly failWrites = new Set<string>();
  /** Paths whose read-back should return SHORT bytes — models an interrupted write. */
  readonly truncateOnReadBack = new Map<string, number>();

  private tempCounter = 0;

  constructor(seed: Record<string, string> = {}) {
    for (const [path, contents] of Object.entries(seed)) {
      this.files.set(path, new TextEncoder().encode(contents));
    }
  }

  seedBytes(path: string, bytes: Uint8Array): void {
    this.files.set(path, Uint8Array.from(bytes));
  }

  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  readText(path: string): string | null {
    const bytes = this.files.get(path);
    return bytes === undefined ? null : new TextDecoder().decode(bytes);
  }

  readBytesNoFollow(path: string): Uint8Array | null {
    const bytes = this.files.get(path);
    if (bytes === undefined) return null;
    const truncate = this.truncateOnReadBack.get(path);
    return truncate === undefined ? Uint8Array.from(bytes) : bytes.slice(0, truncate);
  }

  writeText(path: string, contents: string): void {
    this.writeBytes(path, new TextEncoder().encode(contents));
  }

  writeBytes(path: string, contents: Uint8Array): void {
    if (this.failWrites.has(path)) throw new Error(`FakeCollectorFs: write refused: ${path}`);
    this.writes.push(path);
    this.files.set(path, Uint8Array.from(contents));
  }

  mkdirp(path: string): void {
    this.dirs.add(path);
  }

  mkdtemp(prefix: string): string {
    const dir = `/tmp/${prefix}${this.tempCounter++}`;
    this.mkdtemps.push(prefix);
    this.dirs.add(dir);
    return dir;
  }

  /**
   * Sibling staging — a temp dir on the TARGET's own filesystem.
   *
   * Modelled faithfully enough to be falsifiable: `rename` below refuses to move
   * a path across a device boundary, exactly as POSIX `rename(2)` does, and the
   * device is derived from the first path segment. Without that, this fake would
   * happily rename `/tmp/... -> /home/u/...` and a test could never tell the
   * EXDEV bug from the fix (plan 077).
   */
  createSiblingTempDir(target: string, prefix: string): string {
    const parent = target.replace(/\/[^/]*$/, '') || '/';
    const dir = `${parent}/.${target.split('/').pop() ?? 'x'}.${prefix}${this.tempCounter++}`;
    this.siblingTempDirs.push(dir);
    this.dirs.add(dir);
    return dir;
  }

  rename(from: string, to: string): void {
    this.renames.push(`${from}->${to}`);
    // POSIX `rename(2)` returns EXDEV across a filesystem boundary. Modelled
    // here because the fake NOT modelling it is what let a guaranteed-fatal
    // Linux bug ship: staging in `/tmp` and publishing into `$HOME` can never
    // succeed where `/tmp` is tmpfs, and every unit test passed anyway (plan
    // 077). A fake permissive where the kernel is strict cannot fail on the one
    // thing that matters. `/` + first segment stands in for the device.
    if (device(from) !== device(to)) {
      throw new Error(`EXDEV: cross-device link not permitted, rename '${from}' -> '${to}'`);
    }
    const bytes = this.files.get(from);
    if (bytes === undefined) throw new Error(`FakeCollectorFs: rename source missing: ${from}`);
    this.files.set(to, bytes);
    this.files.delete(from);
  }

  deleteFile(path: string): void {
    this.deletes.push(path);
    this.files.delete(path);
  }

  removeDir(path: string): void {
    this.removedDirs.push(path);
    const prefix = path.endsWith('/') ? path : `${path}/`;
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(prefix)) this.files.delete(key);
    }
    for (const key of [...this.dirs]) {
      if (key === path || key.startsWith(prefix)) this.dirs.delete(key);
    }
  }

  /** Every path currently holding bytes — the "nothing was left behind" assertion. */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}

/** A scripted HTTP GET, keyed by URL. Unscripted URLs answer as a network error. */
export class FakeDownload implements DownloadPort {
  readonly calls: Array<{ url: string; timeoutMs: number }> = [];

  constructor(private readonly scripts: Record<string, DownloadOutcome> = {}) {}

  async get(url: string, opts: { timeoutMs: number }): Promise<DownloadOutcome> {
    this.calls.push({ url, timeoutMs: opts.timeoutMs });
    return (
      this.scripts[url] ?? {
        ok: false,
        kind: 'network',
        message: `FakeDownload: no script for ${url}`,
      }
    );
  }
}

/** A 200 response carrying exactly these bytes. */
export function ok200(bytes: Uint8Array, over: Partial<DownloadOutcome> = {}): DownloadOutcome {
  return {
    ok: true,
    status: 200,
    url: 'https://github.com/git-ai-project/git-ai/releases/download/x/y',
    redirects: 0,
    bytes,
    ...(over as object),
  } as DownloadOutcome;
}

export class FakeExecutableBit implements ExecutableBitPort {
  readonly calls: string[] = [];
  constructor(private readonly result = true) {}

  setExecutable(path: string): boolean {
    this.calls.push(path);
    return this.result;
  }
}

/**
 * An exec fake that can answer the SAME command differently over time.
 *
 * The collector reads the global trace2 config twice around one
 * `install-hooks` — once as a guard, once as verification — and the whole point
 * of the second read is that the answer is expected to have CHANGED. A fake that
 * can only give one answer per command line can therefore only model a machine
 * where install-hooks did nothing, which is exactly the failure the verification
 * exists to catch and exactly the wrong default for a happy-path fixture.
 *
 * Scripts may be a single result or a list consumed in order; the last entry
 * repeats once the list is exhausted, so "and it stays that way" needs no
 * padding.
 */
export class FakeSequencedExec implements ExecPort {
  readonly calls: Array<{ command: string; args: string[]; cwd: string; timeoutMs?: number }> = [];
  private readonly queues = new Map<string, ExecScript[]>();

  constructor(private readonly scripts: Record<string, ExecScript | ExecScript[]> = {}) {}

  async run(command: string, args: string[], opts: ExecOptions): Promise<ExecResult> {
    this.calls.push({
      command,
      args,
      cwd: opts.cwd,
      ...(opts.timeoutMs !== undefined && { timeoutMs: opts.timeoutMs }),
    });
    const key = [command, ...args].join(' ');
    const scripted = this.scripts[key] ?? this.scripts[command];
    let script: ExecScript = { code: 0 };
    if (Array.isArray(scripted)) {
      let queue = this.queues.get(key);
      if (queue === undefined) {
        queue = [...scripted];
        this.queues.set(key, queue);
      }
      script = (queue.length > 1 ? queue.shift() : queue[0]) ?? { code: 0 };
    } else if (scripted !== undefined) {
      script = scripted;
    }
    return {
      code: script.code,
      stdout: script.stdout ?? '',
      stderr: script.stderr ?? '',
      ok: script.code === 0,
    };
  }
}

/**
 * A scripted `lstat` classification. Anything not seeded reads `absent`, which
 * is the state of a machine that has never installed git-ai's skills — so a
 * fixture only has to declare the paths whose presence is the point.
 */
export class FakePathKind implements PathKindPort {
  readonly calls: string[] = [];

  constructor(private readonly kinds: Record<string, PathKind> = {}) {}

  kindNoFollow(path: string): PathKind {
    this.calls.push(path);
    return this.kinds[path] ?? 'absent';
  }
}

/**
 * Stand-in for a filesystem id: the first path segment. `/tmp/...` and
 * `/home/...` are different devices, which is the real-world case that matters.
 */
function device(path: string): string {
  return `/${path.replace(/^\/+/, '').split('/')[0] ?? ''}`;
}
