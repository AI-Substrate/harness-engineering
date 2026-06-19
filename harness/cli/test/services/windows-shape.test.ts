import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../src/adapters/process/fake-process.js';
import {
  buildDoctorReport,
  type DoctorDeps,
  renderDoctorText,
} from '../../src/services/doctor/doctor-service.js';
import type { ExtensionRecord, HarnessVerb } from '../../src/services/extensions/contract.js';
import { discoverExtensions } from '../../src/services/extensions/discovery.js';
import type { VerbRegistry } from '../../src/services/extensions/registry.js';
import {
  instructionsPathFor,
  loadVerbInstructions,
} from '../../src/services/instructions/instructions-service.js';
import { createRecord } from '../../src/services/record/record-service.js';
import { buildRecordRegistry } from '../../src/services/record/registry.js';
import { scaffoldExtension } from '../../src/services/scaffold/scaffold-service.js';

/*
Test Doc:

THE WINDOWS-SHAPE SENSOR (plan 017 AC-8 — the deterministic replacement for a
Windows CI executor, ruled out by user decision 2026-06-10).

Every test here runs on ubuntu (and any other OS) but feeds the services
Windows-SHAPED inputs: `FakeProcess.cwd() = 'C:\\repo'` backslash/drive-letter
fixtures, with FakeFs seeded using the post-`toPosix` keys the converted
services should probe (e.g. 'C:/repo/.harness/extensions'). If anyone reverts a
service to native `node:path` math — or drops the `toPosix` boundary — a
backslash leaks into a surfaced path (or a seeded probe misses) and these
assertions fail deterministically on Linux. That is the regression the ruled-
out `windows-latest` CI leg would have caught.

Covered surfaces (plan T008): discovery candidates + rejected paths · record
`data.path` + error messages + unconfigured cwd · scaffold `data.path` +
instructionsPath · doctor convention `folder`/`next_action` + the
`renderDoctorText` folder-matching at doctor-service `:291` · instructions
briefing-path resolution. All asserted as clean POSIX (no `\`), literal
`.harness/...` shapes.

Sensor proof (recorded in the execution log): with the discovery boundary
temporarily reverted to native `join(proc.cwd(), …)`, this file fails.
*/

const WIN_CWD = 'C:\\repo';

const mkVerb = (name: string): HarnessVerb => ({
  name,
  summary: `${name} verb`,
  run: () => ({ status: 'ok' }),
});

function registry(records: ExtensionRecord[]): VerbRegistry {
  return { verbs: records.flatMap((r) => r.verbs), records };
}

describe('discovery under a Windows-shaped cwd', () => {
  it('emits POSIX candidates and rejected paths from a C:\\ cwd', () => {
    const proc = new FakeProcess({}, WIN_CWD);
    const fs = new FakeFs(
      { 'C:/repo/.harness/extensions/hello/extension.ts': '// entry' },
      { 'C:/repo/.harness/extensions': ['hello', 'legacy.ts'] },
    );
    const result = discoverExtensions(fs, proc);
    expect(result.candidates).toEqual(['C:/repo/.harness/extensions/hello/extension.ts']);
    expect(result.rejected).toEqual([
      {
        path: 'C:/repo/.harness/extensions/legacy.ts',
        reason: 'unsupported flat layout — move to legacy/extension.ts',
      },
    ]);
    for (const p of [...result.candidates, ...result.rejected.map((r) => r.path)]) {
      expect(p).not.toContain('\\');
    }
  });

  it('normalizes a mixed-separator, lower-case-drive cwd at the boundary', () => {
    const proc = new FakeProcess({}, 'c:\\work/repo');
    const fs = new FakeFs(
      { 'C:/work/repo/.harness/extensions/hello/extension.ts': '// entry' },
      { 'C:/work/repo/.harness/extensions': ['hello'] },
    );
    const result = discoverExtensions(fs, proc);
    expect(result.candidates).toEqual(['C:/work/repo/.harness/extensions/hello/extension.ts']);
  });

  it('manifest containment still drops ../escapes for drive-letter paths (no resolve corruption)', () => {
    const proc = new FakeProcess({}, WIN_CWD);
    const fs = new FakeFs(
      {
        'C:/repo/.harness/extensions/mani/package.json': JSON.stringify({
          harness: { extensions: ['./inner.ts', '../escape.ts'] },
        }),
        'C:/repo/.harness/extensions/mani/inner.ts': '// inner',
      },
      { 'C:/repo/.harness/extensions': ['mani'] },
    );
    const result = discoverExtensions(fs, proc);
    expect(result.candidates).toEqual(['C:/repo/.harness/extensions/mani/inner.ts']);
  });
});

describe('record under a Windows-shaped cwd', () => {
  const CORE = buildRecordRegistry();
  const depsAt = (fs: FakeFs) => ({
    fs,
    clock: new FakeClock('2026-06-10T07:20:00.000Z'),
    proc: new FakeProcess({}, WIN_CWD),
    git: new FakeGit({ isRepo: true, branch: 'main' }),
    env: new FakeEnv(),
    version: '0.0.0-test',
  });

  it('returns a POSIX relative data.path and writes to the POSIX absolute key', () => {
    const fs = new FakeFs();
    fs.mkdirp('C:\\repo\\.harness'); // Windows-shaped seed — canonical-POSIX registered (T003)
    const outcome = createRecord({ type: 'retro', slug: 'win-note' }, CORE, depsAt(fs));
    expect(outcome).toMatchObject({
      ok: true,
      type: 'retro',
      path: '.harness/records/retro/2026-06-10/001-win-note.md',
    });
    expect(fs.writes).toContain('C:/repo/.harness/records/retro/2026-06-10/001-win-note.md');
  });

  it('surfaces the unconfigured cwd in POSIX form', () => {
    const outcome = createRecord({ type: 'retro' }, CORE, depsAt(new FakeFs()));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toBe('No .harness/ directory found in C:/repo.');
      expect(outcome.message).not.toContain('\\');
    }
  });

  it('builds error messages (ordinal exhaustion) in POSIX space', () => {
    const fs = new FakeFs({}, { 'C:/repo/.harness/records/retro/2026-06-10': ['999.md'] });
    fs.mkdirp('C:\\repo\\.harness');
    const outcome = createRecord({ type: 'retro' }, CORE, depsAt(fs));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toContain('.harness/records/retro/2026-06-10');
      expect(outcome.message).not.toContain('\\');
    }
  });
});

describe('scaffold under a Windows-shaped cwd', () => {
  it('returns POSIX data.path/instructionsPath and writes POSIX absolute keys', () => {
    const fs = new FakeFs();
    const outcome = scaffoldExtension(
      { name: 'win-verb' },
      { fs, proc: new FakeProcess({}, WIN_CWD) },
    );
    expect(outcome).toMatchObject({
      ok: true,
      path: '.harness/extensions/win-verb/extension.ts',
      instructionsPath: '.harness/extensions/win-verb/instructions.md',
    });
    expect(fs.mkdirs).toContain('C:/repo/.harness/extensions/win-verb');
    expect(fs.writes).toContain('C:/repo/.harness/extensions/win-verb/extension.ts');
    expect(fs.writes).toContain('C:/repo/.harness/extensions/win-verb/instructions.md');
    for (const w of fs.writes) {
      expect(w).not.toContain('\\');
    }
  });
});

describe('doctor under a Windows-shaped cwd', () => {
  const ALL_TOOLS = { node: '/usr/bin/node', just: '/usr/bin/just', biome: '/usr/bin/biome' };
  const BUILT_CLI = {
    'harness/cli/tsconfig.json': '{}',
    'harness/cli/dist/index.js': '// built',
  };

  function deps(fs: FakeFs): DoctorDeps {
    return {
      fs,
      proc: new FakeProcess(ALL_TOOLS, WIN_CWD),
      git: new FakeGit({ isRepo: true, branch: 'main' }),
      env: new FakeEnv(),
      clock: new FakeClock('2026-06-10T07:20:00.000Z'),
    };
  }

  // entryPath as discovery (the single POSIX origin) emits it under WIN_CWD.
  const reg = registry([
    {
      entryPath: 'C:/repo/.harness/extensions/hello/extension.ts',
      status: 'loaded',
      verbs: [mkVerb('hello')],
    },
  ]);

  it('emits the convention complaint folder + next_action in POSIX form', () => {
    const report = buildDoctorReport(deps(new FakeFs(BUILT_CLI)), reg);
    expect(report.conventions).toHaveLength(1);
    const complaint = report.conventions[0];
    expect(complaint.folder).toBe('C:/repo/.harness/extensions/hello');
    expect(complaint.next_action).toBe(
      'author .harness/extensions/hello/instructions.md — see `harness instructions` for the pattern',
    );
    expect(complaint.next_action).not.toContain('\\');
  });

  it('renderDoctorText pairs the complaint with its extension (both comparison sides POSIX)', () => {
    // doctor-service :291 — dirname(entryPath) === folder. A partial conversion
    // (one side native, one POSIX) would orphan the complaint into the
    // unmatched loop; the 8-space arrow indent proves the pairing matched.
    const text = renderDoctorText(buildDoctorReport(deps(new FakeFs(BUILT_CLI)), reg));
    expect(text).toContain(
      '\n        → author .harness/extensions/hello/instructions.md — see `harness instructions` for the pattern',
    );
  });
});

describe('instructions under a Windows-shaped cwd', () => {
  it('resolves the briefing path beside the POSIX entryPath', () => {
    const reg = registry([
      {
        entryPath: 'C:/repo/.harness/extensions/hello/extension.ts',
        status: 'loaded',
        verbs: [mkVerb('hello')],
      },
    ]);
    expect(instructionsPathFor('hello', reg)).toBe(
      'C:/repo/.harness/extensions/hello/instructions.md',
    );
    const fs = new FakeFs({ 'C:/repo/.harness/extensions/hello/instructions.md': '# Briefing' });
    const out = loadVerbInstructions('hello', reg, fs);
    expect(out).toMatchObject({
      kind: 'ok',
      path: 'C:/repo/.harness/extensions/hello/instructions.md',
      instructions: '# Briefing',
    });
  });

  it('wires discovery output straight into instructions resolution (pipeline shape)', () => {
    const proc = new FakeProcess({}, WIN_CWD);
    const fs = new FakeFs(
      {
        'C:/repo/.harness/extensions/hello/extension.ts': '// entry',
        'C:/repo/.harness/extensions/hello/instructions.md': '# Briefing',
      },
      { 'C:/repo/.harness/extensions': ['hello'] },
    );
    const { candidates } = discoverExtensions(fs, proc);
    const reg = registry([
      { entryPath: candidates[0], status: 'loaded', verbs: [mkVerb('hello')] },
    ]);
    const out = loadVerbInstructions('hello', reg, fs);
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.path).toBe('C:/repo/.harness/extensions/hello/instructions.md');
      expect(out.path).not.toContain('\\');
    }
  });
});

describe('AC-2 source guard — NO service imports node:path (repo-wide invariant)', () => {
  /*
  Test Doc:
  - Why: the revert-proof showed a single-site native-join reversion is partially
    self-healed by helper defense-in-depth — the fixture sensor above catches
    boundary regressions, but a re-introduced `node:path` import deeper in a
    service could slip through (companion F002). This guard makes AC-2's
    "read-verified" claim a deterministic sensor instead of a one-time review.
  - Contract: NO file under src/services imports `node:path`; all logical path
    math goes through services/shared/posix-path.ts.
  - GLOBBED, not enumerated: the original guard listed five named files, so it
    was structurally blind to any service it forgot to list — exactly how
    observe-service.ts + shared/temp.ts shipped a node:path leak past a green
    suite. Walking every `.ts` under src/services asserts the *invariant*,
    not a roster.
  - The ONE sanctioned exception is the posix-path helper itself: it wraps
    node:path's `posix` API and IS the boundary every other service routes
    through. Keep ALLOWED minimal and justified.
  */
  const SERVICES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'services');
  const ALLOWED = new Set(['shared/posix-path.ts']);

  const services = readdirSync(SERVICES_DIR, { recursive: true })
    .map((entry) => String(entry).replace(/\\/g, '/'))
    .filter((rel) => rel.endsWith('.ts') && !ALLOWED.has(rel))
    .sort();

  it.each(services)('%s has no node:path import', (rel) => {
    const source = readFileSync(join(SERVICES_DIR, rel), 'utf8');
    expect(
      source,
      `${rel} must use services/shared/posix-path.ts, never node:path (AC-2)`,
    ).not.toMatch(/from 'node:path'/);
  });
});

describe('plan 031 AC-01 — the dogfood verb sources are cross-platform by construction', () => {
  /*
  Test Doc:
  - Why: the whole point of plan 031 is that validate-harness-flow and
    validate-harnessability run on Windows. That holds only while their sources
    carry NO POSIX shell-out, NO /tmp literal, and NO node:* import — the exact
    regressions windows-check guards in CI. This is the in-suite twin of that
    verb (a direct AC-01 source assertion that fails the unit run, not just CI).
  - Contract: each tracked dogfood verb source (extension.ts + lib/*.ts) is free
    of ctx.exec('bash'|'sh'|coreutil), a `/tmp` path, a `nohup`/`& echo $!` idiom,
    and a node-builtin import (node:, fs, path, os, child_process). node lives only
    in the core adapters.
  */
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const DOGFOOD_SOURCES = [
    '.harness/extensions/validate-harness-flow/extension.ts',
    '.harness/extensions/validate-harness-flow/lib/worker-io.ts',
    '.harness/extensions/validate-harnessability/extension.ts',
  ];

  // Match a code line (ignore // comments) so a *descriptive* comment can't fail
  // the guard — windows-check (which scans comments too) is the broader net.
  const codeLines = (src: string): string =>
    src
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n');

  it.each(DOGFOOD_SOURCES)('%s has no POSIX shell-out / /tmp / node:* (AC-01)', (rel) => {
    const code = codeLines(readFileSync(join(REPO_ROOT, rel), 'utf8'));
    expect(code, 'no shell/coreutil shell-out').not.toMatch(
      /(?:ctx\.exec|exec|spawn)\(\s*['"`](?:bash|sh|zsh|mkdir|cp|mv|rm|sleep|realpath|nohup|printf|chmod|touch|cat|ls)\b/,
    );
    expect(code, 'no /tmp literal').not.toMatch(/['"`][^'"`]*\/tmp(?:\/|['"`])/);
    expect(code, 'no nohup / & echo $! background idiom').not.toMatch(/\bnohup\b|&\s*echo\s+\$!/);
    expect(code, 'no node:* / builtin import (node:* lives in the core)').not.toMatch(
      /(?:from\s+|require\(\s*)['"](?:node:[a-z_/]+|fs|fs\/promises|path|os|child_process)['"]/,
    );
  });
});

describe('plan 031 — the new write port keeps Windows-shaped input POSIX-clean', () => {
  it('FakeFs.copy + mkdtemp never leak a backslash into a surfaced/registered path', () => {
    const fs = new FakeFs({ 'C:/clone/.harness/reports/latest.json': 'X' });
    // A Windows-shaped destDir must register a POSIX dest (matches NodeFs surfacing rules).
    fs.copy('C:/clone/.harness/reports/latest.json', 'C:\\out\\dir');
    for (const w of fs.writes) expect(w).not.toContain('\\');
    expect(fs.exists('C:/out/dir/latest.json')).toBe(true);
    // mkdtemp returns a POSIX path and registers it.
    const tmp = fs.mkdtemp('win-shape-');
    expect(tmp).not.toContain('\\');
    expect(fs.exists(tmp)).toBe(true);
  });
});
