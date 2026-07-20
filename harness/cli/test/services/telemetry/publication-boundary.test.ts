import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

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
  readonly counts: GitOperationCounts;
  resetCounts(): void;
  committableFiles(): string[];
  ignoredPaths(paths: readonly string[]): Set<string>;
}

function createPublicationGitOperations(): PublicationGitOperations {
  const counts: GitOperationCounts = { inventory: 0, checkIgnore: 0 };
  let cachedCommittableFiles: readonly string[] | undefined;

  return {
    counts,
    resetCounts() {
      counts.inventory = 0;
      counts.checkIgnore = 0;
      cachedCommittableFiles = undefined;
    },
    committableFiles() {
      if (cachedCommittableFiles === undefined) {
        counts.inventory += 1;
        const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard'], {
          cwd: REPO_ROOT,
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
        cwd: REPO_ROOT,
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

/** Every file git would consider committable (tracked OR untracked-not-ignored). */
function committableFiles(operations: PublicationGitOperations = gitOperations): string[] {
  return operations.committableFiles();
}

function read(rel: string): Artifact {
  return { path: rel, content: readFileSync(join(REPO_ROOT, rel), 'utf8') };
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
    .map(read);
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
    .map(read);
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

  it('uses exactly one inventory child and one check-ignore child for an owning scan', () => {
    const operations = createPublicationGitOperations();
    operations.resetCounts();

    const firstDataArtifacts = dataArtifacts(operations);
    const secondDataArtifacts = dataArtifacts(operations);
    const firstAll047Artifacts = all047Artifacts(operations);
    const secondAll047Artifacts = all047Artifacts(operations);
    expect(firstDataArtifacts).toEqual(secondDataArtifacts);
    expect(firstAll047Artifacts).toEqual(secondAll047Artifacts);

    const ownedArtifactPaths = firstAll047Artifacts.map((artifact) => artifact.path);
    const ownedIgnoredPaths = operations.ignoredPaths([...ownedArtifactPaths, ignoredControl]);
    expect(ownedArtifactPaths.filter((path) => ownedIgnoredPaths.has(path))).toEqual([]);
    expect(ownedIgnoredPaths.has(ignoredControl)).toBe(true);
    expect(operations.counts).toEqual({ inventory: 1, checkIgnore: 1 });
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
