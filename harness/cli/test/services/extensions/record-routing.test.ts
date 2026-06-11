import { describe, expect, it } from 'vitest';
import { FakeModuleLoader } from '../../../src/adapters/loader/fake-loader.js';
import type { HarnessVerb } from '../../../src/services/extensions/contract.js';
import { buildExtensionRegistry } from '../../../src/services/extensions/registry.js';
import type { HarnessRecordType } from '../../../src/services/record/contract.js';

/*
Test Doc:
- Why: the extension loader was VERB-ONLY; widening it to ALSO route kind:'record' exports must not
  break existing verb extensions (absent kind ⇒ verb) and must isolate malformed record exports the
  same way it isolates bad verbs (E140, non-fatal). This is the plan's risk cluster (KF-01).
- Contract: buildExtensionRegistry(candidates, loader, { reservedVerbs, reservedRecordTypes }) →
  { verbs, recordTypes:[{recordType,entryPath}], records }; one ExtensionRecord per file; record
  conflicts (vs a reserved core type or an earlier extension) are recorded, never fatal.
- Quality Contribution: pins verb back-compat + the new record routing/isolation/conflict behaviour.
*/

const mkVerb = (name: string): HarnessVerb => ({
  name,
  summary: `${name} verb`,
  run: () => ({ status: 'ok' }),
});

const mkRecord = (type: string): HarnessRecordType => ({
  kind: 'record',
  type,
  description: `${type} record`,
  template: `---\nrecord_type: ${type}\n---\n`,
});

const CORE_TYPES = new Set(['retro']);

describe('buildExtensionRegistry — verb back-compat', () => {
  it('an export with no kind is still routed as a verb', async () => {
    const loader = new FakeModuleLoader({ '/x/a.ts': mkVerb('a'), '/x/b.ts': mkVerb('b') });
    const reg = await buildExtensionRegistry(['/x/a.ts', '/x/b.ts'], loader, {
      reservedRecordTypes: CORE_TYPES,
    });
    expect(reg.verbs.map((v) => v.name)).toEqual(['a', 'b']);
    expect(reg.recordTypes).toEqual([]);
    expect(reg.records.map((r) => r.status)).toEqual(['loaded', 'loaded']);
  });
});

describe('buildExtensionRegistry — record routing', () => {
  it('routes a kind:record export into recordTypes with its entryPath', async () => {
    const loader = new FakeModuleLoader({ '/x/ds.record.ts': mkRecord('dev-survey') });
    const reg = await buildExtensionRegistry(['/x/ds.record.ts'], loader, {
      reservedRecordTypes: CORE_TYPES,
    });
    expect(reg.verbs).toEqual([]);
    expect(reg.recordTypes).toEqual([
      { recordType: mkRecord('dev-survey'), entryPath: '/x/ds.record.ts' },
    ]);
    expect(reg.records[0]?.status).toBe('loaded');
    expect(reg.records[0]?.recordTypes?.map((t) => t.type)).toEqual(['dev-survey']);
  });

  it('isolates a malformed record export as failed (E140), not fatal', async () => {
    const loader = new FakeModuleLoader({
      '/x/bad.record.ts': { kind: 'record', type: 'no-template' }, // missing description + template
      '/x/ok.record.ts': mkRecord('good'),
    });
    const reg = await buildExtensionRegistry(['/x/bad.record.ts', '/x/ok.record.ts'], loader, {
      reservedRecordTypes: CORE_TYPES,
    });
    const bad = reg.records.find((r) => r.entryPath === '/x/bad.record.ts');
    expect(bad?.status).toBe('failed');
    expect(bad?.error).toContain('E140');
    expect(reg.recordTypes.map((t) => t.recordType.type)).toEqual(['good']);
  });

  it('an extension shadowing a reserved core type → conflict (core wins), recorded not fatal', async () => {
    const loader = new FakeModuleLoader({ '/x/evil.record.ts': mkRecord('retro') });
    const reg = await buildExtensionRegistry(['/x/evil.record.ts'], loader, {
      reservedRecordTypes: CORE_TYPES,
    });
    expect(reg.recordTypes).toEqual([]); // core retro wins; extension dropped
    const rec = reg.records[0];
    expect(rec?.status).toBe('conflict');
    expect(rec?.recordShadows).toEqual(['retro']);
    expect(rec?.error).toContain('E142');
  });

  it('two extensions with the same record type → first wins, second is a conflict', async () => {
    const loader = new FakeModuleLoader({
      '/x/first.record.ts': mkRecord('dup'),
      '/x/second.record.ts': mkRecord('dup'),
    });
    const reg = await buildExtensionRegistry(
      ['/x/first.record.ts', '/x/second.record.ts'],
      loader,
      {
        reservedRecordTypes: CORE_TYPES,
      },
    );
    expect(reg.recordTypes.map((t) => t.entryPath)).toEqual(['/x/first.record.ts']);
    const second = reg.records.find((r) => r.entryPath === '/x/second.record.ts');
    expect(second?.status).toBe('conflict');
    expect(second?.recordShadows).toEqual(['dup']);
  });

  it('routes a mixed verb+record array export into both registries', async () => {
    const loader = new FakeModuleLoader({ '/x/mixed.ts': [mkVerb('greet'), mkRecord('note')] });
    const reg = await buildExtensionRegistry(['/x/mixed.ts'], loader, {
      reservedRecordTypes: CORE_TYPES,
    });
    expect(reg.verbs.map((v) => v.name)).toEqual(['greet']);
    expect(reg.recordTypes.map((t) => t.recordType.type)).toEqual(['note']);
    expect(reg.records[0]?.status).toBe('loaded');
  });
});
