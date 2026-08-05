import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * tk-7164 / dw-0007 — the baked-docs drift gate, proven BOTH ways.
 *
 * `check:dd-docs` already ran green on every commit, which proves exactly one
 * half: that the committed module matches its sources today. The half nobody had
 * checked is whether the gate would NOTICE if it stopped — and a gate that has
 * only ever been run against good input has been demonstrated, not tested. If it
 * silently passed, the CLI would ship stale documentation to agents that cannot
 * read the repo, which is precisely the failure baking the docs was meant to
 * remove.
 *
 * The proof runs the REAL generator, in a hermetic copy of the tree it expects.
 * Nothing here touches the working repository: the orchestrator commits into this
 * worktree concurrently, and a test that perturbed the committed module to see
 * the gate fire could be caught mid-perturbation by a real commit.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));
const DOCS_DIR = 'harness/cli/src/services/dd/docs';

let root = '';

afterEach(() => {
  if (root.length > 0) rmSync(root, { recursive: true, force: true });
  root = '';
});

/**
 * A throwaway tree the generator can run in. It derives its repo root from its
 * OWN location, so reproducing the two paths it reads is enough — and doing it
 * this way means the thing under test is the shipped generator rather than a
 * re-description of it.
 */
function stageGenerator(): string {
  root = mkdtempSync(join(tmpdir(), 'dd-docs-gate-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(join(REPO_ROOT, 'scripts/gen-dd-docs.mjs'), join(root, 'scripts/gen-dd-docs.mjs'));
  cpSync(join(REPO_ROOT, DOCS_DIR), join(root, DOCS_DIR), { recursive: true });
  // The gate prints `git diff` when it finds drift. Without a repository that
  // call fails and dumps git's entire usage text into the test log, burying the
  // one line that matters.
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' });
  return root;
}

async function runGate(stage: string): Promise<{ drifted: boolean }> {
  // `process.exitCode` is GLOBAL, and the generator sets it to 1 on drift. Left
  // alone, proving the gate fires would make vitest itself exit non-zero — a
  // green suite reported as a failed run.
  const before = process.exitCode;
  try {
    const module = (await import(
      `${pathToFileURL(join(stage, 'scripts/gen-dd-docs.mjs')).href}?v=${Math.random()}`
    )) as { generateDdDocs: (options: { check: boolean }) => { drifted: boolean } };
    return module.generateDdDocs({ check: true });
  } finally {
    process.exitCode = before;
  }
}

const bakedPath = (stage: string): string => join(stage, DOCS_DIR, 'docs-content.ts');

describe('dw-0007 — the baked dd-docs drift gate is green both ways', () => {
  it('reports NO drift when the committed module matches its sources', async () => {
    const stage = stageGenerator();
    // Normalise once in this environment first: the shipped module is
    // biome-formatted and the staged tree has no node_modules, so the baseline
    // has to be whatever THIS generator produces, or the comparison would report
    // a formatting difference as documentation drift.
    await runGate(stage);

    const result = await runGate(stage);

    expect(result.drifted).toBe(false);
  });

  it('FIRES when the baked module is stale — an edited source is not silently ignored', async () => {
    const stage = stageGenerator();
    await runGate(stage);
    // The realistic mistake: someone improves a source chapter and forgets to
    // regenerate. The committed module still holds the OLD prose.
    const source = join(stage, DOCS_DIR, 'content/dd-overview.md');
    writeFileSync(source, `${readFileSync(source, 'utf8')}\n\nA newly added paragraph.\n`, 'utf8');

    const result = await runGate(stage);

    expect(result.drifted).toBe(true);
  });

  it('FIRES when the baked module is hand-edited away from its sources', async () => {
    const stage = stageGenerator();
    await runGate(stage);
    // The other direction, and the reason the header says DO NOT EDIT: someone
    // patches the generated artifact directly, so the CLI ships prose that exists
    // in no source file at all.
    const baked = bakedPath(stage);
    writeFileSync(
      baked,
      readFileSync(baked, 'utf8').replace('Deterministic documents', 'Deterministic docs'),
      'utf8',
    );

    const result = await runGate(stage);

    expect(result.drifted).toBe(true);
  });

  it('runs clean against the REAL repository — the gate the composite check runs', () => {
    // The end-to-end twin: the actual script, the actual tree, no fixture. It is
    // the assertion `just checks` makes on every commit, held here too so a
    // failure is attributable to the docs rather than to a whole gate run.
    const result = execFileSync(process.execPath, ['scripts/check-dd-docs.mjs'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result).toBeDefined();
  });
});
