import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { findAgent } from '../../../src/services/hooks/agent-matrix.js';
import {
  embedBinaryPath,
  extractBinaryPath,
  looksLikeInstalledBinary,
  normaliseBinaryPath,
  quoteForShell,
} from '../../../src/services/hooks/binary-path.js';
import { installStrategyA } from '../../../src/services/hooks/install-strategy-a.js';

/**
 * THE BINARY PATH (plan 082 tk-0006).
 *
 * The space case is workshop sensor #7, and its failure is INVISIBLE until a user
 * whose home directory contains a space installs. That is precisely why it gets an
 * assertion rather than a rationale.
 */

let home: string;
const fs = new NodeFs();
const env = () => undefined;

const cursor = () => {
  const spec = findAgent('cursor');
  if (spec === undefined) throw new Error('cursor missing from the matrix');
  return spec;
};

beforeEach(() => {
  // A home directory WITH A SPACE IN IT, for every row in this file. Making it the
  // default rather than one special case means the property is exercised by the
  // ordinary install rows too, not only by the row named for it.
  home = mkdtempSync(join(tmpdir(), 'harness binary path '));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('a home directory containing a SPACE (dw-0015)', () => {
  it('installs a command whose binary path is quoted and recoverable', () => {
    /*
    Test Doc:
    - Why: seven of git-ai's installers interpolate an UNQUOTED path, so a space
      produces a hook the shell splits into two arguments. It runs fine for everyone
      whose username has no space, which is how it survives review.
    - Contract: the entry's command carries the quoted path, and extracting it
      returns the original absolute path INCLUDING the space.
    */
    expect(home).toContain(' ');
    const binaryDir = join(home, 'my tools');
    mkdirSync(binaryDir, { recursive: true });
    const binary = join(binaryDir, 'harness');

    const [outcome] = installStrategyA(fs, cursor(), home, env, embedBinaryPath(binary));
    const doc = JSON.parse(readFileSync(outcome.path, 'utf8')) as {
      hooks: Record<string, { command: string }[]>;
    };
    const command = doc.hooks.preToolUse[0].command;

    expect(command.startsWith(`"${binary}"`)).toBe(true);
    expect(extractBinaryPath(command)).toBe(binary);
  });

  it('REMOVING THE QUOTING makes the path unrecoverable — the refusal', () => {
    /*
    Test Doc:
    - Why: dw-0015 asks that removing the quoting turns the row red. Rather than
      mutate source and re-run, the unquoted form is constructed directly, so the
      failure is visible in one place and cannot be lost in a refactor.
    - Contract: unquoted, extraction returns only the fragment before the space —
      which is what would be stat'ed, and what would report a healthy install broken.
    */
    const binary = join(home, 'my tools', 'harness');
    const unquoted = `${binary} hooks fire cursor --phase pre`;

    expect(extractBinaryPath(unquoted)).not.toBe(binary);
    expect(extractBinaryPath(unquoted)).toBe(binary.split(' ')[0]);
  });
});

describe('the path round-trips OUT of the command string (dw-0016)', () => {
  it.each([
    ['a POSIX path', '/usr/local/bin/harness'],
    ['a path with a space', '/Users/ada lovelace/bin/harness'],
    ['a Windows path, normalised', 'C:/Program Files/harness/harness.exe'],
    ['a path with TWO spaces', '/opt/my tools/bin/my harness'],
    ['a path containing a quote', '/opt/we"ird/harness'],
  ])('%s survives embed -> extract', (_name, path) => {
    expect(extractBinaryPath(`${embedBinaryPath(path)} hooks fire cursor --phase pre`)).toBe(path);
  });

  it('the NAIVE extractor fails exactly where this one must not', () => {
    /*
    Test Doc:
    - Why: `split(' ')[0]` is what anyone writes first. It returns a LEADING QUOTE,
      so the stat fails and every healthy install reports as broken. Keeping the
      naive version here as an exhibit means the reason the real one is more
      complicated cannot be lost.
    - Contract: naive is wrong, ours is right, on the same input.
    */
    const command = `${embedBinaryPath('/Users/ada lovelace/bin/harness')} hooks fire cursor`;
    expect(command.split(' ')[0]).toBe('"/Users/ada');
    expect(extractBinaryPath(command)).toBe('/Users/ada lovelace/bin/harness');
  });

  it('refuses rather than guesses on an unterminated quote', () => {
    expect(extractBinaryPath('"/opt/harness hooks fire')).toBeNull();
    expect(extractBinaryPath('')).toBeNull();
  });
});

describe('the written path is ABSOLUTE and points at an install (dw-0017)', () => {
  it.each([
    ['a scratch path — the MEASURED hazard on this machine', '/Users/x/repo/scratch/probe.mjs'],
    ['a source tree', '/Users/x/repo/src/index.ts'],
    ['a build output', '/Users/x/repo/dist/index.js'],
    ['inside node_modules', '/Users/x/repo/node_modules/.bin/harness'],
    ['a worktree', '/Users/x/worktrees/branch/bin/harness'],
    ['a RELATIVE path', 'bin/harness'],
    ['a bare name', 'harness'],
  ])('REFUSES %s', (_name, path) => {
    /*
    Test Doc:
    - Why: dw-0017. The live Cursor hook on this machine points into untracked
      scratch/ — measured, not imagined. Such a hook works for one person and breaks
      silently when that tree is cleaned. Absolute is necessary and NOT sufficient:
      the scratch path is absolute too.
    - Contract: refused.
    */
    expect(looksLikeInstalledBinary(path)).toBe(false);
  });

  it.each([
    ['a POSIX install', '/usr/local/bin/harness'],
    ['a user install', '/Users/ada/.local/bin/harness'],
    ['a Windows install', 'C:/Program Files/harness/harness.exe'],
    ['an install path containing a space', '/Users/ada lovelace/.local/bin/harness'],
  ])('ACCEPTS %s', (_name, path) => {
    // The positive control: a predicate that refused everything would pass every
    // row above while making installation impossible.
    expect(looksLikeInstalledBinary(path)).toBe(true);
  });
});

describe('Windows normalisation — EXPECTED-UNVERIFIED, not measured (dw-0018)', () => {
  /*
  Test Doc:
  - Why: dw-0018. These rows run on macOS/Linux against SIMULATED win32 inputs. They
    prove the transformation, and they do NOT prove behaviour on a Windows host —
    the tickler already refuses to emit there, and the whole Windows story is
    EXPECTED-UNVERIFIED until the remote agent reports (tk-0010).
  - Contract: the transformation is correct on the input shapes Windows produces.
  - LIMIT: labelled in the describe name so a reader cannot take a green here as
    Windows coverage.
  */
  it.each([
    [
      'strips the \\\\?\\ extended-length prefix',
      '\\\\?\\C:\\tools\\harness.exe',
      'C:/tools/harness.exe',
    ],
    [
      'converts backslashes',
      'C:\\Program Files\\harness\\harness.exe',
      'C:/Program Files/harness/harness.exe',
    ],
    ['leaves a POSIX path alone', '/usr/local/bin/harness', '/usr/local/bin/harness'],
    [
      'handles a UNC-style prefix on a already-forward-slashed path',
      'C:/tools/harness.exe',
      'C:/tools/harness.exe',
    ],
  ])('%s', (_name, input, expected) => {
    expect(normaliseBinaryPath(input)).toBe(expected);
  });

  it('a normalised Windows path is still absolute, quoted and extractable', () => {
    const raw = '\\\\?\\C:\\Program Files\\harness\\harness.exe';
    const normalised = normaliseBinaryPath(raw);

    expect(looksLikeInstalledBinary(normalised)).toBe(true);
    expect(extractBinaryPath(`${embedBinaryPath(raw)} hooks fire cursor`)).toBe(normalised);
  });

  it('forward slashes are chosen over backslashes for a REASON, asserted', () => {
    // A backslash inside a double-quoted string is an escape character on POSIX
    // shells, so a backslash path would need escaping the moment it is quoted.
    // Normalising to forward slashes removes that class of bug entirely.
    expect(quoteForShell(normaliseBinaryPath('C:\\tools\\harness.exe'))).not.toContain('\\');
  });
});

describe('the installed command uses the embedded form end-to-end', () => {
  it('an install into a spacey home writes a stat-able path', () => {
    const binaryDir = join(home, 'bin dir');
    mkdirSync(binaryDir, { recursive: true });
    const binary = join(binaryDir, 'harness');
    // A real file, so the round-trip ends in something that can actually be stat'ed.
    writeFileSync(binary, '#!/bin/sh\n');

    const [outcome] = installStrategyA(fs, cursor(), home, env, embedBinaryPath(binary));
    const doc = JSON.parse(readFileSync(outcome.path, 'utf8')) as {
      hooks: Record<string, { command: string }[]>;
    };
    const extracted = extractBinaryPath(doc.hooks.preToolUse[0].command);

    expect(extracted).not.toBeNull();
    expect(existsSync(extracted as string)).toBe(true);
  });
});
