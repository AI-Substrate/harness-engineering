import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import type { FsPort } from '../../../src/adapters/fs/fs-port.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import { scaffoldExtension } from '../../../src/services/scaffold/scaffold-service.js';
import { v2SensorTs, v2Ts } from '../../../src/services/scaffold/templates.js';

const proc = () => new FakeProcess({}, '/repo');

describe('scaffoldExtension — v2 happy paths', () => {
  it('writes the default factory entry plus instructions', () => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name: 'greet' }, { fs, proc: proc() });
    expect(out).toMatchObject({
      ok: true,
      path: '.harness/extensions/greet/extension.ts',
      instructionsPath: '.harness/extensions/greet/instructions.md',
      verb: 'greet',
      variant: 'v2-ts',
    });
    expect(fs.readText('/repo/.harness/extensions/greet/extension.ts')).toBe(v2Ts('greet'));
    expect(fs.writes).toEqual([
      '/repo/.harness/extensions/greet/extension.ts',
      '/repo/.harness/extensions/greet/instructions.md',
    ]);
  });

  it('writes a calling-agent instructions.md beside every variant', () => {
    const fs = new FakeFs();
    scaffoldExtension({ name: 'greet', js: true }, { fs, proc: proc() });
    const briefing = fs.readText('/repo/.harness/extensions/greet/instructions.md') ?? '';
    expect(briefing).toContain('harness greet');
    expect(briefing).toMatch(/calling agent/i);
    expect(briefing).toMatch(/judg(e|ment)/i);
  });

  it('--sub emits the structural TypeScript variant', () => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name: 'db', sub: ['reset', 'seed'] }, { fs, proc: proc() });
    expect(out).toMatchObject({ ok: true, variant: 'v2-sub-ts' });
    const contents = fs.readText('/repo/.harness/extensions/db/extension.ts') ?? '';
    expect(contents).toContain("'reset': {");
    expect(contents).toContain("'seed': {");
    expect(contents).not.toContain('ctx.args.verb');
  });

  it('--wrap emits a bounded TypeScript command wrapper', () => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name: 'test', wrap: 'npm test' }, { fs, proc: proc() });
    expect(out).toMatchObject({ ok: true, variant: 'v2-wrap-ts' });
    expect(fs.readText('/repo/.harness/extensions/test/extension.ts')).toContain(
      "ctx.exec('npm', ['test'], { timeoutMs: 120_000 })",
    );
  });

  it('--sensor emits the typed command-wrapper variant and sensor briefing', () => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name: 'lint-count', sensor: true }, { fs, proc: proc() });
    expect(out).toMatchObject({ ok: true, variant: 'v2-sensor-ts' });
    expect(fs.readText('/repo/.harness/extensions/lint-count/extension.ts')).toBe(
      v2SensorTs('lint-count'),
    );
    expect(fs.readText('/repo/.harness/extensions/lint-count/instructions.md')).toContain(
      'harness sensors run lint-count',
    );
  });

  it('--js emits a bare-literal .js variant', () => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name: 'seed', js: true }, { fs, proc: proc() });
    expect(out).toMatchObject({
      ok: true,
      variant: 'v2-js',
      path: '.harness/extensions/seed/extension.js',
    });
    const contents = fs.readText('/repo/.harness/extensions/seed/extension.js') ?? '';
    expect(contents).toContain("kind: 'extension'");
    expect(contents).not.toContain('defineExtension(');
  });
});

describe('scaffoldExtension — validation and write safety', () => {
  it.each([
    'Greet',
    '2fast',
    'my verb',
    'a/b',
    'a\\b',
    '..',
    '',
    'a-',
    'a--b',
  ])('rejects invalid name %j with E150', (name) => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name }, { fs, proc: proc() });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(ErrorCodes.SCAFFOLD_INVALID_NAME);
    expect(fs.writes).toEqual([]);
  });

  it.each([
    'help',
    'doctor',
    'new',
    'docs',
    'skills',
    'record',
    'instructions',
    'sensors',
  ])('rejects reserved top-level name %j with E151', (name) => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name }, { fs, proc: proc() });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(ErrorCodes.SCAFFOLD_NAME_RESERVED);
    expect(fs.writes).toEqual([]);
  });

  it.each([
    { sub: ['Reset'], label: 'invalid' },
    { sub: ['reset', 'reset'], label: 'duplicate' },
    { sub: ['help'], label: 'reserved help' },
    { sub: [''], label: 'empty' },
  ])('rejects $label subverb sets', ({ sub }) => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name: 'db', sub }, { fs, proc: proc() });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(ErrorCodes.INVALID_ARGS);
    expect(fs.writes).toEqual([]);
  });

  it.each([
    { name: 'db', sub: ['reset'], wrap: 'npm test' },
    { name: 'db', sub: ['reset'], js: true },
    { name: 'db', wrap: 'npm test', js: true },
    { name: 'db', sensor: true, sub: ['reset'] },
    { name: 'db', sensor: true, wrap: 'npm test' },
    { name: 'db', sensor: true, js: true },
  ])('rejects ambiguous scaffold flag combinations', (options) => {
    const fs = new FakeFs();
    const out = scaffoldExtension(options, { fs, proc: proc() });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(ErrorCodes.INVALID_ARGS);
    expect(fs.writes).toEqual([]);
  });

  it.each([
    'node -e "x"',
    "echo 'hi'",
    'echo `date`',
    'a && b',
    'echo $' + '{HOME}',
    '  ',
  ])('rejects unsafe --wrap %j before writing', (wrap) => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name: 'demo', wrap }, { fs, proc: proc() });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(ErrorCodes.INVALID_ARGS);
    expect(fs.writes).toEqual([]);
  });

  it('refuses overwrite unless --force and preserves authored instructions on force', () => {
    const fs = new FakeFs({
      '/repo/.harness/extensions/greet/extension.ts': '// existing',
      '/repo/.harness/extensions/greet/instructions.md': '# Authored',
    });
    const refused = scaffoldExtension({ name: 'greet' }, { fs, proc: proc() });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe(ErrorCodes.SCAFFOLD_FILE_EXISTS);

    const forced = scaffoldExtension({ name: 'greet', force: true }, { fs, proc: proc() });
    expect(forced.ok).toBe(true);
    expect(fs.readText('/repo/.harness/extensions/greet/extension.ts')).toBe(v2Ts('greet'));
    expect(fs.readText('/repo/.harness/extensions/greet/instructions.md')).toBe('# Authored');
  });

  it('maps a write failure to E153', () => {
    const throwingFs: FsPort = {
      exists: () => false,
      readText: () => null,
      readdir: () => [],
      mkdirp: () => {
        throw new Error('EACCES');
      },
      writeText: () => {
        throw new Error('EACCES');
      },
      rename: () => {
        throw new Error('EACCES');
      },
      deleteFile: () => {},
      removeDir: () => {},
      copyDir: () => false,
      mkdtemp: () => '/tmp/fake',
      realpath: () => null,
    };
    const out = scaffoldExtension({ name: 'greet' }, { fs: throwingFs, proc: proc() });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(ErrorCodes.SCAFFOLD_WRITE_FAILED);
  });
});
