import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Event } from '../../../src/services/telemetry/events.js';
import { serializeEvent } from '../../../src/services/telemetry/segment.js';

/**
 * Plan 047 Phase 3 · T001 — the publication-boundary privacy scan (AC-11 · Constitution
 * P12 HARD RAIL). This ships REGARDLESS of any git-ref deferral: it is the gate that a
 * later phase can never drop.
 *
 * Three guarantees, each asserted NON-VACUOUSLY:
 *
 *  1. No home-path leak in any committed **data** artifact (the saved `*.session.json`
 *     / `*.report.json` / `*.session.html` leaves + the central-layout fixtures). A data
 *     leaf never legitimately contains an absolute home path, so ANY `/Users/…` or
 *     `C:\Users\…` is a leak — planting `/Users/alice/…` into the scanned set flips it RED.
 *  2. No **real machine** path leaks into ANY tracked 047 artifact, docs included — a
 *     prose doc may legitimately use a SYNTHETIC example (`/Users/alex`), so the doc scan
 *     matches this host's actual `os.homedir()`; planting it flips RED.
 *  3. The git-ref READ/export/render path never reads identity (`user.email`) — it issues
 *     only `for-each-ref` + `cat-file`. The pre-existing 034 write-path attribution read
 *     (`exec-git-write.ts` reads `git config user.name`/`user.email` by design) is
 *     explicitly CARVED OUT so a repo-wide grep can never silently weaken this rail.
 *
 * Plus: `git check-ignore` confirms no committed artifact is caught by the `*.log`
 * gitignore trap (KF-07) — while a real `*.log` name still WOULD be trapped.
 */

/** Repo root — resolved from git, never from an env var (may be empty in a test shell). */
const REPO_ROOT = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).stdout.trim();

/**
 * A budget sized for REAL git, not for pure computation — see the `beforeAll`
 * below for the measurement. Set once for the file: the property is true of every
 * case that touches the owning scan, and a per-case number invites the next author
 * to guess. The assertions themselves are milliseconds; this covers the children.
 */
vi.setConfig({ testTimeout: 20_000, hookTimeout: 30_000 });

const CLI_SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

interface Artifact {
  /** Repo-relative path. */
  path: string;
  content: string;
}

interface GitOperationCounts {
  inventory: number;
  checkIgnore: number;
}

interface PublicationGitOperations {
  /** The repo this operations object scans — the live repo, or a bounded fixture. */
  readonly root: string;
  readonly counts: GitOperationCounts;
  /** Zero the counters ONLY — the inventory cache is untouched. */
  resetCounts(): void;
  /**
   * Drop the inventory cache ONLY — the counters keep their history. These are two
   * seams, not one, on purpose: a control that clears both at once can never
   * observe a SECOND child, because the count it reads afterwards started at zero.
   */
  invalidateInventoryCache(): void;
  committableFiles(): string[];
  ignoredPaths(paths: readonly string[]): Set<string>;
}

function createPublicationGitOperations(root: string = REPO_ROOT): PublicationGitOperations {
  const counts: GitOperationCounts = { inventory: 0, checkIgnore: 0 };
  let cachedCommittableFiles: readonly string[] | undefined;

  return {
    root,
    counts,
    resetCounts() {
      counts.inventory = 0;
      counts.checkIgnore = 0;
    },
    invalidateInventoryCache() {
      cachedCommittableFiles = undefined;
    },
    committableFiles() {
      if (cachedCommittableFiles === undefined) {
        counts.inventory += 1;
        const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        });
        cachedCommittableFiles = Object.freeze(
          result.stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        );
      }
      return [...cachedCommittableFiles];
    },
    ignoredPaths(paths) {
      counts.checkIgnore += 1;
      const inputPaths = new Set(paths);
      if (inputPaths.size !== paths.length) {
        throw new Error('check-ignore input paths must be unique');
      }

      const result = spawnSync('git', ['check-ignore', '-z', '--stdin'], {
        cwd: root,
        encoding: 'utf8',
        input: `${paths.join('\0')}\0`,
        maxBuffer: 64 * 1024 * 1024,
      });
      if (result.error !== undefined) throw result.error;
      if (result.signal !== null) {
        throw new Error(`check-ignore terminated by signal ${result.signal}`);
      }
      if (result.status !== 0) {
        throw new Error(`check-ignore exited with status ${String(result.status)}`);
      }
      if (result.stdout.length === 0 || !result.stdout.endsWith('\0')) {
        throw new Error('check-ignore returned malformed NUL framing');
      }

      const ignored = new Set<string>();
      for (const path of result.stdout.slice(0, -1).split('\0')) {
        if (path.length === 0) throw new Error('check-ignore returned an empty path');
        if (!inputPaths.has(path))
          throw new Error(`check-ignore returned unexpected path: ${path}`);
        if (ignored.has(path)) throw new Error(`check-ignore returned duplicate path: ${path}`);
        ignored.add(path);
      }
      return ignored;
    },
  };
}

const gitOperations = createPublicationGitOperations();

/**
 * The owning scan is paid ONCE, here, as setup — not lazily inside whichever
 * assertion happens to run first.
 *
 * `git ls-files -co --exclude-standard` stats the entire working tree, and this
 * file blocks on it with `spawnSync`. Sixteen other suites in this repo spawn real
 * subprocesses (a git daemon, hook integrations, real `init`/`commit` fixtures),
 * so in a full run that child competes with them for the same cores. Measured on
 * this box: p50 73ms, MAX 1202ms for the spawn alone, and the first assertion —
 * 138ms uncontended — was observed taking 6339ms and failing vitest's 5s default.
 * Its subject was never in doubt; the budget was. That is the flake the reviewer
 * hit, and it is a wallclock allowance problem, not an assertion problem.
 *
 * Warming it in a hook makes every `it` below pure computation over an in-memory
 * list, so the assertions stop being a function of machine weather. The budget is
 * then declared honestly for the one irreducible real-git call, the same way
 * `exec-remote-telemetry-git.int.test.ts` does — a privacy HARD RAIL must scan the
 * whole committable set, so the work itself cannot be made smaller without
 * narrowing the rail, which would trade a flake for a silent hole.
 */
beforeAll(() => {
  gitOperations.committableFiles();
});

/** Every file git would consider committable (tracked OR untracked-not-ignored). */
function committableFiles(operations: PublicationGitOperations = gitOperations): string[] {
  return operations.committableFiles();
}

function read(rel: string, root: string = REPO_ROOT): Artifact {
  return { path: rel, content: readFileSync(join(root, rel), 'utf8') };
}

/** The committed 047 DATA artifacts — saved leaves + the central-layout fixtures. */
function dataArtifacts(operations: PublicationGitOperations = gitOperations): Artifact[] {
  return committableFiles(operations)
    .filter(
      (p) =>
        /\.session\.json$/.test(p) ||
        /\.report\.json$/.test(p) ||
        /\.session\.html$/.test(p) ||
        p.startsWith('harness/cli/test/services/telemetry/fixtures/central/'),
    )
    .map((p) => read(p, operations.root));
}

/** Every tracked 047 artifact incl. docs + the render surface (the widest publish set). */
function all047Artifacts(operations: PublicationGitOperations = gitOperations): Artifact[] {
  return committableFiles(operations)
    .filter(
      (p) =>
        /^docs\/how\/telemetry.*\.md$/.test(p) ||
        p.startsWith('harness/cli/test/services/telemetry/fixtures/central/') ||
        p.startsWith('harness/cli/src/services/telemetry/render/') ||
        /\.session\.json$/.test(p) ||
        /\.report\.json$/.test(p) ||
        /\.session\.html$/.test(p),
    )
    .map((p) => read(p, operations.root));
}

/** ANY absolute home path — never legitimate inside a committed DATA leaf. */
function scanHomePaths(artifacts: Artifact[]): { path: string; hit: string }[] {
  const re = /(?:\/Users\/|\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\|\\Users\\)/g;
  const hits: { path: string; hit: string }[] = [];
  for (const a of artifacts)
    for (const m of a.content.matchAll(re)) hits.push({ path: a.path, hit: m[0] });
  return hits;
}

/** THIS host's real home dir — a leak even in prose (a synthetic `/Users/alex` is not). */
function scanRealHome(artifacts: Artifact[]): { path: string; hit: string }[] {
  const home = homedir();
  const hits: { path: string; hit: string }[] = [];
  for (const a of artifacts) if (a.content.includes(home)) hits.push({ path: a.path, hit: home });
  return hits;
}

describe('publication boundary — no home-path leak in committed DATA artifacts (T001, AC-11)', () => {
  it('the 047 data artifact set is non-empty (the scan is not vacuous)', () => {
    expect(dataArtifacts().length).toBeGreaterThan(0);
  });

  it('no `/Users/…` or `C:\\Users\\…` in any saved leaf / central fixture', () => {
    expect(scanHomePaths(dataArtifacts())).toEqual([]);
  });

  it('NON-VACUITY: planting `/Users/alice/…` into the scanned set flips it RED', () => {
    const planted: Artifact = {
      path: 'planted.session.json',
      content: '{"identity":{"note":"/Users/alice/secret/x"}}',
    };
    const hits = scanHomePaths([...dataArtifacts(), planted]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.path === 'planted.session.json')).toBe(true);
  });
});

describe('publication boundary — no REAL machine path in ANY tracked 047 artifact incl. docs (T001)', () => {
  it('this host’s home dir leaks into no doc, fixture, or render artifact', () => {
    expect(scanRealHome(all047Artifacts())).toEqual([]);
  });

  it('NON-VACUITY: planting this host’s real home path flips it RED', () => {
    const planted: Artifact = { path: 'planted.md', content: `see ${homedir()}/leak` };
    expect(scanRealHome([...all047Artifacts(), planted]).length).toBeGreaterThan(0);
  });
});

describe('publication boundary — the `*.log` gitignore trap is dodged (T001, KF-07)', () => {
  const ignoredControl = 'docs/how/telemetry-reports.log';
  let artifactPaths: string[];
  let ignoredPaths: Set<string>;

  beforeAll(() => {
    artifactPaths = all047Artifacts().map((artifact) => artifact.path);
    ignoredPaths = gitOperations.ignoredPaths([...artifactPaths, ignoredControl]);
  });

  it('no committed 047 artifact is caught by the `*.log` rule', () => {
    expect(artifactPaths.filter((path) => ignoredPaths.has(path))).toEqual([]);
  });

  it('CONTROL: a `*.log` name IS trapped (proving the check is live)', () => {
    // A hypothetical mis-named report leaf would vanish — this is the trap the
    // docs/report filenames deliberately dodge.
    expect(ignoredPaths.has(ignoredControl)).toBe(true);
  });
});

/**
 * PHASE3 fix round 1, finding 2 — the child-count property, measured where its
 * cost is bounded.
 *
 * What this asserts is a property of the SCAN, not of this repo: an owning scan
 * spends exactly one inventory child and one check-ignore child no matter how
 * often the artifact sets are asked for. It used to prove that by running a
 * second, uncached, whole-repo `git ls-files -co --exclude-standard` — and `-co`
 * stats the entire working tree. Measured on this box during a full-suite run,
 * that one spawn has a p50 of 73ms and a MAX of 1202ms: a 16x tail set by
 * whole-machine contention, most of it from this repo's own real-git suites,
 * which the test blocks on with `spawnSync` and cannot influence. Its own work is
 * ~123ms; the rest of the 5s budget was weather. That is why it passed alone and
 * timed out in the full suite.
 *
 * So the fixture is a disposable repo of a handful of files. Real git, real
 * subprocesses, the same factory and the same cache — only the tree is bounded,
 * which is the one input that made the wallclock a function of the machine. The
 * repo-wide claims this test also happened to make are not lost: its two siblings
 * above assert them against the live repo through the shared scan.
 */
describe('publication boundary — an owning scan spends exactly two git children (T001)', () => {
  const ignoredControl = 'docs/how/telemetry-reports.log';
  let fixtureRoot: string;

  /** A disposable repo with both halves of `-co`: one tracked, one untracked-not-ignored. */
  const createFixtureRepo = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'harness-pubscan-'));
    const write = (rel: string, content: string): void => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    };
    const git = (args: string[]): void => {
      const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${r.stderr}`);
    };
    write('.gitignore', '*.log\n');
    write('docs/how/telemetry-reports.md', 'a doc\n');
    write('harness/cli/src/services/telemetry/render/r.ts', 'export const r = 1;\n');
    write('a.session.json', '{}\n');
    write('b.report.json', '{}\n');
    write(ignoredControl, 'trapped\n');
    git(['init', '-q', '-b', 'main']);
    git(['add', '-A']);
    // `-co` must see BOTH halves: `a.session.json` stays untracked-not-ignored, so
    // a scan that only listed tracked files would come back short.
    git(['reset', '-q', '--', 'a.session.json']);
    return root;
  };

  beforeAll(() => {
    fixtureRoot = createFixtureRepo();
  });

  afterAll(() => {
    if (fixtureRoot !== undefined) rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('uses exactly one inventory child and one check-ignore child for an owning scan', () => {
    const operations = createPublicationGitOperations(fixtureRoot);
    operations.resetCounts();

    const firstDataArtifacts = dataArtifacts(operations);
    const secondDataArtifacts = dataArtifacts(operations);
    const firstAll047Artifacts = all047Artifacts(operations);
    const secondAll047Artifacts = all047Artifacts(operations);
    expect(firstDataArtifacts).toEqual(secondDataArtifacts);
    expect(firstAll047Artifacts).toEqual(secondAll047Artifacts);

    const ownedArtifactPaths = firstAll047Artifacts.map((artifact) => artifact.path);
    // NON-VACUITY: a fixture that matched no filter would make every assertion
    // below true by emptiness — the same trap the sibling scans guard against.
    expect(ownedArtifactPaths).toEqual([
      'a.session.json',
      'b.report.json',
      'docs/how/telemetry-reports.md',
      'harness/cli/src/services/telemetry/render/r.ts',
    ]);
    const ownedIgnoredPaths = operations.ignoredPaths([...ownedArtifactPaths, ignoredControl]);
    expect(ownedArtifactPaths.filter((path) => ownedIgnoredPaths.has(path))).toEqual([]);
    expect(ownedIgnoredPaths.has(ignoredControl)).toBe(true);
    expect(operations.counts).toEqual({ inventory: 1, checkIgnore: 1 });
  });

  it('CONTROL: dropping the cache spends a SECOND inventory child — the count is live', () => {
    // Its OWN repo: this case ADDS a file mid-test to prove the second child really
    // re-read the tree, and a mutation its sibling above could see would make that
    // sibling depend on execution order.
    const controlRoot = createFixtureRepo();
    try {
      const operations = createPublicationGitOperations(controlRoot);
      operations.resetCounts();

      const first = dataArtifacts(operations).map((artifact) => artifact.path);
      expect([...first].sort()).toEqual(['a.session.json', 'b.report.json']);
      expect(operations.counts.inventory).toBe(1);

      // Half one — a repeat WITHOUT invalidation must be absorbed by the cache.
      // A cache-free implementation spends a child here and reads 2.
      dataArtifacts(operations);
      expect(operations.counts.inventory).toBe(1);

      // Half two — drop the CACHE ONLY. The counter keeps its history, so a real
      // spawn has to show up as a SECOND child. An implementation that never
      // spawned, or whose counter was wired to a constant, still reads 1 here.
      writeFileSync(join(controlRoot, 'c.session.json'), '{}\n');
      operations.invalidateInventoryCache();
      const second = dataArtifacts(operations).map((artifact) => artifact.path);
      expect(operations.counts.inventory).toBe(2);
      // ...and that second child re-read the TREE — otherwise the count is just a
      // number being bumped beside a stale list.
      expect([...second].sort()).toEqual(['a.session.json', 'b.report.json', 'c.session.json']);
    } finally {
      rmSync(controlRoot, { recursive: true, force: true });
    }
  });
});

describe('publication boundary — the 047 read/export/render path reads no identity (T001)', () => {
  const readAdapter = readFileSync(join(CLI_SRC, 'adapters/git/exec-git-read.ts'), 'utf8');
  const writeAdapter = readFileSync(join(CLI_SRC, 'adapters/git/exec-git-write.ts'), 'utf8');

  it('ExecGitRead invokes ONLY `for-each-ref` + `cat-file` (no `config`, no fetch/write)', () => {
    expect(readAdapter).toContain("'for-each-ref'");
    expect(readAdapter).toContain("'cat-file'");
    for (const forbidden of ["'config'", "'fetch'", "'checkout'", "'update-ref'", "'push'"]) {
      expect(readAdapter).not.toContain(forbidden);
    }
    expect(readAdapter).not.toContain('user.email');
  });

  it('no 047 export/report/render/read code reads `user.email`', () => {
    const roots = [
      join(CLI_SRC, 'services/telemetry'),
      join(CLI_SRC, 'acts/telemetry.ts'),
      join(CLI_SRC, 'adapters/git/exec-git-read.ts'),
      join(CLI_SRC, 'adapters/git/git-read-port.ts'),
      join(CLI_SRC, 'adapters/git/fake-git-read.ts'),
    ];
    const files: string[] = [];
    const walk = (p: string): void => {
      if (statSync(p).isDirectory()) {
        for (const name of readdirSync(p)) walk(join(p, name));
      } else if (p.endsWith('.ts')) {
        files.push(p);
      }
    };
    for (const r of roots) walk(r);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(readFileSync(f, 'utf8'), `${f} must not read user.email`).not.toContain('user.email');
    }
  });

  it('CARVE-OUT: the 034 write-path attribution read (exec-git-write.ts) is the SOLE user.email read — by design', () => {
    // Documented boundary: the write path reads `git config user.name`/`user.email`
    // to attribute the telemetry commit (034). It is NOT a 047 read-path leak — asserting
    // it here pins the carve-out so a repo-wide "remove all user.email" edit can't
    // silently pass while gutting attribution.
    expect(writeAdapter).toContain('user.email');
    expect(writeAdapter).toContain("'config'");
  });
});

describe('P063 T008 — typed usage publication stays counts-only', () => {
  const numericUsage = {
    t: '2026-07-20T14:00:00Z',
    kind: 'usage',
    observation_kind: 'final_shutdown',
    in: 10,
    out: 20,
    cache_read: 30,
    cache_create: 40,
    nano_aiu: 50,
  };

  it('publishes only the closed observation enum and present numeric buckets', () => {
    expect(serializeEvent(numericUsage as unknown as Event)).toEqual(numericUsage);
  });

  it.each([
    ['content', 'PRIVATE_FREE_TEXT'],
    ['path', '/Users/private/repository'],
    ['identity', 'person@example.test'],
    ['session_id', 'PRIVATE_SESSION_ID'],
    ['model_footer', 'PRIVATE_MODEL_FOOTER'],
  ] as const)('drops planted %s from the serialized usage event', (field, planted) => {
    const tainted = {
      ...numericUsage,
      [field]: planted,
      payload: { [field]: planted },
    } as unknown as Event;
    const serialized = serializeEvent(tainted);

    expect(serialized).toEqual(numericUsage);
    expect(JSON.stringify(serialized)).not.toContain(planted);
  });
});
