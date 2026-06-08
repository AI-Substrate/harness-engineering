import { describe, expect, it } from 'vitest';
import type { ExtensionRecord, HarnessVerb } from '../../../src/services/extensions/contract.js';
import type { VerbRegistry } from '../../../src/services/extensions/registry.js';
import {
  buildHelp,
  helpEmptyHint,
  renderHelpText,
} from '../../../src/services/help/help-service.js';

const mkVerb = (name: string): HarnessVerb => ({
  name,
  summary: `${name} verb`,
  run: () => ({ status: 'ok' }),
});

const loadedRecord = (name: string): ExtensionRecord => ({
  entryPath: `/repo/.harness/extensions/${name}.ts`,
  status: 'loaded',
  verbs: [mkVerb(name)],
});

function registry(verbs: HarnessVerb[], records: ExtensionRecord[]): VerbRegistry {
  return { verbs, records };
}

describe('buildHelp', () => {
  it('given_discovered_verbs_when_built_then_each_is_machine_readable_no_builtin_slots', () => {
    /*
    Test Doc:
    - Why: the front door must list the dynamic, extension-owned verb surface (AC-1) — never the
      retired BUILTIN_SLOTS — and stay agent-readable JSON (AC-6).
    - Contract: buildHelp(registry).verbs lists every registered verb as {name,summary,status};
      extensions counts loaded/failed/conflict for honesty.
    - Usage Notes: feed the assembled VerbRegistry; output is pure data (no I/O).
    - Quality Contribution: locks the dynamic verb list shape agents parse.
    - Worked Example: buildHelp(reg).verbs[0] === {name:'hello', summary:'…', status:'loaded'}.
    */
    const content = buildHelp(
      registry([mkVerb('hello'), mkVerb('build')], [loadedRecord('hello'), loadedRecord('build')]),
    );
    expect(content.verbs.map((v) => v.name)).toEqual(['hello', 'build']);
    for (const verb of content.verbs) {
      expect(verb.status).toBe('loaded');
      expect(verb.summary.length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(content)).not.toContain('BUILTIN_SLOTS');
    expect(content.extensions.installed).toBe(2);
    expect(Object.keys(content.exit_codes).sort()).toEqual(['0', '1', '2']);
  });

  it('honest empty state when no extensions are installed', () => {
    const content = buildHelp(registry([], []));
    expect(content.verbs).toEqual([]);
    expect(content.extensions.installed).toBe(0);
    expect(helpEmptyHint(content)).toMatch(/\.harness\/extensions/);
  });

  it('counts failed + conflict extensions for honesty', () => {
    const content = buildHelp(
      registry(
        [mkVerb('ok')],
        [
          loadedRecord('ok'),
          { entryPath: '/x/bad.ts', status: 'failed', verbs: [], error: 'E140: boom' },
          { entryPath: '/x/dup.ts', status: 'conflict', verbs: [], shadows: ['ok'] },
        ],
      ),
    );
    expect(content.extensions).toEqual({ installed: 1, failed: 1, conflicts: 1 });
  });
});

describe('renderHelpText', () => {
  it('covers core commands, the verb list, output modes, exit codes, first actions', () => {
    const text = renderHelpText(buildHelp(registry([mkVerb('hello')], [loadedRecord('hello')])));
    expect(text).toContain('doctor');
    expect(text).toContain('docs');
    expect(text).toContain('hello');
    expect(text).toContain('Output modes:');
    expect(text).toContain('Exit codes:');
    expect(text).toContain('Safe first actions:');
  });

  it('shows the empty-state hint when no extensions are installed', () => {
    const text = renderHelpText(buildHelp(registry([], [])));
    expect(text).toMatch(/no extensions/i);
  });
});
