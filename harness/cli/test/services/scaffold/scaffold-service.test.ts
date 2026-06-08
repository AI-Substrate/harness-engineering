import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import type { FsPort } from '../../../src/adapters/fs/fs-port.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { ErrorCodes } from '../../../src/output/error-codes.js';
import { scaffoldExtension } from '../../../src/services/scaffold/scaffold-service.js';
import { minimalTs } from '../../../src/services/scaffold/templates.js';

/*
Test Doc:
- Why: `harness new` must deterministically validate the name, root the path the SAME way
  discovery does (via injected ProcessPort.cwd()), pick the right template, and write — all
  unit-testable with fakes (Constitution P3; plan 006 Findings 01/07).
- Contract: scaffoldExtension returns {ok:true, path, verb, variant} or {ok:false, code, message,
  next_action}; writes go through FsPort (no node:fs); the file lands at
  <cwd>/.harness/extensions/<name>.<ext>.
- Quality Contribution: pins the validation + path + flag matrix + error band before any code.
*/

const deps = () => ({ fs: new FakeFs(), proc: new FakeProcess({}, '/repo') });

describe('scaffoldExtension — happy paths', () => {
  it('writes a minimal .ts stub at <cwd>/.harness/extensions/<name>.ts and reports the relative path', () => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name: 'greet' }, { fs, proc: new FakeProcess({}, '/repo') });
    expect(out).toMatchObject({
      ok: true,
      path: '.harness/extensions/greet.ts',
      verb: 'greet',
      variant: 'minimal-ts',
    });
    expect(fs.mkdirs).toContain('/repo/.harness/extensions');
    expect(fs.writes).toContain('/repo/.harness/extensions/greet.ts');
    expect(fs.readText('/repo/.harness/extensions/greet.ts')).toBe(minimalTs('greet'));
  });

  it('--js writes a .js file', () => {
    const fs = new FakeFs();
    const out = scaffoldExtension(
      { name: 'greet', js: true },
      { fs, proc: new FakeProcess({}, '/repo') },
    );
    expect(out).toMatchObject({
      ok: true,
      path: '.harness/extensions/greet.js',
      variant: 'minimal-js',
    });
    expect(fs.writes).toContain('/repo/.harness/extensions/greet.js');
  });

  it('--wrap writes the wrap-a-command starter', () => {
    const fs = new FakeFs();
    const out = scaffoldExtension(
      { name: 'test', wrap: 'npm test' },
      { fs, proc: new FakeProcess({}, '/repo') },
    );
    expect(out).toMatchObject({ ok: true, variant: 'wrap-ts' });
    expect(fs.readText('/repo/.harness/extensions/test.ts')).toContain(
      "await ctx.exec('npm', ['test'])",
    );
  });

  it('--wrap --js composes into the wrap-js variant', () => {
    const out = scaffoldExtension({ name: 'test', wrap: 'npm test', js: true }, deps());
    expect(out).toMatchObject({
      ok: true,
      variant: 'wrap-js',
      path: '.harness/extensions/test.js',
    });
  });
});

describe('scaffoldExtension — error paths (no file written on validation failure)', () => {
  it.each([
    'Greet',
    '2fast',
    'my verb',
    'a/b',
    'a\\b',
    '..',
    '',
  ])('rejects invalid name %j with E150 and writes nothing', (name) => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name }, { fs, proc: new FakeProcess({}, '/repo') });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe(ErrorCodes.SCAFFOLD_INVALID_NAME);
      expect(out.next_action.length).toBeGreaterThan(0);
    }
    expect(fs.writes).toEqual([]);
  });

  it.each([
    'help',
    'doctor',
    'new',
  ])('rejects reserved name %j with E151 and writes nothing', (name) => {
    const fs = new FakeFs();
    const out = scaffoldExtension({ name }, { fs, proc: new FakeProcess({}, '/repo') });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(ErrorCodes.SCAFFOLD_NAME_RESERVED);
    expect(fs.writes).toEqual([]);
  });

  it('refuses to overwrite an existing file (E152) unless --force', () => {
    const seeded = { '/repo/.harness/extensions/greet.ts': '// existing' };
    const fs = new FakeFs(seeded);
    const out = scaffoldExtension({ name: 'greet' }, { fs, proc: new FakeProcess({}, '/repo') });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(ErrorCodes.SCAFFOLD_FILE_EXISTS);
    expect(fs.writes).toEqual([]);
    expect(fs.readText('/repo/.harness/extensions/greet.ts')).toBe('// existing');
  });

  it('--force overwrites an existing file', () => {
    const fs = new FakeFs({ '/repo/.harness/extensions/greet.ts': '// existing' });
    const out = scaffoldExtension(
      { name: 'greet', force: true },
      { fs, proc: new FakeProcess({}, '/repo') },
    );
    expect(out.ok).toBe(true);
    expect(fs.writes).toContain('/repo/.harness/extensions/greet.ts');
    expect(fs.readText('/repo/.harness/extensions/greet.ts')).toBe(minimalTs('greet'));
  });

  it('maps a write/mkdir failure to E153', () => {
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
    };
    const out = scaffoldExtension(
      { name: 'greet' },
      { fs: throwingFs, proc: new FakeProcess({}, '/repo') },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe(ErrorCodes.SCAFFOLD_WRITE_FAILED);
  });

  it.each([
    'node -e "x"',
    "echo 'hi'",
    'echo `date`',
    'a && b',
    'echo $' + '{HOME}',
    '  ',
  ])('rejects an unsafe --wrap command %j with E108 and writes nothing', (wrap) => {
    const fs = new FakeFs();
    const out = scaffoldExtension(
      { name: 'greet', wrap },
      { fs, proc: new FakeProcess({}, '/repo') },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe(ErrorCodes.INVALID_ARGS);
      expect(out.next_action.length).toBeGreaterThan(0);
    }
    expect(fs.writes).toEqual([]);
  });

  it('accepts a simple multi-token --wrap command', () => {
    const fs = new FakeFs();
    const out = scaffoldExtension(
      { name: 'demo', wrap: 'npm run demo' },
      { fs, proc: new FakeProcess({}, '/repo') },
    );
    expect(out.ok).toBe(true);
    expect(fs.readText('/repo/.harness/extensions/demo.ts')).toContain(
      "ctx.exec('npm', ['run', 'demo'])",
    );
  });
});
