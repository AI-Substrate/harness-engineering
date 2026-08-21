import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import {
  type AgentSpec,
  eventKeys,
  findAgent,
  resolveConfigFiles,
} from '../../../src/services/hooks/agent-matrix.js';
import { installStrategyA } from '../../../src/services/hooks/install-strategy-a.js';
import { alphabeticalResortWriter, readFixture } from '../../support/config-fixture.js';

/**
 * IDEMPOTENCY — TWO ASSERTIONS, NOT ONE (plan 082 tk-0009).
 *
 * Hashing the bytes before and after the SECOND run proves only that **run2 equals
 * run1**. It says nothing about run1 versus the ORIGINAL — and that gap is not
 * theoretical: a writer that alphabetically re-sorts the whole config on the FIRST
 * install (git-ai's actual serde_json BTreeMap behaviour) and then re-sorts
 * identically on the second produces byte-identical run1 and run2 and passes a naive
 * idempotency test **green, with the customer's config already rearranged**.
 *
 * So idempotency is asserted run1-vs-run2, and order preservation is asserted
 * run1-vs-GOLDEN. Two properties, two assertions.
 */

let home: string;
const fs = new NodeFs();
const env = () => undefined;
const BINARY = '"/usr/local/bin/harness"';

const spec = (agent: string): AgentSpec => {
  const found = findAgent(agent);
  if (found === undefined) throw new Error(`${agent} missing from the matrix`);
  return found;
};

const readAll = (s: AgentSpec): string[] =>
  resolveConfigFiles(s, home, env).map((path) => readFileSync(path, 'utf8'));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'harness-idempotency-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('run2 == run1 on BYTES, over every touched config (dw-0020)', () => {
  it.each([
    'cursor',
    'claude-code',
    'gemini',
    'droid',
    'firebender',
    'github-copilot',
    'windsurf',
  ])('%s is byte-identical after a second install', (agent) => {
    const s = spec(agent);
    installStrategyA(fs, s, home, env, BINARY);
    const afterFirst = readAll(s);

    installStrategyA(fs, s, home, env, BINARY);
    expect(readAll(s)).toEqual(afterFirst);
  });

  it('windsurf is checked on BOTH files — the denominator is every touched config', () => {
    /*
    Test Doc:
    - Why: dw-0020 says "EVERY touched config including both windsurf paths". An
      idempotency check that read only the first file would pass while the second
      accumulated a duplicate entry on every run.
    - Contract: two files compared, and both actually exist.
    */
    const s = spec('windsurf');
    installStrategyA(fs, s, home, env, BINARY);
    const afterFirst = readAll(s);
    expect(afterFirst).toHaveLength(2);

    installStrategyA(fs, s, home, env, BINARY);
    const afterSecond = readAll(s);
    expect(afterSecond).toEqual(afterFirst);
    // And no entry was duplicated in either file. The count is DERIVED from the
    // matrix row, not written down: windsurf has five cascade events, not a
    // ToolUse pair (plan 082 F005), and a literal here would need editing every
    // time a row's event set changed — which is how an assertion quietly stops
    // matching the thing it guards.
    for (const text of afterSecond) {
      expect(text.split('ai-substrate-harness-hook-v1').length - 1).toBe(eventKeys(s).length);
    }
  });

  it('THREE runs, not two — a duplicate that appears only on run 3 would hide', () => {
    const s = spec('cursor');
    installStrategyA(fs, s, home, env, BINARY);
    const afterFirst = readAll(s);
    installStrategyA(fs, s, home, env, BINARY);
    installStrategyA(fs, s, home, env, BINARY);
    expect(readAll(s)).toEqual(afterFirst);
  });
});

describe('the git-ai-entries-already-present case (dw-0022)', () => {
  const seed = (): string => {
    const path = join(home, '.cursor/hooks.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(path, readFixture('cursor.input.json'));
    return path;
  };

  it('is idempotent AND leaves the pre-existing entries in place', () => {
    /*
    Test Doc:
    - Why: dw-0022. A config that already holds git-ai's entries is where a naive
      merge reorders — an empty config has nothing to rearrange, so the interesting
      case is the populated one.
    - Contract: run2 == run1, and git-ai's compound entry survives both runs.
    */
    const path = seed();
    installStrategyA(fs, spec('cursor'), home, env, BINARY);
    const afterFirst = readFileSync(path, 'utf8');

    installStrategyA(fs, spec('cursor'), home, env, BINARY);
    expect(readFileSync(path, 'utf8')).toBe(afterFirst);
    expect(afterFirst).toContain('git-ai checkpoint cursor --hook-input stdin');
  });

  it('first run matches the GOLDEN — order and comments preserved (dw-0021)', () => {
    const path = seed();
    installStrategyA(fs, spec('cursor'), home, env, BINARY);
    expect(readFileSync(path, 'utf8')).toBe(readFixture('cursor.golden.json'));
  });
});

describe('WHY IDEMPOTENCY ALONE IS NOT ENOUGH — the naive test passing while the bug is present', () => {
  it('a RE-SORTING writer is PERFECTLY IDEMPOTENT and still wrong (dw-0021)', () => {
    /*
    Test Doc:
    - Why: this is the whole argument for two assertions rather than one, made
      executable instead of asserted in a comment. git-ai's serde_json BTreeMap
      re-sorts the whole document on the FIRST install and identically on the
      second. run1 == run2 exactly, so a naive idempotency check is green — with the
      customer's config already rearranged.
    - Contract: run1 == run2 (idempotent) AND run1 != golden (order destroyed).
      Asserting BOTH in one row is what shows the two properties are independent.
    - Quality Contribution: kept as an exhibit, like the set-vs-unset row. The
      normal fate of a demonstration like this is deletion as redundant, and the
      reason the second assertion exists leaves with it.
    */
    const path = join(home, '.cursor/hooks.json');
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(path, readFixture('cursor.input.json'));

    const cursor = spec('cursor');
    const run1 = alphabeticalResortWriter(readFileSync(path, 'utf8'), {
      agent: 'cursor',
      relativePath: '.cursor/hooks.json',
      inputFile: 'cursor.input.json',
      goldenFile: 'cursor.golden.json',
    });
    writeFileSync(path, run1);
    // The second run finds our entry already present, so it re-sorts and stops.
    const run2 = run1;

    // IDEMPOTENT — the naive check passes.
    expect(run2).toBe(run1);
    // AND WRONG — the order is destroyed, which only the golden can see.
    expect(run1).not.toBe(readFixture('cursor.golden.json'));
    expect(run1.indexOf('postToolUse')).toBeLessThan(run1.indexOf('preToolUse'));

    // Our real writer, on the same input, is idempotent AND matches the golden.
    writeFileSync(path, readFixture('cursor.input.json'));
    installStrategyA(fs, cursor, home, env, BINARY);
    expect(readFileSync(path, 'utf8')).toBe(readFixture('cursor.golden.json'));
  });
});
