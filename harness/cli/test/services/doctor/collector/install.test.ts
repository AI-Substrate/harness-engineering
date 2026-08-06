import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../../src/adapters/clock/fake-clock.js';
import { FakeExec } from '../../../../src/adapters/exec/fake-exec.js';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import {
  FORBIDDEN_HOOK_ARGS,
  GITAI_PIN_CONFIG,
  INSTALL_HOOKS_DISCLOSURES,
  installCollector,
  recheckCollector,
} from '../../../../src/services/doctor/collector/install.js';
import { GITAI_PIN } from '../../../../src/services/doctor/collector/pin.js';
import { readCollectorState } from '../../../../src/services/doctor/collector/state.js';
import type { CollectorDeps } from '../../../../src/services/doctor/collector/types.js';
import {
  FakeCollectorFs,
  FakeDownload,
  FakeExecutableBit,
  FakePathKind,
  FakeSequencedExec,
  ok200,
} from '../../../support/collector-fakes.js';

/**
 * Plan 073 · ac-0007, ac-0008, ac-0009, ac-0013, ac-0014, ac-0010 — the two-stage
 * collector lifecycle.
 *
 * The behaviours under test are the ones that bite in production, not the happy
 * path: the config that must be written before the binary is ever executed, the
 * trace2 guard that runs before EVERY `install-hooks` (including re-checks), the
 * installer we must never invoke, and the partial state that must stay its own
 * reportable thing.
 */

const HOME = '/home/u';
const REPO = '/repo';
const NOW = '2026-08-06T10:00:00.000Z';
const BINARY = '/home/u/.git-ai/bin/git-ai';
const CONFIG = '/home/u/.git-ai/config.json';
const TRACE2_GET = 'git config --global --get-regexp ^trace2\\.';
/**
 * What git-ai's `configure_daemon_trace2` leaves in the GLOBAL config on a real
 * install (`install_hooks.rs:256-283`) — the presence of this key is the only
 * evidence the collector accepts that hooks actually went on.
 */
const GITAI_TRACE2 =
  'trace2.eventtarget af_unix:/home/u/.git-ai/internal/daemon/trace2.sock\ntrace2.eventnesting 5';
/** A trace2 read that answers EMPTY first (the guard) and git-ai's keys after. */
const TRACE2_EMPTY_THEN_INSTALLED = [
  { code: 1, stdout: '' },
  { code: 0, stdout: `${GITAI_TRACE2}\n` },
];
const PAYLOAD = new TextEncoder().encode('#!/bin/sh\necho git-ai\n');
const ARTIFACT_URL = `${GITAI_PIN.release_base_url}/${GITAI_PIN.version}/git-ai-macos-arm64`;

/**
 * The pin used by these tests: the SHIPPED pin with the macos-arm64 digest
 * swapped for the real digest of the fake payload, so the verification under
 * test is the production one rather than a stubbed comparison.
 */
function testPin() {
  const digest = new NodeHash().sha256Hex(PAYLOAD);
  return {
    ...GITAI_PIN,
    artifacts: {
      ...GITAI_PIN.artifacts,
      'macos-arm64': { file: 'git-ai-macos-arm64', sha256: digest },
    },
  } as typeof GITAI_PIN;
}

function deps(
  over: {
    fs?: FakeCollectorFs;
    exec?: FakeExec | FakeSequencedExec;
    paths?: FakePathKind;
    http?: FakeDownload;
    platform?: string;
    arch?: string;
  } = {},
): CollectorDeps & { fs: FakeCollectorFs; exec: FakeExec | FakeSequencedExec } {
  const fs = over.fs ?? new FakeCollectorFs();
  const exec =
    over.exec ??
    new FakeSequencedExec({
      // The guard read is EMPTY; the verification read afterwards shows git-ai's
      // own keys — which is what a successful `install-hooks` actually does.
      [TRACE2_GET]: TRACE2_EMPTY_THEN_INSTALLED,
      [`${BINARY} install-hooks`]: { code: 0, stdout: 'claude: installed\ncodex: installed\n' },
      [`${BINARY} status --json`]: { code: 0, stdout: '{"schema_version":"authorship/3.0.0"}' },
    });
  return {
    fs,
    exec,
    hash: new NodeHash(),
    paths: over.paths ?? new FakePathKind(),
    http: over.http ?? new FakeDownload({ [ARTIFACT_URL]: ok200(PAYLOAD) }),
    exe: new FakeExecutableBit(),
    clock: new FakeClock(NOW),
    host: { platform: over.platform ?? 'darwin', arch: over.arch ?? 'arm64', home: HOME },
    cwd: REPO,
    manifest: testPin(),
  };
}

describe('installCollector — stage 1 places a verified CLI and pins git-ai to it', () => {
  it('verifies, places, and disables git-ai’s auto-updater BEFORE any execution (ac-0007)', async () => {
    const d = deps();
    // Ordering is the guarantee, so observe it at the moment that matters: was
    // the pin config already on disk the first time the binary was executed? An
    // updater that fires once has already replaced the bytes we verified.
    const configPresentAtExec: boolean[] = [];
    const observing = {
      run: async (command: string, args: string[], opts: { cwd: string; timeoutMs?: number }) => {
        if (command === BINARY) configPresentAtExec.push(d.fs.exists(CONFIG));
        return d.exec.run(command, args, opts);
      },
    };

    const result = await installCollector({ ...d, exec: observing });

    expect(result.cli).toBe('installed');
    expect(d.fs.readText(CONFIG)).toContain('"disable_auto_updates": true');
    expect(JSON.parse(d.fs.readText(CONFIG) as string)).toMatchObject(GITAI_PIN_CONFIG);
    expect(configPresentAtExec.length).toBeGreaterThan(0);
    expect(configPresentAtExec.every(Boolean)).toBe(true);
  });

  it('preserves unrelated keys in an existing git-ai config', async () => {
    const fs = new FakeCollectorFs({ [CONFIG]: '{"custom_attributes":{"team":"platform"}}' });

    await installCollector(deps({ fs }));

    expect(JSON.parse(fs.readText(CONFIG) as string)).toEqual({
      custom_attributes: { team: 'platform' },
      disable_auto_updates: true,
      disable_version_checks: true,
    });
  });

  it('never invokes git-ai’s install.sh — hooks go on via install-hooks directly (ac-0009)', async () => {
    const d = deps();

    const result = await installCollector(d);

    const commands = d.exec.calls.map((call) => [call.command, ...call.args].join(' '));
    expect(commands.some((line) => line.includes('install.sh'))).toBe(false);
    expect(commands.some((line) => line.includes('curl') || line.includes('sh -c'))).toBe(false);
    expect(commands).toContain(`${BINARY} install-hooks`);
    // And it discloses what install-hooks still changes on its own.
    expect(result.disclosures).toEqual([...INSTALL_HOOKS_DISCLOSURES]);
    expect(result.disclosures.join(' ')).toContain('trace2');
    expect(result.disclosures.join(' ')).toContain('uninstall_skills');
  });

  it('never passes --skills, so it never links skills it would then remove', async () => {
    const d = deps();

    await installCollector(d);

    const hookCall = d.exec.calls.find((call) => call.args[0] === 'install-hooks');
    expect(hookCall?.args).toEqual(['install-hooks']);
  });

  it('re-uses an already-current binary instead of re-downloading it', async () => {
    const fs = new FakeCollectorFs();
    fs.seedBytes(BINARY, PAYLOAD);
    const http = new FakeDownload({});

    const result = await installCollector(deps({ fs, http }));

    expect(result.cli).toBe('already-current');
    expect(http.calls).toEqual([]);
  });

  it('reports an unsupported platform and installs NOTHING (ac-0017)', async () => {
    const d = deps({ platform: 'freebsd', arch: 'x64' });

    const result = await installCollector(d);

    expect(result.cli).toBe('unsupported-platform');
    expect(result.hooks).toBe('not-attempted');
    expect(d.exec.calls).toEqual([]);
    expect(d.fs.exists(BINARY)).toBe(false);
  });

  it('a failed download leaves hooks unattempted and records the cause', async () => {
    const d = deps({
      http: new FakeDownload({ [ARTIFACT_URL]: { ...ok200(PAYLOAD), status: 503 } }),
    });

    const result = await installCollector(d);

    expect(result.cli).toBe('failed');
    expect(result.hooks).toBe('not-attempted');
    expect(result.state.cli.detail).toContain('http-status');
    expect(d.exec.calls).toEqual([]);
  });
});

describe('installCollector — stage 2 is INDEPENDENT of stage 1 (ac-0013, ac-0014)', () => {
  it('a present trace2 config skips hooks WITHOUT touching the installed CLI', async () => {
    const exec = new FakeExec({
      [TRACE2_GET]: { code: 0, stdout: 'trace2.eventTarget /Users/x/.trace2\n' },
      [`${BINARY} status --json`]: { code: 0, stdout: '{"schema_version":"authorship/3.0.0"}' },
    });
    const d = deps({ exec });

    const result = await installCollector(d);

    // Stage 1 stands: verified, placed, config written.
    expect(result.cli).toBe('installed');
    expect(d.fs.exists(BINARY)).toBe(true);
    expect(d.fs.readText(CONFIG)).toContain('disable_auto_updates');
    // Stage 2 declined, and install-hooks was NEVER invoked.
    expect(result.hooks).toBe('skipped-trace2');
    expect(d.exec.calls.some((call) => call.args[0] === 'install-hooks')).toBe(false);
    expect(result.warnings.join(' ')).toContain('trace2');
    expect(result.manualInstructions.join('\n')).toContain('install-hooks');
  });

  it('records the trace2 observation on EVERY guard read — empty as well as present', async () => {
    const d = deps();

    await installCollector(d);
    const first = readCollectorState(d.fs, REPO);
    const guards = (state: typeof first) =>
      (state?.trace2 ?? []).filter((entry) => entry.phase === 'guard');
    expect(guards(first)).toHaveLength(1);
    expect(guards(first)[0]).toMatchObject({ observed: 'empty', entries: [], at: NOW });

    // A second run records a SECOND guard observation: not first-run-only. By
    // then git-ai's OWN two trace2 keys are in the global config — and that
    // BLOCKS, because a key name plus a local record cannot prove a machine-wide
    // git value is still ours to delete (round 2 P0). The operator is told.
    await installCollector(d);
    const second = readCollectorState(d.fs, REPO);
    expect(guards(second)).toHaveLength(2);
    expect(guards(second).map((entry) => entry.observed)).toEqual(['present', 'empty']);
    expect(guards(second)[0]?.entries.join(' ')).toContain('trace2.eventtarget');
    expect(second?.hooks.status).toBe('skipped-trace2');
  });

  /**
   * The reverted exception, kept as a live guard against its return: after a
   * VERIFIED install of our own, a second pass over git-ai's own keys still does
   * not invoke `install-hooks` (phase-1 review, round 2 P0).
   */
  it('a verified prior install does NOT buy a re-install over git-ai’s own keys', async () => {
    const d = deps();
    await installCollector(d);
    expect(readCollectorState(d.fs, REPO)?.hooks.status).toBe('installed');
    const before = d.exec.calls.filter((call) => call.args[0] === 'install-hooks').length;

    const second = await installCollector(d);

    expect(second.hooks).toBe('skipped-trace2');
    expect(d.exec.calls.filter((call) => call.args[0] === 'install-hooks')).toHaveLength(before);
    expect(second.manualInstructions.join('\n')).toContain('install-hooks');
  });

  it('an unreadable trace2 config fails closed — hooks are not installed', async () => {
    const exec = new FakeExec({
      [TRACE2_GET]: { code: 128, stderr: 'fatal: unreadable' },
      [`${BINARY} status --json`]: { code: 0, stdout: '' },
    });
    const d = deps({ exec });

    const result = await installCollector(d);

    expect(result.cli).toBe('installed');
    expect(result.hooks).toBe('skipped-trace2');
    expect(readCollectorState(d.fs, REPO)?.trace2[0]?.observed).toBe('unknown');
  });

  it('a failing install-hooks is reported without unwinding the CLI install', async () => {
    const exec = new FakeExec({
      [TRACE2_GET]: { code: 1, stdout: '' },
      [`${BINARY} install-hooks`]: { code: 2, stderr: 'daemon unreachable' },
      [`${BINARY} status --json`]: { code: 0, stdout: '' },
    });
    const d = deps({ exec });

    const result = await installCollector(d);

    expect(result.cli).toBe('installed');
    expect(result.hooks).toBe('failed');
    expect(d.fs.exists(BINARY)).toBe(true);
  });
});

describe('installCollector — the note schema is asserted after install (ac-000f)', () => {
  it('records a match when git-ai reports the pinned schema', async () => {
    const d = deps();

    const result = await installCollector(d);

    expect(result.state.note_schema).toEqual({
      expected: 'authorship/3.0.0',
      observed: 'authorship/3.0.0',
      status: 'match',
    });
    expect(result.warnings.join(' ')).not.toContain('note schema');
  });

  it('warns on a mismatch, so binary drift and format drift are reviewed together', async () => {
    const exec = new FakeExec({
      [TRACE2_GET]: { code: 1, stdout: '' },
      [`${BINARY} install-hooks`]: { code: 0, stdout: 'claude: installed\n' },
      [`${BINARY} status --json`]: { code: 0, stdout: '{"schema_version":"authorship/4.0.0"}' },
    });

    const result = await installCollector(deps({ exec }));

    expect(result.state.note_schema).toMatchObject({
      observed: 'authorship/4.0.0',
      status: 'mismatch',
    });
    expect(result.warnings.join(' ')).toContain('authorship/4.0.0');
  });

  it('records `unknown` — never a pass — when the schema cannot be read', async () => {
    const exec = new FakeExec({
      [TRACE2_GET]: { code: 1, stdout: '' },
      [`${BINARY} install-hooks`]: { code: 0, stdout: 'claude: installed\n' },
      [`${BINARY} status --json`]: { code: 1, stdout: '' },
    });

    const result = await installCollector(deps({ exec }));

    expect(result.state.note_schema).toMatchObject({ observed: null, status: 'unknown' });
  });
});

describe('recheckCollector — a new coding harness is detected and reported (ac-0010)', () => {
  it('is quiet when every detected agent is already hooked', async () => {
    const fs = new FakeCollectorFs();
    fs.mkdirp(`${HOME}/.claude`);
    fs.mkdirp(`${HOME}/.codex`);
    const d = deps({ fs });
    await installCollector(d);

    const recheck = await recheckCollector(d);

    expect(recheck.newAgents).toEqual([]);
    expect(recheck.warnings).toEqual([]);
  });

  it('detects a harness installed AFTER the hooks went on, and re-runs the guard', async () => {
    const fs = new FakeCollectorFs();
    fs.mkdirp(`${HOME}/.claude`);
    fs.mkdirp(`${HOME}/.codex`);
    const d = deps({ fs });
    await installCollector(d);

    // Cursor arrives in July; nothing on the machine says its edits are unattributed.
    fs.mkdirp(`${HOME}/.cursor`);
    const recheck = await recheckCollector(d);

    expect(recheck.newAgents).toEqual(['cursor']);
    expect(recheck.warnings.join(' ')).toContain('Cursor');
    // The new agent is REPORTED, but the hooks are not re-installed for it:
    // git-ai's own keys are in the global config by now, and observed-empty is
    // the sole automatic path (round 2 P0). The operator gets instructions.
    expect(recheck.hooks).toBe('skipped-trace2');
    expect(recheck.manualInstructions.join('\n')).toContain('install-hooks');
    // The guard ran AGAIN — git-ai re-applies the trace2 removal every time.
    const trace2Reads = d.exec.calls.filter((call) => call.args.includes('--get-regexp'));
    expect(trace2Reads.length).toBeGreaterThanOrEqual(2);
  });

  it('a re-check on a machine whose trace2 is someone ELSE’s refuses too', async () => {
    const fs = new FakeCollectorFs();
    fs.mkdirp(`${HOME}/.claude`);
    const exec = new FakeSequencedExec({
      [TRACE2_GET]: TRACE2_EMPTY_THEN_INSTALLED,
      [`${BINARY} install-hooks`]: { code: 0, stdout: 'claude: installed\n' },
      [`${BINARY} status --json`]: { code: 0, stdout: '{"schema_version":"authorship/3.0.0"}' },
    });
    const d = deps({ fs, exec });
    await installCollector(d);

    // The scenario that killed the exception: we installed, THEN the operator
    // set up trace2 for their own tooling, then installed Gemini. Nothing local
    // can tell that config apart from the one we left behind — so the guard
    // blocks on both, exactly as on a machine we had never touched.
    fs.mkdirp(`${HOME}/.gemini`);
    const guarded = new FakeExec({
      [TRACE2_GET]: { code: 0, stdout: 'trace2.normalTarget /tmp/trace\n' },
    });
    const recheck = await recheckCollector({ ...d, exec: guarded });

    expect(recheck.newAgents).toEqual(['gemini']);
    expect(recheck.hooks).toBe('skipped-trace2');
    expect(guarded.calls.some((call) => call.args[0] === 'install-hooks')).toBe(false);
  });
});

/**
 * Live-dogfood findings, 2026-08-06 (`assets/research/dogfood-live-install.md`).
 *
 * These are not hypotheses; they were walked into on a real machine. The sharpest
 * one: `git ai install-hooks --help` performed a FULL, silent, machine-wide
 * install, because `parse_install_options` ends in `_ => {}`. Every near-miss
 * spelling of `--dry-run` does the same. **Their safety flag fails open**, so the
 * collector never uses one — and never trusts an exit code about what happened to
 * the global config either.
 */
describe('the dogfood hazards are encoded, not remembered', () => {
  it('passes NO argument that could fail open into a real install', async () => {
    const d = deps();

    await installCollector(d);

    const hookCalls = d.exec.calls.filter((call) => call.args[0] === 'install-hooks');
    expect(hookCalls).toHaveLength(1);
    expect(hookCalls[0]?.args).toEqual(['install-hooks']);
    for (const forbidden of FORBIDDEN_HOOK_ARGS) {
      expect(hookCalls[0]?.args).not.toContain(forbidden);
    }
  });

  it('no collector source file passes a dry-run or help spelling to git-ai', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const collector = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../src/services/doctor/collector',
    );

    // Scan the ARGUMENT ARRAYS of every exec call in the collector, not the file
    // text: the forbidden spellings are legitimately NAMED in the constant and in
    // the prose that explains why they are dangerous. What must never happen is
    // one of them reaching git-ai as an argument.
    const argArrays: string[] = [];
    for (const name of readdirSync(collector).filter((file) => file.endsWith('.ts'))) {
      const source = readFileSync(join(collector, name), 'utf8');
      for (const match of source.matchAll(/exec\.run\([^,]+,\s*(\[[^\]]*\])/g)) {
        if (match[1] !== undefined) argArrays.push(match[1]);
      }
    }

    expect(argArrays.length).toBeGreaterThan(0);
    for (const args of argArrays) {
      for (const forbidden of FORBIDDEN_HOOK_ARGS) {
        expect(args).not.toContain(`'${forbidden}'`);
      }
    }
  });

  it('verifies the trace2 outcome by RE-READING the config, not from the exit code', async () => {
    const exec = new FakeExec({
      [TRACE2_GET]: { code: 1, stdout: '' },
      [`${BINARY} install-hooks`]: { code: 0, stdout: 'claude: installed\n' },
      [`${BINARY} status --json`]: { code: 0, stdout: '{"schema_version":"authorship/3.0.0"}' },
    });
    const d = deps({ exec });

    const result = await installCollector(d);

    // Two reads: the guard before, the verification after.
    const reads = d.exec.calls.filter((call) => call.args.includes('--get-regexp'));
    expect(reads).toHaveLength(2);
    const phases = result.state.trace2.map((entry) => entry.phase);
    expect(phases).toContain('guard');
    expect(phases).toContain('post-install');
  });

  it('says out loud that already-running agents stay uninstrumented until restart', async () => {
    const result = await installCollector(deps());

    expect(result.state.hooks.detail).toContain('restart');
    expect(result.disclosures.join(' ')).toContain('already running');
  });

  it('discloses the reach it cannot narrow: no per-agent selector, and a VS Code extension', () => {
    const disclosures = INSTALL_HOOKS_DISCLOSURES.join(' ');

    expect(disclosures).toContain('CANNOT be scoped to chosen agents');
    expect(disclosures).toContain('VS Code extension');
    expect(disclosures).toContain('Code-Insiders');
  });
});

/**
 * P1 of the phase-1 review — the post-install verification must DECIDE, not just
 * be recorded.
 *
 * The defect this pins was subtle and exactly the kind the dogfood existed to
 * prevent: the code re-read the global trace2 config after `install-hooks`,
 * wrote the observation into state, and then set `hooks: 'installed'` on the
 * strength of a zero exit anyway. Since git-ai's argument parser ends in
 * `_ => {}` it exits zero for invocations it never understood, so a zero exit is
 * not evidence of anything. Evidence recorded and then ignored is not evidence.
 */
describe('a zero exit is NOT proof that hooks were installed', () => {
  const statusOk = { code: 0, stdout: '{"schema_version":"authorship/3.0.0"}' };

  it('an EMPTY post-install read means unverified — never installed', async () => {
    // Guard reads empty, install-hooks exits 0, and the config it ALWAYS writes
    // on a real install is still not there. Nothing was hooked.
    const exec = new FakeSequencedExec({
      [TRACE2_GET]: { code: 1, stdout: '' },
      [`${BINARY} install-hooks`]: { code: 0, stdout: 'claude: installed\n' },
      [`${BINARY} status --json`]: statusOk,
    });
    const d = deps({ exec });

    const result = await installCollector(d);

    expect(result.cli).toBe('installed');
    expect(result.hooks).toBe('unverified');
    expect(readCollectorState(d.fs, REPO)?.hooks.status).toBe('unverified');
    expect(readCollectorState(d.fs, REPO)?.hooks.agents).toEqual([]);
    expect(result.warnings.join(' ')).toContain('trace2.eventtarget');
  });

  it('an UNREADABLE post-install read means unverified — absent evidence is not good news', async () => {
    const exec = new FakeSequencedExec({
      [TRACE2_GET]: [
        { code: 1, stdout: '' },
        { code: 128, stderr: 'fatal: unreadable' },
      ],
      [`${BINARY} install-hooks`]: { code: 0, stdout: 'claude: installed\n' },
      [`${BINARY} status --json`]: statusOk,
    });

    const result = await installCollector(deps({ exec }));

    expect(result.hooks).toBe('unverified');
    expect(result.warnings.join(' ')).toContain('UNVERIFIED');
  });

  it('a post-install read carrying SOMEONE ELSE’S keys is not our install either', async () => {
    const exec = new FakeSequencedExec({
      [TRACE2_GET]: [
        { code: 1, stdout: '' },
        { code: 0, stdout: 'trace2.normalTarget /tmp/trace\n' },
      ],
      [`${BINARY} install-hooks`]: { code: 0, stdout: 'claude: installed\n' },
      [`${BINARY} status --json`]: statusOk,
    });

    const result = await installCollector(deps({ exec }));

    expect(result.hooks).toBe('unverified');
  });

  it('records `installed` ONLY when git-ai’s own trace2 key is there afterwards', async () => {
    const result = await installCollector(deps());

    expect(result.hooks).toBe('installed');
    expect(result.state.hooks.detail).toContain('verified by re-reading');
  });
});

/**
 * The SKILLS precondition guard (phase-1 review ruling).
 *
 * git-ai deletes its three skill links when invoked without `--skills` and
 * overwrites them when invoked with it, so neither constant is safe. The guard
 * makes the destructive path unreachable: inspect the nine paths, and if any
 * holds real content, do not invoke `install-hooks` at all.
 */
describe('the skills guard declines to destroy rather than choosing a destruction', () => {
  it('does NOT invoke install-hooks when a real directory sits at a skill path', async () => {
    const paths = new FakePathKind({ [`${HOME}/.claude/skills/ask`]: 'directory' });
    const d = deps({ paths });

    const result = await installCollector(d);

    expect(result.cli).toBe('installed');
    expect(result.hooks).toBe('skipped-skills');
    expect(d.exec.calls.some((call) => call.args[0] === 'install-hooks')).toBe(false);
    expect(result.warnings.join(' ')).toContain('/.claude/skills/ask');
    expect(result.manualInstructions.join('\n')).toContain('install-hooks');
  });

  it('treats a symlink or an absent path as git-ai’s own territory and proceeds', async () => {
    const paths = new FakePathKind({
      [`${HOME}/.claude/skills/ask`]: 'symlink',
      [`${HOME}/.cursor/skills/git-ai-search`]: 'symlink',
    });
    const d = deps({ paths });

    const result = await installCollector(d);

    expect(result.hooks).toBe('installed');
    expect(d.exec.calls.some((call) => call.args[0] === 'install-hooks')).toBe(true);
  });

  it('honours CLAUDE_CONFIG_DIR, because git-ai does', async () => {
    // Guarding ~/.claude on a machine whose Claude config lives elsewhere would
    // report safety about a directory git-ai never touches — worse than no guard.
    const paths = new FakePathKind({ '/home/u/.claude-alt/skills/prompt-analysis': 'directory' });
    const d = deps({ paths });
    const result = await installCollector({
      ...d,
      host: { ...d.host, claudeConfigDir: '/home/u/.claude-alt' },
    });

    expect(result.hooks).toBe('skipped-skills');
    expect(result.warnings.join(' ')).toContain('.claude-alt/skills/prompt-analysis');
  });

  it('treats an unclassifiable path as content — never as free space', async () => {
    const paths = new FakePathKind({ [`${HOME}/.agents/skills/git-ai-search`]: 'unknown' });

    const result = await installCollector(deps({ paths }));

    expect(result.hooks).toBe('skipped-skills');
  });
});
