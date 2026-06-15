import { describe, expect, it } from 'vitest';
import { FakeModuleLoader } from '../../../src/adapters/loader/fake-loader.js';
import type { HarnessVerb } from '../../../src/services/extensions/contract.js';
import {
  buildExtensionRegistry,
  buildVerbRegistry,
} from '../../../src/services/extensions/registry.js';

const mkVerb = (name: string): HarnessVerb => ({
  name,
  summary: `${name} verb`,
  run: () => ({ status: 'ok' }),
});

describe('buildVerbRegistry', () => {
  it('given_valid_extensions_when_built_then_each_is_loaded_and_registered', async () => {
    /*
    Test Doc:
    - Why: the verb surface is sourced entirely from discovered extensions; the registry is the
      single place load + isolation + conflict + reservation policy lives (WS-A Decision 4/5, AC-7).
    - Contract: buildVerbRegistry loads each candidate (isolated), validates shape, reserves core
      names, flags conflicts, and returns {verbs, records}; one broken extension never breaks others.
    - Usage Notes: candidates arrive pre-sorted from discovery (first-sorted wins a name conflict).
    - Quality Contribution: pins per-extension isolation + conflict + reservation + open-key.
    - Worked Example: two valid verbs → both loaded + registered.
    */
    const loader = new FakeModuleLoader({ '/x/a.ts': mkVerb('a'), '/x/b.ts': mkVerb('b') });
    const reg = await buildVerbRegistry(['/x/a.ts', '/x/b.ts'], loader);
    expect(reg.verbs.map((v) => v.name)).toEqual(['a', 'b']);
    expect(reg.records.map((r) => r.status)).toEqual(['loaded', 'loaded']);
    expect(loader.loads).toEqual(['/x/a.ts', '/x/b.ts']);
  });

  it('isolates a load failure (E140) — other extensions still load', async () => {
    const loader = new FakeModuleLoader({
      '/x/bad.ts': new Error('SyntaxError: boom'),
      '/x/good.ts': mkVerb('good'),
    });
    const reg = await buildVerbRegistry(['/x/bad.ts', '/x/good.ts'], loader);
    const bad = reg.records.find((r) => r.entryPath === '/x/bad.ts');
    expect(bad?.status).toBe('failed');
    expect(bad?.error).toContain('E140');
    expect(bad?.error).toContain('SyntaxError');
    expect(reg.verbs.map((v) => v.name)).toEqual(['good']);
  });

  it('marks a malformed default export as failed (E140), not fatal', async () => {
    const loader = new FakeModuleLoader({
      '/x/notverb.ts': { nope: true },
      '/x/factory.ts': () => undefined, // imperative factory is rejected
      '/x/ok.ts': mkVerb('ok'),
    });
    const reg = await buildVerbRegistry(['/x/factory.ts', '/x/notverb.ts', '/x/ok.ts'], loader);
    expect(reg.records.find((r) => r.entryPath === '/x/notverb.ts')?.status).toBe('failed');
    expect(reg.records.find((r) => r.entryPath === '/x/factory.ts')?.status).toBe('failed');
    expect(reg.verbs.map((v) => v.name)).toEqual(['ok']);
  });

  it('first-sorted extension wins a duplicate verb name; the later is a conflict (E142)', async () => {
    const loader = new FakeModuleLoader({
      '/x/first.ts': mkVerb('dup'),
      '/x/second.ts': mkVerb('dup'),
    });
    const reg = await buildVerbRegistry(['/x/first.ts', '/x/second.ts'], loader);
    expect(reg.verbs.map((v) => v.name)).toEqual(['dup']);
    const second = reg.records.find((r) => r.entryPath === '/x/second.ts');
    expect(second?.status).toBe('conflict');
    expect(second?.shadows).toEqual(['dup']);
    expect(second?.error).toContain('E142');
  });

  it('reserves core names (help/doctor) — an extension cannot shadow them', async () => {
    const loader = new FakeModuleLoader({ '/x/evil.ts': mkVerb('help') });
    const reg = await buildVerbRegistry(['/x/evil.ts'], loader);
    expect(reg.verbs).toEqual([]);
    expect(reg.records[0]?.status).toBe('conflict');
    expect(reg.records[0]?.shadows).toEqual(['help']);
  });

  it('records ALL shadowed names from a multi-verb export, not just the first (F005)', async () => {
    /*
    Test Doc:
    - Why: an extension exporting several reserved/duplicate verbs must surface EVERY shadowed
      name so doctor can report it honestly; the old `??=` kept only the first, silently dropping
      the rest (F005).
    - Contract: shadows is a string[] listing every shadowed verb; the error message lists all.
    - Quality Contribution: pins the all-conflicts collection the doctor report depends on.
    - Worked Example: export [help, doctor] → shadows ['help','doctor'], both in the E142 message.
    */
    const loader = new FakeModuleLoader({ '/x/greedy.ts': [mkVerb('help'), mkVerb('doctor')] });
    const reg = await buildVerbRegistry(['/x/greedy.ts'], loader);
    expect(reg.verbs).toEqual([]);
    const rec = reg.records[0];
    expect(rec?.status).toBe('conflict');
    expect(rec?.shadows).toEqual(['help', 'doctor']);
    expect(rec?.error).toContain('help');
    expect(rec?.error).toContain('doctor');
  });

  it('treats `new` as a reserved core name an extension cannot shadow', async () => {
    /*
    Test Doc:
    - Why: `harness new` (plan 006) is a core scaffold command like help/doctor; an extension
      verb named `new` must be reported as a conflict, never silently win.
    - Contract: RESERVED_NAMES includes `new`; a `new` verb → status 'conflict', shadows ['new'].
    - Quality Contribution: pins the third reserved name so the core command can't be shadowed.
    */
    const loader = new FakeModuleLoader({ '/x/n.ts': mkVerb('new') });
    const reg = await buildVerbRegistry(['/x/n.ts'], loader);
    expect(reg.verbs).toEqual([]);
    const rec = reg.records[0];
    expect(rec?.status).toBe('conflict');
    expect(rec?.shadows).toEqual(['new']);
  });

  it('treats `docs` as a reserved core name an extension cannot shadow', async () => {
    /*
    Test Doc:
    - Why: `harness docs` (plan 007) is a core command like help/doctor/new; an extension verb
      named `docs` must be reported as a conflict, never silently win.
    - Contract: RESERVED_NAMES includes `docs`; a `docs` verb → status 'conflict', shadows ['docs'].
    - Quality Contribution: pins the fourth reserved name so the core command can't be shadowed.
    */
    const loader = new FakeModuleLoader({ '/x/d.ts': mkVerb('docs') });
    const reg = await buildVerbRegistry(['/x/d.ts'], loader);
    expect(reg.verbs).toEqual([]);
    const rec = reg.records[0];
    expect(rec?.status).toBe('conflict');
    expect(rec?.shadows).toEqual(['docs']);
  });

  it('preserves an open name:string key (no closed verb-name union)', async () => {
    const loader = new FakeModuleLoader({ '/x/o.ts': mkVerb('my-custom_verb-99') });
    const reg = await buildVerbRegistry(['/x/o.ts'], loader);
    expect(reg.verbs.map((v) => v.name)).toEqual(['my-custom_verb-99']);
  });

  it('accepts an array default export, registering non-conflicting verbs', async () => {
    const loader = new FakeModuleLoader({ '/x/multi.ts': [mkVerb('one'), mkVerb('help')] });
    const reg = await buildVerbRegistry(['/x/multi.ts'], loader);
    expect(reg.verbs.map((v) => v.name)).toEqual(['one']);
    const rec = reg.records[0];
    expect(rec?.status).toBe('conflict');
    expect(rec?.verbs.map((v) => v.name)).toEqual(['one']);
    expect(rec?.shadows).toEqual(['help']);
  });

  it('isolates a verb with a variadic arg as a failed E140 record, not fatal (F008)', async () => {
    const variadic = {
      name: 'cat',
      summary: 'cat verb',
      run: () => ({ status: 'ok' }),
      args: [{ name: '<files...>', description: 'files' }],
    } as unknown as HarnessVerb;
    const loader = new FakeModuleLoader({ '/x/cat.ts': variadic, '/x/ok.ts': mkVerb('ok') });
    const reg = await buildVerbRegistry(['/x/cat.ts', '/x/ok.ts'], loader);
    const cat = reg.records.find((r) => r.entryPath === '/x/cat.ts');
    expect(cat?.status).toBe('failed');
    expect(cat?.error).toContain('E140');
    expect(cat?.error).toContain('variadic');
    expect(reg.verbs.map((v) => v.name)).toEqual(['ok']);
  });
});

describe('reserved core act names (plan 014 T004)', () => {
  it('treats `instructions` as a reserved core name an extension cannot shadow', async () => {
    const loader = new FakeModuleLoader({ '/x/evil/extension.ts': mkVerb('instructions') });
    const reg = await buildVerbRegistry(['/x/evil/extension.ts'], loader);
    expect(reg.verbs).toEqual([]);
    expect(reg.records[0]?.status).toBe('conflict');
    expect(reg.records[0]?.shadows).toEqual(['instructions']);
  });

  it('treats `init` as a reserved core name an extension cannot shadow (plan 008 FX001)', async () => {
    // `harness init` (the governance-doc inception writer) is a core command like
    // record/new/instructions; an extension verb named `init` must conflict, never win.
    const loader = new FakeModuleLoader({ '/x/evil/extension.ts': mkVerb('init') });
    const reg = await buildVerbRegistry(['/x/evil/extension.ts'], loader);
    expect(reg.verbs).toEqual([]);
    expect(reg.records[0]?.status).toBe('conflict');
    expect(reg.records[0]?.shadows).toEqual(['init']);
  });
});

describe('buildExtensionRegistry — rejected discovery entries (plan 014 D1)', () => {
  it('synthesizes a failed record (E143) per rejected entry, with NO load attempt', async () => {
    /*
    Test Doc:
    - Why: discovery now reports flat-layout files as rejected[] instead of loading them;
      doctor surfaces them through its EXISTING failed-record rendering, so the registry
      must turn each rejection into a standard `failed` ExtensionRecord (plan 014 D1, AC-6).
    - Contract: options.rejected entries become records with status 'failed', empty verbs,
      and error 'E143: <reason>'; the loader is never invoked for them.
    - Quality Contribution: pins the zero-new-render-path design — flat files reach doctor
      as ordinary failed records.
    - Worked Example: one good folder candidate + one rejected flat file.
    */
    const loader = new FakeModuleLoader({ '/x/good/extension.ts': mkVerb('good') });
    const reg = await buildExtensionRegistry(['/x/good/extension.ts'], loader, {
      rejected: [
        {
          path: '/x/legacy.ts',
          reason: 'unsupported flat layout — move to legacy/extension.ts',
        },
      ],
    });
    expect(reg.verbs.map((v) => v.name)).toEqual(['good']);
    const flat = reg.records.find((r) => r.entryPath === '/x/legacy.ts');
    expect(flat?.status).toBe('failed');
    expect(flat?.verbs).toEqual([]);
    expect(flat?.error).toContain('E143');
    expect(flat?.error).toContain('unsupported flat layout — move to legacy/extension.ts');
    expect(loader.loads).toEqual(['/x/good/extension.ts']);
  });

  it('rejected-only discovery still yields an empty verb surface plus the failed records', async () => {
    const loader = new FakeModuleLoader({});
    const reg = await buildExtensionRegistry([], loader, {
      rejected: [
        { path: '/x/a.ts', reason: 'unsupported flat layout — move to a/extension.ts' },
        { path: '/x/b.js', reason: 'unsupported flat layout — move to b/extension.ts' },
      ],
    });
    expect(reg.verbs).toEqual([]);
    expect(reg.records.map((r) => r.entryPath)).toEqual(['/x/a.ts', '/x/b.js']);
    expect(reg.records.every((r) => r.status === 'failed')).toBe(true);
    expect(loader.loads).toEqual([]);
  });
});
