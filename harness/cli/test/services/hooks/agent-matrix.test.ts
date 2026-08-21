import { describe, expect, it } from 'vitest';
import {
  AGENT_MATRIX,
  type AgentSpec,
  findAgent,
  type OverrideKind,
  resolveConfigFiles,
  resolveConfigRoot,
} from '../../../src/services/hooks/agent-matrix.js';

/**
 * THE AGENT MATRIX (plan 082 tk-0004).
 *
 * ON THE ORDER THESE WERE BUILT IN, because it changes what the refusal proves.
 * A swap row written BEFORE the resolvers exist goes red because there are no
 * resolvers — that proves the row runs, and nothing about whether it can detect a
 * swap, since with nothing to swap there is no asymmetry to be sensitive to.
 * The refusal recorded in the execution log is the one taken AFTER these rows were
 * green: implement, watch green, then swap and watch red. Same lesson as a
 * rewritten fixture not inheriting its predecessor's refusal — there the instrument
 * changed, here the SUBJECT arrived, and either way a refusal recorded against a
 * different state of the world is not a refusal against this one.
 */

const env = (vars: Record<string, string>) => (name: string) => vars[name];
const noEnv = () => undefined;

const spec = (agent: string): AgentSpec => {
  const found = findAgent(agent);
  if (found === undefined) throw new Error(`${agent} missing from the matrix`);
  return found;
};

describe('the env overrides are ASYMMETRIC (dw-000d)', () => {
  it('CLAUDE_CONFIG_DIR is used VERBATIM — nothing is appended', () => {
    expect(
      resolveConfigRoot(spec('claude-code'), '/home/dev', env({ CLAUDE_CONFIG_DIR: '/cfg' })),
    ).toBe('/cfg');
  });

  it('GEMINI_CLI_HOME is the HOME ROOT — .gemini IS appended', () => {
    expect(
      resolveConfigRoot(spec('gemini'), '/home/dev', env({ GEMINI_CLI_HOME: '/elsewhere' })),
    ).toBe('/elsewhere/.gemini');
  });

  it('with NO override set, the two are INDISTINGUISHABLE — why set-vs-unset is not the proof', () => {
    /*
    Test Doc:
    - Why: dw-000d says set-vs-unset is not accepted as the proof, and this row shows
      exactly why rather than asserting it. Unset, both kinds resolve to
      home/subdir, so a resolver that always appended (or never did) passes a
      set-vs-unset test with the bug fully present.
    - Contract: identical shape, unset.
    - Quality Contribution: makes the INADEQUACY of the easy test executable, so
      nobody later "simplifies" the swap mutation into a set-vs-unset pair.
    */
    expect(resolveConfigRoot(spec('claude-code'), '/home/dev', noEnv)).toBe('/home/dev/.claude');
    expect(resolveConfigRoot(spec('gemini'), '/home/dev', noEnv)).toBe('/home/dev/.gemini');
  });

  it('an EMPTY override value falls back to the home, rather than resolving to nothing', () => {
    // An exported-but-empty variable is common in shells. Treating it as set would
    // resolve claude-code's config root to '' and write to the filesystem root.
    expect(
      resolveConfigRoot(spec('claude-code'), '/home/dev', env({ CLAUDE_CONFIG_DIR: '' })),
    ).toBe('/home/dev/.claude');
  });

  it('the ASYMMETRY IS DATA, not branching — the two kinds differ by one field', () => {
    /*
    Test Doc:
    - Why: this is what makes the swap mutation a single meaningful edit rather than
      a rewrite. If the two behaviours lived in two `if` branches, swapping them
      would be an ambiguous change and the mutation would prove less.
    - Contract: the kinds are the ONLY difference recorded between the two overrides.
    */
    const kinds: Record<string, OverrideKind | undefined> = Object.fromEntries(
      AGENT_MATRIX.filter((s) => s.override !== undefined).map((s) => [s.agent, s.override?.kind]),
    );
    expect(kinds).toEqual({ 'claude-code': 'config-dir', gemini: 'home-root' });
  });
});

describe('event-name casing comes from the MATRIX, per agent (dw-000f)', () => {
  it.each([
    ['claude-code', ['PreToolUse'], ['PostToolUse']],
    ['cursor', ['preToolUse'], ['postToolUse']],
    ['firebender', ['preToolUse'], ['postToolUse']],
    ['gemini', ['BeforeTool'], ['AfterTool']],
    ['droid', ['PreToolUse'], ['PostToolUse']],
    ['github-copilot', ['PreToolUse'], ['PostToolUse']],
    // NOT a casing variant — windsurf dispatches on CASCADE events and has no
    // ToolUse key at all (`windsurf.rs:17-23`). We wrote PreToolUse/PostToolUse
    // into `~/.codeium/hooks.json`: structurally valid, and dead. Plan 082 F005.
    [
      'windsurf',
      ['pre_write_code', 'pre_run_command'],
      ['post_write_code', 'post_run_command', 'post_cascade_response_with_transcript'],
    ],
  ])('%s uses %s / %s', (agent, pre, post) => {
    /*
    Test Doc:
    - Why: assuming `PreToolUse` is wrong for FOUR of the seven. cursor and
      firebender are lowerCamel; gemini is BeforeTool/AfterTool, a different word
      entirely; windsurf is five snake_case cascade events and not a ToolUse pair at
      all. A wrong key writes a hook the agent never fires — an install that reports
      success and does nothing.
    - Contract: the keys are exactly as git-ai's own installer source declares them.
    */
    expect(spec(agent as string).events).toEqual({ pre, post });
  });

  it('the three casings are genuinely different — not all Pascal by accident', () => {
    const distinct = new Set(AGENT_MATRIX.flatMap((s) => s.events.pre));
    expect(distinct).toEqual(
      // windsurf's two cascade events are a FOURTH shape — not a casing variant of
      // ToolUse at all (`windsurf.rs:17-23`). See the events field doc.
      new Set(['PreToolUse', 'preToolUse', 'BeforeTool', 'pre_write_code', 'pre_run_command']),
    );
  });
});

describe('windsurf writes TWO files (dw-000e)', () => {
  it('both ~/.codeium paths are in the matrix and both resolve', () => {
    /*
    Test Doc:
    - Why: an agent modelled as one config file installs half of windsurf's hooks
      and reports success. The second path is easy to drop precisely because every
      other Strategy A agent has exactly one.
    - Contract: two files, at the measured paths.
    */
    expect(resolveConfigFiles(spec('windsurf'), '/home/dev', noEnv)).toEqual([
      '/home/dev/.codeium/hooks.json',
      '/home/dev/.codeium/windsurf/hooks.json',
    ]);
  });

  it('windsurf is the ONLY multi-file agent — so a single-file assumption would pass elsewhere', () => {
    const multi = AGENT_MATRIX.filter((s) => s.configFiles.length > 1).map((s) => s.agent);
    expect(multi).toEqual(['windsurf']);
  });
});

describe('every Strategy A agent resolves to its measured path', () => {
  it.each([
    ['claude-code', '/home/dev/.claude/settings.json'],
    ['cursor', '/home/dev/.cursor/hooks.json'],
    ['gemini', '/home/dev/.gemini/settings.json'],
    ['droid', '/home/dev/.factory/settings.json'],
    ['firebender', '/home/dev/.firebender/hooks.json'],
    ['github-copilot', '/home/dev/.copilot/hooks/harness.json'],
  ])('%s -> %s', (agent, expected) => {
    expect(resolveConfigFiles(spec(agent), '/home/dev', noEnv)).toEqual([expected]);
  });

  it('resolves under the INJECTED home, never an ambient one', () => {
    for (const s of AGENT_MATRIX) {
      for (const file of resolveConfigFiles(s, '/injected', noEnv)) {
        expect(file.startsWith('/injected/')).toBe(true);
      }
    }
  });
});

describe('adding an agent is adding a ROW (dw-0010)', () => {
  it('a FAKE agent resolves fully with NO code change', () => {
    /*
    Test Doc:
    - Why: dw-0010. Reading the writer for `switch` statements proves less — a
      reviewer can miss a branch. A fake agent that resolves end-to-end using only
      the shared functions cannot be argued with.
    - Contract: a row invented here, never named anywhere in src/, resolves its
      paths, its events and its override with the same code every real agent uses.
    - Quality Contribution: if adding this row required touching anything other than
      the table, THAT would be the finding.
    */
    const fake: AgentSpec = {
      agent: 'totally-invented-agent',
      subdir: '.invented',
      configFiles: ['hooks.json', 'nested/more.json'],
      events: { pre: ['WhateverBefore'], post: ['WhateverAfter'] },
      entryShape: 'flat',
      supported: true,
      override: { name: 'INVENTED_HOME', kind: 'home-root' },
    };

    expect(resolveConfigFiles(fake, '/home/dev', noEnv)).toEqual([
      '/home/dev/.invented/hooks.json',
      '/home/dev/.invented/nested/more.json',
    ]);
    // And its override obeys the same asymmetry, from data alone.
    expect(resolveConfigRoot(fake, '/home/dev', env({ INVENTED_HOME: '/x' }))).toBe('/x/.invented');

    const verbatim: AgentSpec = {
      ...fake,
      override: { name: 'INVENTED_HOME', kind: 'config-dir' },
    };
    expect(resolveConfigRoot(verbatim, '/home/dev', env({ INVENTED_HOME: '/x' }))).toBe('/x');
  });

  it('the fake agent is NOT in the shipped matrix — the row proves the mechanism, not the table', () => {
    expect(findAgent('totally-invented-agent')).toBeUndefined();
  });
});

/**
 * THE PATH SHAPE THESE RESOLVERS EMIT (plan 083).
 *
 * WHY THIS DESCRIBE EXISTS AT ALL. Every row it covers passed on macOS for the
 * life of the feature and failed only on a Windows VM. `services/shared/posix-path.ts`
 * is the repo-wide rule — a path a service surfaces or compares is forward-slashed
 * on every OS, converted ONCE at the boundary where a native path enters — and this
 * resolver joined with `/` while never converting `home`, which arrives NATIVE from
 * `os.homedir()`. Windows therefore got a MIXED path,
 * `C:\Users\dev/.cursor/hooks.json`: neither shape, and a boundary never crossed.
 *
 * Node's fs accepts a mixed path, so every read and write worked and nothing failed
 * loudly. What broke was COMPARISON, which is invisible until something compares.
 *
 * NO `skipIf`, NO PLATFORM PARAMETER, AND THAT IS THE POINT. A logical path is the
 * same on every OS by construction, so a Windows-shaped `home` is just an input and
 * these rows assert exact literals from any host — including the gate that runs on
 * every push. A `skipIf(platform() !== 'win32')` would have re-created the defect
 * inside the instrument: green on the machine that cannot fail, mute on the one
 * that can.
 */
describe('the resolved path is LOGICAL — forward slashes, on every OS', () => {
  it('converts a NATIVE Windows home at the boundary, including multi-segment files', () => {
    /*
    Test Doc:
    - Why: `C:\Users\dev/.copilot/hooks/harness.json` is what the resolver actually
      produced. It is recorded as provenance and named in operator-facing failure
      text, so one config file had two spellings depending on which side of the
      boundary produced it.
    - Contract: one shape, forward slashes throughout — the drive letter kept, the
      backslashes converted, and the `/` already inside `hooks/harness.json` left
      alone.
    - Quality Contribution: asserts the FULL literal rather than
      `not.toContain('\\')`, so a resolver that converted only the home boundary and
      left a segment alone still goes red.
    */
    expect(resolveConfigFiles(spec('github-copilot'), 'C:\\Users\\dev', noEnv)).toEqual([
      'C:/Users/dev/.copilot/hooks/harness.json',
    ]);
    expect(resolveConfigFiles(spec('windsurf'), 'C:\\Users\\dev', noEnv)).toEqual([
      'C:/Users/dev/.codeium/hooks.json',
      'C:/Users/dev/.codeium/windsurf/hooks.json',
    ]);
  });

  it('a POSIX home is UNCHANGED — the counter-row that keeps this from being a rename', () => {
    /*
    Test Doc:
    - Why: a fix that made Windows right by moving the POSIX answer would trade one
      platform's defect for the other's. Every shipped macOS and Linux install
      resolves through this same function.
    - Contract: byte-identical to what the previous resolver emitted.
    */
    expect(resolveConfigFiles(spec('github-copilot'), '/home/dev', noEnv)).toEqual([
      '/home/dev/.copilot/hooks/harness.json',
    ]);
    expect(resolveConfigFiles(spec('windsurf'), '/home/dev', noEnv)).toEqual([
      '/home/dev/.codeium/hooks.json',
      '/home/dev/.codeium/windsurf/hooks.json',
    ]);
  });

  it('an env override crosses the SAME boundary, both kinds', () => {
    /*
    Test Doc:
    - Why: `config-dir` is the one branch that returns a value it did not join, so it
      is where a boundary conversion is most likely to stop halfway — and a
      `CLAUDE_CONFIG_DIR` a user typed with backslashes is exactly as native as
      `home`. `home-root` must convert AND append.
    - Contract: both kinds emit a fully logical path.
    - Quality Contribution: covers the verbatim branch, which joins nothing and so
      would silently pass through whatever shape it was handed.
    */
    expect(
      resolveConfigFiles(spec('gemini'), 'C:\\Users\\dev', env({ GEMINI_CLI_HOME: 'D:\\cfg' })),
    ).toEqual(['D:/cfg/.gemini/settings.json']);
    expect(
      resolveConfigFiles(
        spec('claude-code'),
        'C:\\Users\\dev',
        env({ CLAUDE_CONFIG_DIR: 'D:\\cfg' }),
      ),
    ).toEqual(['D:/cfg/settings.json']);
  });

  it('a lower-case drive letter is CANONICALISED — one key, not two', () => {
    /*
    Test Doc:
    - Why: these paths become dedupe keys and record entries. Windows treats `c:`
      and `C:` as the same drive, so two spellings of one home would enter a Set as
      two distinct files — the same duplication the home-relative strip guards
      against, arriving through case instead of through separators.
    - Contract: the drive letter is upper-cased, matching `toPosix`.
    */
    expect(resolveConfigFiles(spec('cursor'), 'c:\\Users\\dev', noEnv)).toEqual([
      'C:/Users/dev/.cursor/hooks.json',
    ]);
  });
});
