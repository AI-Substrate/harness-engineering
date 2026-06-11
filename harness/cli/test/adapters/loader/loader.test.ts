import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeModuleLoader } from '../../../src/adapters/loader/fake-loader.js';
import { JitiLoader } from '../../../src/adapters/loader/jiti-loader.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('FakeModuleLoader', () => {
  it('given_scripted_path_when_load_then_returns_default_export_and_records_path', async () => {
    /*
    Test Doc:
    - Why: registry/discovery tests must drive the loader seam with zero jiti/fs so they
      stay fast + deterministic (plan T009, AC-9).
    - Contract: FakeModuleLoader.load resolves the scripted default export and records the
      path on loads[]; a scripted Error (or unscripted path) rejects → the registry's E140 path.
    - Usage Notes: seed `{ '/abs/hello.ts': verb, '/abs/broken.ts': new Error(...) }`.
    - Quality Contribution: pins the load seam the isolation tests rely on.
    - Worked Example: new FakeModuleLoader({'/x/h.ts': verb}).load('/x/h.ts') → verb.
    */
    const verb = { name: 'hello', summary: 's', run: () => ({ status: 'ok' }) };
    const loader = new FakeModuleLoader({ '/x/hello.ts': verb });
    await expect(loader.load('/x/hello.ts')).resolves.toBe(verb);
    expect(loader.loads).toEqual(['/x/hello.ts']);
  });

  it('rejects with the scripted Error (simulated load failure → E140)', async () => {
    const loader = new FakeModuleLoader({ '/x/broken.ts': new Error('SyntaxError: boom') });
    await expect(loader.load('/x/broken.ts')).rejects.toThrow('SyntaxError: boom');
  });

  it('rejects an unscripted path', async () => {
    const loader = new FakeModuleLoader();
    await expect(loader.load('/x/missing.ts')).rejects.toThrow(/No module scripted/);
  });
});

describe('JitiLoader (real jiti smoke)', () => {
  it('loads a .ts fixture default export, fully transpiling a TS enum', async () => {
    const loader = new JitiLoader();
    const mod = await loader.load(join(here, 'fixtures', 'enum-default.ts'));
    expect(mod).toEqual({ name: 'enum-sample', color: 'red' });
  });

  it('loads a .js fixture default export via the native-import fast path', async () => {
    const loader = new JitiLoader();
    const mod = await loader.load(join(here, 'fixtures', 'plain.js'));
    expect(mod).toEqual({ name: 'plain-js', value: 42 });
  });

  it('returns the default export only for a .js module — a named-only module yields undefined (F002)', async () => {
    /*
    Test Doc:
    - Why: the native-import path must return the module's DEFAULT export (parity with the jiti
      `{default:true}` path), never the whole namespace; a named-only module has no default, so the
      registry can reject it cleanly as a malformed export instead of mis-reading the namespace (F002).
    - Contract: load() of a .js module with only named exports resolves to undefined (no default).
    - Quality Contribution: pins default-export-only semantics the loader JSDoc promises.
    - Worked Example: load(named-only.js) → undefined (registry then records a clean E140).
    */
    const loader = new JitiLoader();
    const mod = await loader.load(join(here, 'fixtures', 'named-only.js'));
    expect(mod).toBeUndefined();
  });
});
