import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
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
  entryPath: `/repo/.harness/extensions/${name}/extension.ts`,
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
    - Contract: buildHelp(registry, fs).verbs lists every registered verb as
      {name,summary,status,has_instructions}; extensions counts loaded/failed/conflict for honesty.
    - Usage Notes: feed the assembled VerbRegistry + an FsPort (instructions existence probes).
    - Quality Contribution: locks the dynamic verb list shape agents parse.
    - Worked Example: buildHelp(reg, fs).verbs[0].name === 'hello'.
    */
    const content = buildHelp(
      registry([mkVerb('hello'), mkVerb('build')], [loadedRecord('hello'), loadedRecord('build')]),
      new FakeFs(),
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

  it('carries agents_start_here pointing at `harness instructions` (plan 014 AC-4)', () => {
    /*
    Test Doc:
    - Why: a zero-context agent's FIRST hop is `harness help`; the payload must route it to the
      self-briefing channel in one step (AGENTS START HERE, plan 014 AC-4).
    - Contract: buildHelp(...).agents_start_here is a string naming `harness instructions`.
    */
    const content = buildHelp(registry([], []), new FakeFs());
    expect(content.agents_start_here).toContain('harness instructions');
  });

  it('marks each verb with has_instructions from an FsPort probe of its owning folder (AC-4)', () => {
    const fs = new FakeFs({
      '/repo/.harness/extensions/hello/instructions.md': '# Hello briefing',
    });
    const content = buildHelp(
      registry([mkVerb('hello'), mkVerb('build')], [loadedRecord('hello'), loadedRecord('build')]),
      fs,
    );
    expect(content.verbs).toEqual([
      { name: 'hello', summary: 'hello verb', status: 'loaded', has_instructions: true },
      { name: 'build', summary: 'build verb', status: 'loaded', has_instructions: false },
    ]);
  });

  it('honest empty state when no extensions are installed', () => {
    const content = buildHelp(registry([], []), new FakeFs());
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
          { entryPath: '/x/bad/extension.ts', status: 'failed', verbs: [], error: 'E140: boom' },
          { entryPath: '/x/dup/extension.ts', status: 'conflict', verbs: [], shadows: ['ok'] },
        ],
      ),
      new FakeFs(),
    );
    expect(content.extensions).toEqual({ installed: 1, failed: 1, conflicts: 1 });
  });
});

describe('renderHelpText', () => {
  it('LEADS with the AGENTS START HERE banner (plan 014 AC-4)', () => {
    const text = renderHelpText(
      buildHelp(registry([mkVerb('hello')], [loadedRecord('hello')]), new FakeFs()),
    );
    const firstLine = text.split('\n')[0] ?? '';
    expect(firstLine).toContain('AGENTS START HERE');
    expect(firstLine).toContain('npx harness instructions');
  });

  it('covers core commands, the verb list, output modes, exit codes, first actions', () => {
    const text = renderHelpText(
      buildHelp(registry([mkVerb('hello')], [loadedRecord('hello')]), new FakeFs()),
    );
    expect(text).toContain('doctor');
    expect(text).toContain('docs');
    expect(text).toContain('instructions');
    expect(text).toContain('hello');
    expect(text).toContain('Output modes:');
    expect(text).toContain('Exit codes:');
    expect(text).toContain('Safe first actions:');
  });

  it('splits core commands and contributed verbs under separate headings', () => {
    /*
    Test Doc:
    - Why: the dynamic, extension-owned surface must read distinctly from the fixed core — a single
      flat `Commands:` list buries contributed verbs (the feature ask).
    - Contract: renderHelpText emits a `Commands:` heading AND an `Extensions:` heading, with each
      verb listed under the latter.
    - Worked Example: with a 'greet' verb, 'greet' appears after the 'Extensions:' heading.
    */
    const text = renderHelpText(
      buildHelp(registry([mkVerb('greet')], [loadedRecord('greet')]), new FakeFs()),
    );
    expect(text).toContain('Commands:');
    expect(text).toContain('Extensions:');
    expect(text.indexOf('greet')).toBeGreaterThan(text.indexOf('Extensions:'));
  });

  it('emits ANSI only when useColor is set (default plain for pipes/agents)', () => {
    /*
    Test Doc:
    - Why: the custom `harness help` renderer bypasses commander's auto-strip, so it must gate color
      itself — colored for an interactive human, plain everywhere else.
    - Contract: renderHelpText(content) has no ESC; renderHelpText(content, true) contains ESC.
    */
    const content = buildHelp(registry([mkVerb('greet')], [loadedRecord('greet')]), new FakeFs());
    expect(renderHelpText(content)).not.toContain('\x1b[');
    expect(renderHelpText(content, true)).toContain('\x1b[');
  });

  it('shows the empty-state hint when no extensions are installed', () => {
    const text = renderHelpText(buildHelp(registry([], []), new FakeFs()));
    expect(text).toMatch(/no extensions/i);
  });
});
