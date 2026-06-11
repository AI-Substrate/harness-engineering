import { describe, expect, it } from 'vitest';
import type { HarnessRecordType } from '../../../src/services/record/contract.js';
import {
  buildRecordRegistry,
  coreRecordTypes,
  type ExtensionRecordType,
  recordTypeShapeIssues,
} from '../../../src/services/record/registry.js';

/*
Test Doc:
- Why: the record registry is the merged surface `harness record <type>` resolves against. It must
  enumerate core types always, merge extension types deterministically, and let core win a conflict.
- Contract: buildRecordRegistry(core, extension) → { types (core first, de-conflicted), conflicts };
  recordTypeShapeIssues flags a malformed kind:'record' export.
- Quality Contribution: pins the deterministic core ∪ extension merge + conflict recording.
*/

const mkRt = (type: string): HarnessRecordType => ({
  kind: 'record',
  type,
  description: `${type} type`,
  template: `---\nrecord_type: ${type}\n---\n`,
});

const mkExt = (type: string, entryPath: string): ExtensionRecordType => ({
  recordType: mkRt(type),
  entryPath,
});

describe('buildRecordRegistry — core only (default)', () => {
  it('enumerates the core record types with source "core"', () => {
    const reg = buildRecordRegistry();
    expect(reg.types.map((t) => t.type)).toContain('retro');
    const retro = reg.types.find((t) => t.type === 'retro');
    expect(retro?.source).toBe('core');
    expect(retro?.entryPath).toBeUndefined();
    expect(reg.conflicts).toEqual([]);
  });

  it('core list matches coreRecordTypes', () => {
    const reg = buildRecordRegistry();
    expect(reg.types.filter((t) => t.source === 'core').map((t) => t.type)).toEqual(
      coreRecordTypes.map((t) => t.type),
    );
  });
});

describe('buildRecordRegistry — core ∪ extension', () => {
  it('appends extension types after core, with provenance', () => {
    const reg = buildRecordRegistry(coreRecordTypes, [
      mkExt('dev-survey', '.harness/extensions/dev-survey.record.ts'),
    ]);
    const ds = reg.types.find((t) => t.type === 'dev-survey');
    expect(ds).toMatchObject({
      source: 'extension',
      entryPath: '.harness/extensions/dev-survey.record.ts',
    });
    // core comes first
    expect(reg.types[0]?.source).toBe('core');
  });

  it('an extension shadowing a core type → core wins, conflict recorded', () => {
    const reg = buildRecordRegistry(coreRecordTypes, [mkExt('retro', '/x/evil.record.ts')]);
    expect(reg.types.filter((t) => t.type === 'retro')).toHaveLength(1);
    expect(reg.types.find((t) => t.type === 'retro')?.source).toBe('core');
    expect(reg.conflicts).toEqual([
      { type: 'retro', entryPath: '/x/evil.record.ts', shadows: 'core' },
    ]);
  });

  it('two extensions with the same type → first wins, the second is a conflict', () => {
    const reg = buildRecordRegistry(coreRecordTypes, [
      mkExt('dup', '/x/first.record.ts'),
      mkExt('dup', '/x/second.record.ts'),
    ]);
    expect(reg.types.filter((t) => t.type === 'dup')).toHaveLength(1);
    expect(reg.types.find((t) => t.type === 'dup')?.entryPath).toBe('/x/first.record.ts');
    expect(reg.conflicts).toEqual([
      { type: 'dup', entryPath: '/x/second.record.ts', shadows: 'extension' },
    ]);
  });
});

describe('recordTypeShapeIssues', () => {
  it('accepts a well-formed record type', () => {
    expect(recordTypeShapeIssues(mkRt('retro'))).toEqual([]);
  });

  it('flags a missing kind, type, description, and template', () => {
    expect(recordTypeShapeIssues({})).toEqual(
      expect.arrayContaining([
        "missing kind:'record'",
        'missing or invalid type (must match ^[a-z][a-z0-9-]*$)',
        'missing or empty description',
        'missing or empty template',
      ]),
    );
  });

  it('flags a bad type name', () => {
    expect(recordTypeShapeIssues({ ...mkRt('retro'), type: 'Bad Name' })).toContain(
      'missing or invalid type (must match ^[a-z][a-z0-9-]*$)',
    );
  });

  it('flags a non-object', () => {
    expect(recordTypeShapeIssues(null)).toEqual(['not an object']);
    expect(recordTypeShapeIssues('x')).toEqual(['not an object']);
  });
});
