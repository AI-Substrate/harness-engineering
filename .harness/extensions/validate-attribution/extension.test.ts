import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import extension, {
  censusFrom,
  classifyCommand,
  journalSince,
  parseNoteBody,
  relayIdentity,
} from './extension.js';
import { commitSignalRelays } from './scoring.js';

/**
 * The I/O shell of `validate-attribution`. The VERDICTS are pinned in
 * `scoring.test.ts` against the two real control runs; this file pins the parsing
 * and classification that turn a machine into an `Evidence` object — which is where
 * a wrong answer would come from a right rule.
 */

describe('classifyCommand — the channel distinction, per segment', () => {
  it('classifies our own entry as a commit signal, by exact token', () => {
    expect(
      classifyCommand(
        '"/path/to/harness.js" hooks fire cursor --phase pre --hook-input stdin --hook-owner ai-substrate-harness-hook-v1',
      ),
    ).toBe('commit-signal');
  });

  it('classifies a bare `git-ai checkpoint` as CHANNEL 1, which never confounds a run', () => {
    /*
    Test Doc:
    - Why: channel 1 records what the agent wrote and cannot produce a note alone.
      Counting it as a competing relay would score every correctly configured
      machine INCONCLUSIVE — attribution NEEDS it.
    */
    expect(classifyCommand('/Users/x/.git-ai/bin/git-ai checkpoint cursor --hook-input stdin')).toBe(
      'checkpoint',
    );
  });

  it('THE COMPOUND CASE: an unknown segment beside a known one is UNKNOWN, not checkpoint', () => {
    /*
    Test Doc:
    - Why: this exact string is on the machine, and reading it as "just a checkpoint"
      is the conflation that nearly voided both control runs. One entry is not one
      tool's command; the worst segment has to win, or a stranger's script hides
      behind a recognisable neighbour.
    - Contract: the real POC chain classifies as `unknown` until acknowledged.
    */
    const real =
      'python3 /Users/x/scratch/attrib-probe/hook-probe.py PRE >/dev/null 2>&1; tee -a /tmp/cursor-hook-pre.jsonl | /Users/x/.git-ai/bin/git-ai checkpoint cursor --hook-input stdin';
    expect(classifyCommand(real)).toBe('unknown');
  });

  it('a marker inside a longer token is NOT ours', () => {
    expect(classifyCommand('node relay.js --hook-owner ai-substrate-harness-hook-v1-experimental')).toBe(
      'unknown',
    );
  });

  it('a chained foreign command beside OUR entry is still a commit signal', () => {
    expect(
      classifyCommand('other-tool --run && harness hooks fire cursor --hook-owner ai-substrate-harness-hook-v1'),
    ).toBe('unknown');
  });
});

describe('censusFrom — every entry, located and classified', () => {
  const config = JSON.stringify({
    hooks: {
      preToolUse: [
        { command: 'node /opt/poc/harness-commit-hook.mjs pre' },
        { command: '"/bin/harness.js" hooks fire cursor --hook-owner ai-substrate-harness-hook-v1' },
      ],
      postToolUse: [{ command: '/x/git-ai checkpoint cursor --hook-input stdin' }],
    },
  });

  it('names the source of every entry so a refusal can point at one', () => {
    const relays = censusFrom('~/.cursor/hooks.json', config, []);
    expect(relays.map((r) => r.source)).toEqual([
      '~/.cursor/hooks.json preToolUse[0]',
      '~/.cursor/hooks.json preToolUse[1]',
      '~/.cursor/hooks.json postToolUse[0]',
    ]);
    expect(relays.map((r) => r.channel)).toEqual(['unknown', 'commit-signal', 'checkpoint']);
    expect(relays.filter((r) => r.ours)).toHaveLength(1);
  });

  it('an acknowledgement is recorded against the entry it names, and only that one', () => {
    const relays = censusFrom('~/.cursor/hooks.json', config, ['harness-commit-hook.mjs']);
    expect(relays[0].acknowledged).toBe(true);
    expect(relays[2].acknowledged).toBe(false);
  });

  it('survives a config that is not JSON at all rather than throwing', () => {
    expect(censusFrom('~/x.json', '{ not json', [])).toEqual([]);
  });
});

describe('relayIdentity — a relay is a PROGRAM, not an entry', () => {
  it('keys PRE and POST of the same relay identically', () => {
    /*
    Test Doc:
    - Why: FOUND BY RUNNING IT, not by a test. The first real `--begin` on a live
      machine reported FOUR possible commit-signal relays where there were two:
      every agent config carries a pre entry and a post entry for the same relay.
      Counting entries makes a correctly configured machine look doubly confounded,
      and the census would then refuse every run anyone ever attempted.
    - Contract: phase is not part of a relay's identity.
    */
    const pre = '"/x/harness.js" hooks fire cursor --phase pre --hook-input stdin --hook-owner ai-substrate-harness-hook-v1';
    const post = '"/x/harness.js" hooks fire cursor --phase post --hook-input stdin --hook-owner ai-substrate-harness-hook-v1';
    expect(relayIdentity(pre)).toBe(relayIdentity(post));
  });

  it('keys a compound chain the same on both phases', () => {
    const pre = 'python3 /s/hook-probe.py PRE >/dev/null 2>&1; tee -a /tmp/a.jsonl | /x/git-ai checkpoint cursor';
    const post = 'python3 /s/hook-probe.py POST >/dev/null 2>&1; tee -a /tmp/b.jsonl | /x/git-ai checkpoint cursor';
    expect(relayIdentity(pre)).toBe(relayIdentity(post));
  });

  it('keeps DIFFERENT relays distinct', () => {
    expect(relayIdentity('node /opt/poc/harness-commit-hook.mjs pre')).not.toBe(
      relayIdentity('"/x/harness.js" hooks fire cursor --hook-owner ai-substrate-harness-hook-v1'),
    );
  });

  it('a real pre+post config counts ONE relay, not two', () => {
    /*
    Test Doc:
    - Why: the end-to-end form of the bug — this is what --begin actually computes.
    - Contract: a healthy single-relay machine is certifiable.
    */
    const config = JSON.stringify({
      hooks: {
        preToolUse: [
          { command: '"/x/harness.js" hooks fire cursor --phase pre --hook-input stdin --hook-owner ai-substrate-harness-hook-v1' },
        ],
        postToolUse: [
          { command: '"/x/harness.js" hooks fire cursor --phase post --hook-input stdin --hook-owner ai-substrate-harness-hook-v1' },
        ],
      },
    });
    const relays = censusFrom('~/.cursor/hooks.json', config, []);
    expect(relays).toHaveLength(2);
    expect(commitSignalRelays(relays)).toHaveLength(1);
  });
});

describe('journalSince — the run window', () => {
  const lines = [
    JSON.stringify({ at: '2026-08-09T21:30:00.000Z', phase: 'post', outcome: { kind: 'silent', reason: 'head-unchanged' } }),
    JSON.stringify({ at: '2026-08-09T21:41:43.527Z', phase: 'pre', outcome: { kind: 'recorded' } }),
    JSON.stringify({ at: '2026-08-09T21:41:55.233Z', phase: 'post', outcome: { kind: 'emitted', head: '5ac3eaa' } }),
  ].join('\n');

  it('keeps only entries strictly after the cursor', () => {
    const entries = journalSince(lines, '2026-08-09T21:30:00.000Z');
    expect(entries).toHaveLength(2);
    expect(entries[1].kind).toBe('emitted');
    expect(entries[1].head).toBe('5ac3eaa');
  });

  it('an absent journal is empty, not an error — "our hook never ran" is a verdict', () => {
    expect(journalSince(null, '')).toEqual([]);
  });

  it('skips unparsable lines instead of failing the whole read', () => {
    expect(journalSince(`${lines}\nnot json\n`, '')).toHaveLength(3);
  });
});

describe('parseNoteBody — identity, read off a REAL note', () => {
  // Verbatim from `git notes --ref=ai show 5ac3eaa` on the machine that ran control 10.
  const real = `AI2.md
  h_9e71e8b09f7cf2 4-11
seed.mjs
  s_1b36c35afd9ad7::t_7cfed781858af0 8
AI7.md
  s_1b36c35afd9ad7::t_a277ffed9b3787 1-3
jordan7.md
  h_9e71e8b09f7cf2 1-8
---
{
  "schema_version": "authorship/3.0.0"
}`;

  it('separates agent claims from human claims', () => {
    const claims = parseNoteBody(real);
    expect(claims).toEqual([
      { path: 'AI2.md', actor: 'human', lines: '4-11' },
      { path: 'seed.mjs', actor: 'session', lines: '8' },
      { path: 'AI7.md', actor: 'session', lines: '1-3' },
      { path: 'jordan7.md', actor: 'human', lines: '1-8' },
    ]);
  });

  it('stops at the JSON footer rather than parsing it as claims', () => {
    expect(parseNoteBody(real).some((c) => c.path.includes('schema_version'))).toBe(false);
  });

  it('an empty body yields no claims', () => {
    expect(parseNoteBody('')).toEqual([]);
  });
});

describe('the verb surface', () => {
  it('requires exactly one of --begin/--end, and says so', async () => {
    const ctx = fakeCtx({});
    const neither = await extension.run(ctx);
    expect(neither.status).toBe('error');
    expect(neither.error?.code).toBe('E_PHASE');

    const both = await extension.run(fakeCtx({ begin: true, end: true }));
    expect(both.status).toBe('error');
  });

  it('--end without a run record refuses instead of scoring nothing', async () => {
    const ctx = fakeCtx({ end: true, repo: '/nowhere' });
    const result = await extension.run(ctx);
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('E_NO_RUN');
    expect(result.next_action).toContain('--begin');
  });

  it('declares the docs it implements rather than re-explaining them', () => {
    expect(extension.description).toContain(
      'docs/how/telemetry/validating-telemetry-capture-in-sandboxed-agents.md',
    );
    expect(extension.description).toContain('gitai-06-two-channel-model.md');
    expect(extension.description).toContain('INCONCLUSIVE is first-class');
  });
});

describe('--begin counts what `commitSignalRelays` counts, and nothing else', () => {
  const configPath = '/home/fake/.cursor/hooks.json';
  const ours = (phase: string) =>
    `"/x/harness.js" hooks fire cursor --phase ${phase} --hook-input stdin --hook-owner ai-substrate-harness-hook-v1`;
  const config = JSON.stringify({
    hooks: { preToolUse: [{ command: ours('pre') }], postToolUse: [{ command: ours('post') }] },
  });

  it('a healthy single-relay machine is CERTIFIABLE — pre+post is one relay', async () => {
    /*
    Test Doc:
    - Why: THE ROW THAT WOULD HAVE CAUGHT THE REAL BUG. `--begin` computed its own
      inline copy of the census predicate, so it kept reporting four relays where
      there were two even AFTER de-duplication was written and unit-tested against
      `commitSignalRelays`. Two answers to one question, inside the verb whose whole
      job is counting relays — and every unit test passed, because they all asked
      the other answer.
    - Contract: --begin's reported count equals `commitSignalRelays`', on the same
      input, through the delivered surface.
    */
    const result = await extension.run(fakeCtx({ begin: true, repo: '/repo' }, { [configPath]: config }));
    const data = result.data as { possibleCommitSignalRelays: number; certifiable: boolean; relays: unknown[] };

    expect(data.relays).toHaveLength(2);
    expect(data.possibleCommitSignalRelays).toBe(1);
    expect(data.certifiable).toBe(true);
    expect(result.status).toBe('ok');
  });

  it('a second relay makes it NOT certifiable, and the refusal names it', async () => {
    const withPoc = JSON.stringify({
      hooks: {
        preToolUse: [{ command: ours('pre') }, { command: 'node /opt/poc/harness-commit-hook.mjs pre' }],
        postToolUse: [{ command: ours('post') }, { command: 'node /opt/poc/harness-commit-hook.mjs post' }],
      },
    });
    const result = await extension.run(fakeCtx({ begin: true, repo: '/repo' }, { [configPath]: withPoc }));
    const data = result.data as { possibleCommitSignalRelays: number; certifiable: boolean };

    expect(data.possibleCommitSignalRelays).toBe(2);
    expect(data.certifiable).toBe(false);
    expect(result.status).toBe('degraded');
    expect(result.next_action).toContain('never edit');
    expect(result.next_action).toContain('RESTART the agent');
    // Named in the payload, so the operator can see WHICH relay to decide about.
    const relays = (result.data as { relays: { command: string }[] }).relays;
    expect(relays.map((r) => r.command).join('\n')).toContain('harness-commit-hook.mjs');
  });

  it('--begin writes the probe and the run record, and NOTHING outside the repo', async () => {
    const ctx = fakeCtx({ begin: true, repo: '/repo' }, { [configPath]: config });
    await extension.run(ctx);
    expect(ctx.fs.readText('/repo/.harness-attribution-run.json')).not.toBeNull();
    expect(ctx.fs.readText('/repo/.harness-attribution-probe.py')).toContain('NOT the hook-side probe');
    // The probe must measure the SHELL, and say so on its face.
    expect(ctx.fs.readText('/repo/.harness-attribution-probe.py')).toContain('"context": "shell"');
  });
});

/**
 * THE DUPLICATION CHECK.
 *
 * `AGENT_CONFIGS` in the extension restates paths the core already knows, because
 * the single-source route (`harness hooks status --json`) calls `journal.compact()`
 * and would rewrite the journal this verb is about to baseline. Restating it is a
 * deliberate trade — and an unchecked restatement is the "two answers to one
 * question" defect this plan has already met three times. So it is MEASURED against
 * the core, in a fenced HOME, rather than assumed.
 */
describe('the agent-config map agrees with the core', () => {
  it('every path the core would write is a path this verb reads', () => {
    const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'harness', 'cli', 'bin', 'harness.js');
    const home = mkdtempSync(join(tmpdir(), 'harness-va-'));
    try {
      for (const marker of ['.cursor', '.claude', '.gemini', '.factory', '.firebender', '.copilot', '.codeium']) {
        mkdirSync(join(home, marker), { recursive: true });
      }
      const report = JSON.parse(
        execFileSync(process.execPath, [CLI, 'hooks', 'install', '--json'], {
          encoding: 'utf8',
          env: { ...process.env, HOME: home, USERPROFILE: home },
        }),
      ) as { installed: { agent: string; path: string }[] };

      const ours = new Set(Object.values(AGENT_CONFIGS_FOR_TEST).flatMap((paths) => paths));
      const core = report.installed.map((row) => row.path.slice(home.length + 1));
      for (const path of core) {
        expect(ours.has(path), `the core writes ${path}; the census map must read it`).toBe(true);
      }
      expect(core.length).toBeGreaterThan(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

/** Mirrors the extension's private map. Kept here so the assertion above is honest
 *  about comparing two independently written lists rather than a value to itself. */
const AGENT_CONFIGS_FOR_TEST: Record<string, string[]> = {
  cursor: ['.cursor/hooks.json'],
  'claude-code': ['.claude/settings.json'],
  gemini: ['.gemini/settings.json'],
  droid: ['.factory/settings.json'],
  firebender: ['.firebender/hooks.json'],
  'github-copilot': ['.copilot/hooks/harness.json'],
  windsurf: ['.codeium/hooks.json', '.codeium/windsurf/hooks.json'],
};

interface FakeOptions {
  begin?: boolean;
  end?: boolean;
  repo?: string;
  agent?: string;
  acknowledge?: string | string[];
}

function fakeCtx(
  options: FakeOptions,
  seed: Record<string, string> = {},
): Parameters<NonNullable<typeof extension.run>>[0] {
  const files = new Map<string, string>(Object.entries(seed));
  return {
    cwd: '/nowhere',
    args: {},
    options: options as Record<string, unknown>,
    // The home comes from the INJECTED env port, so a fixture can fence it without
    // the verb ever consulting the real machine.
    env: { get: (name: string) => (name === 'HOME' ? '/home/fake' : undefined) },
    async exec() {
      return { code: 1, stdout: '', stderr: '', ok: false };
    },
    fs: {
      exists: (path: string) => files.has(path),
      readText: (path: string) => files.get(path) ?? null,
      readdir: () => [],
      realpath: (path: string) => path,
    },
    fsWrite: {
      writeText: (path: string, contents: string) => {
        files.set(path, contents);
      },
      mkdirp: () => undefined,
      rename: () => undefined,
      copy: () => true,
      copyDir: () => true,
      mkdtemp: () => '/tmp/fake',
    },
  } as unknown as Parameters<NonNullable<typeof extension.run>>[0];
}
