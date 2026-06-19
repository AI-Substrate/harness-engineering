import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Finding, inScope, RULES, scanText } from './rules.js';

/*
Test Doc:
- Why: windows-check is the deterministic, by-construction replacement for a
  Windows CI executor (plan 031 / 017). Its value rests ENTIRELY on these pure
  rules firing on hostile patterns and staying silent on the portable ones — so
  each rule is pinned with a hostile + safe pair, and the holistic scan is proven
  over real fixture files.
- Contract: each RULES[i].test(line, fileText) → boolean; scanText honors
  `// win-ok:` suppressions; inScope selects only extension sources (not the
  core, not self/tests/fixtures).
*/

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const rule = (id: string) => {
  const r = RULES.find((x) => x.id === id);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const hits = (id: string, line: string, fileText = line) => rule(id).test(line, fileText);

describe('windows-check rules — hostile fires, safe stays silent', () => {
  it('WIN001 POSIX shell-out / coreutil', () => {
    expect(hits('WIN001', "await ctx.exec('bash', ['-c', 'command -v minih'])")).toBe(true);
    expect(hits('WIN001', "await ctx.exec('mkdir', ['-p', dir])")).toBe(true);
    expect(hits('WIN001', "await ctx.exec('sleep', ['0.3'])")).toBe(true);
    // safe: real cross-platform tools through ctx.exec
    expect(hits('WIN001', "await ctx.exec('git', ['status', '--porcelain'])")).toBe(false);
    expect(hits('WIN001', "await ctx.exec('minih', ['--version'])")).toBe(false);
  });

  it('WIN002 hard-coded /tmp', () => {
    expect(hits('WIN002', 'const t = `/tmp/harness-${x}`;')).toBe(true);
    expect(hits('WIN002', "const t = '/tmp';")).toBe(true);
    // safe: the portable temp primitive + a logical .harness path
    expect(hits('WIN002', "const t = ctx.fsWrite.mkdtemp('harness-');")).toBe(false);
    expect(hits('WIN002', "const d = `${cwd}/.harness/temp`;")).toBe(false);
  });

  it('WIN003 git clone without core.longpaths (file-level context)', () => {
    const hostile = "await ctx.exec('git', ['clone', '--depth=1', url, dest]);";
    expect(hits('WIN003', hostile, hostile)).toBe(true);
    // safe: longpaths present ANYWHERE in the file suppresses it
    const safe =
      "await ctx.exec('git', ['clone', '-c', 'core.longpaths=true', '--depth=1', url, dest]);";
    expect(hits('WIN003', safe, safe)).toBe(false);
  });

  it('WIN004 single-separator basename split', () => {
    expect(hits('WIN004', "const n = url.split('/').pop();")).toBe(true);
    expect(hits('WIN004', 'const seg = p.split("/")[0];')).toBe(true);
    // safe: the dual-separator split, and a non-basename split
    expect(hits('WIN004', 'const n = url.split(/[/\\\\]/).pop();')).toBe(false);
    expect(hits('WIN004', "const parts = text.split('/').filter(Boolean);")).toBe(false);
  });

  it('WIN005 node: builtin import in an extension', () => {
    expect(hits('WIN005', "import { spawn } from 'node:child_process';")).toBe(true);
    expect(hits('WIN005', "import { join } from 'node:path';")).toBe(true);
    expect(hits('WIN005', "const fs = require('fs');")).toBe(true);
    // safe: the type-only contract import
    expect(
      hits('WIN005', "import type { HarnessVerb } from '@ai-substrate/engineering-harness/contract';"),
    ).toBe(false);
  });

  it('WIN006 direct child_process spawn (not the ctx ports)', () => {
    expect(hits('WIN006', "const c = spawn('minih', ['run']);")).toBe(true);
    expect(hits('WIN006', 'const r = execSync(cmd);')).toBe(true);
    // safe: the ctx ports — ctx.exec and the detached port (spawnDetached)
    expect(hits('WIN006', "await ctx.exec('git', ['status']);")).toBe(false);
    expect(hits('WIN006', 'const { pid } = ctx.background.spawnDetached(input);')).toBe(false);
  });

  it('WIN007 POSIX absolute path or $HOME', () => {
    expect(hits('WIN007', 'const h = process.env.HOME;')).toBe(true);
    expect(hits('WIN007', "const bin = '/usr/local/bin/node';")).toBe(true);
    // safe: USERPROFILE via the env port, and a logical repo path
    expect(hits('WIN007', "const h = ctx.env.get('USERPROFILE');")).toBe(false);
    expect(hits('WIN007', "const d = '/repo/.harness/extensions';")).toBe(false);
  });

  it('WIN008 POSIX background-spawn idiom', () => {
    expect(hits('WIN008', "'log=\"$1\"; shift; nohup \"$@\" > \"$log\" 2>&1 & echo $!'")).toBe(true);
    // safe: the portable detached port
    expect(hits('WIN008', 'ctx.background.spawnDetached({ command, args, cwd, logPath });')).toBe(
      false,
    );
  });
});

describe('scanText', () => {
  it('reports the rule, 1-based line, and snippet for each hit', () => {
    const text = ["// header", "await ctx.exec('mkdir', ['-p', dir]);"].join('\n');
    const found = scanText('foo/extension.ts', text);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: 'WIN001', file: 'foo/extension.ts', line: 2 });
    expect(found[0].snippet).toContain("ctx.exec('mkdir'");
  });

  it('a `// win-ok:` line is suppressed (the documented escape hatch)', () => {
    const text = "await ctx.exec('bash', ['-c', 'x']); // win-ok: legacy, ubuntu-only tool";
    expect(scanText('foo/extension.ts', text)).toEqual([]);
  });

  it('the hostile fixture trips many rule classes; the clean fixture trips none', () => {
    const hostile = readFileSync(join(FIXTURES, 'hostile-sample.txt'), 'utf8');
    const clean = readFileSync(join(FIXTURES, 'clean-sample.txt'), 'utf8');

    const hostileFindings = scanText('fixtures/hostile-sample.txt', hostile);
    const classes = new Set(hostileFindings.map((f: Finding) => f.rule));
    // At least the unambiguous classes must fire.
    for (const id of ['WIN001', 'WIN002', 'WIN003', 'WIN004', 'WIN005', 'WIN006', 'WIN007', 'WIN008']) {
      expect(classes.has(id), `expected ${id} to fire on the hostile fixture`).toBe(true);
    }

    expect(scanText('fixtures/clean-sample.txt', clean)).toEqual([]);
  });
});

describe('inScope', () => {
  it('selects extension sources only — not the core, not self/tests/fixtures', () => {
    expect(inScope('.harness/extensions/validate-harness-flow/extension.ts')).toBe(true);
    expect(inScope('.harness/extensions/validate-harness-flow/lib/worker-io.ts')).toBe(true);
    // out of scope:
    expect(inScope('harness/cli/src/adapters/fs/node-fs.ts')).toBe(false); // the core owns node:*
    expect(inScope('.harness/extensions/windows-check/lib/rules.ts')).toBe(false); // self
    expect(inScope('.harness/extensions/foo/decision.test.ts')).toBe(false); // tests
    expect(inScope('.harness/extensions/windows-check/fixtures/hostile-sample.txt')).toBe(false);
    expect(inScope('.harness/extensions/foo/instructions.md')).toBe(false); // not source
  });
});
