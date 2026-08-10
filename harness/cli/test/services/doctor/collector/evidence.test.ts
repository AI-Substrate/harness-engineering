import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../../src/adapters/clock/fake-clock.js';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import { AGENT_MARKERS } from '../../../../src/services/doctor/collector/agents.js';
import {
  agentEvidence,
  snapshotAgentConfigs,
} from '../../../../src/services/doctor/collector/evidence.js';
import { GITAI_PIN } from '../../../../src/services/doctor/collector/pin.js';
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
 * Plan 077 — WHICH AGENTS DID `install-hooks` ACTUALLY HOOK?
 *
 * The Windows run of 2026-08-09 reported six agents hooked on a machine where
 * three were verifiable, one was present with no git-ai content anywhere in its
 * tree, and two had no directory at all. The sentence carrying that list said
 * "verified by re-reading the global trace2 config" — a check that is real and
 * that establishes ONE machine-wide fact, with no power to tell one agent from
 * another.
 *
 * These tests drive the replacement: a per-agent measurement, and an explicit
 * refusal to convert its silence into a negative claim.
 */

const ESC = String.fromCharCode(27);
const HOME = '/home/u';
const REPO = '/repo';

function deps(fs: FakeCollectorFs): CollectorDeps {
  return {
    fs,
    paths: new FakePathKind({}),
    hash: new NodeHash(),
    http: new FakeDownload({}),
    exec: new FakeSequencedExec({}),
    exe: new FakeExecutableBit(),
    clock: new FakeClock('2026-08-09T00:00:00.000Z'),
    host: { platform: 'darwin', arch: 'arm64', home: HOME },
    cwd: REPO,
    manifest: GITAI_PIN,
  };
}

describe('evidence is a MEASUREMENT, not a relay of what git-ai said', () => {
  it('evidences an agent whose config file CHANGED across the invocation', () => {
    const fs = new FakeCollectorFs();
    fs.mkdirp(`${HOME}/.claude`);
    fs.writeText(`${HOME}/.claude/settings.json`, '{"before":true}');
    const d = deps(fs);

    const before = snapshotAgentConfigs(d);
    fs.writeText(`${HOME}/.claude/settings.json`, '{"hooks":{"git-ai":true}}');

    expect(agentEvidence(d, before, ['claude']).evidenced).toEqual(['claude']);
  });

  it('evidences an agent whose config file was CREATED — the case the backup cannot see', () => {
    // THE COPILOT CASE, and the reason the backup manifest was not reused as the
    // instrument. git-ai created `.copilot/hooks/git-ai.json` fresh on the
    // Windows box; a backup can only copy files that already exist, so it is
    // silent about the single clearest example of a genuine install.
    const fs = new FakeCollectorFs();
    fs.mkdirp(`${HOME}/.copilot`);
    const d = deps(fs);

    const before = snapshotAgentConfigs(d);
    fs.writeText(`${HOME}/.copilot/hooks/git-ai.json`, '{"hooks":[]}');

    expect(agentEvidence(d, before, ['copilot']).evidenced).toEqual(['copilot']);
  });

  it('does NOT evidence an agent nothing was written for, and does NOT call it unhooked', () => {
    // The pi case from the Windows run: present, named, no git-ai content found.
    // Three different things produce this silence and only one is a defect, so
    // the output is "could not evidence" — never "not installed".
    const fs = new FakeCollectorFs();
    fs.mkdirp(`${HOME}/.pi`);
    const d = deps(fs);

    const evidence = agentEvidence(d, snapshotAgentConfigs(d), ['pi']);

    expect(evidence.evidenced).toEqual([]);
    expect(evidence.claimedOnly).toEqual(['pi']);
    expect(evidence.detail).toContain('not proof they are unhooked');
    expect(evidence.detail).not.toMatch(/\bnot installed\b/);
  });

  it('reports a name we cannot place at all rather than dropping it', () => {
    // droid and windsurf on the Windows box: named, with no directory anywhere.
    // Whatever the cause, the name must survive into the operator's line — a
    // list that silently shrinks to the agents we happen to understand is how a
    // six-vs-three discrepancy goes unnoticed in the first place.
    const fs = new FakeCollectorFs();
    const d = deps(fs);

    const evidence = agentEvidence(d, snapshotAgentConfigs(d), ['droid', 'windsurf']);

    expect(evidence.claimedOnly).toEqual(['droid', 'windsurf']);
    expect(evidence.detail).toContain('droid');
    expect(evidence.detail).toContain('windsurf');
  });

  it('an UNCHANGED file is not evidence — the no-op re-run reads as unconfirmed', () => {
    // git-ai returns Ok(None) and writes nothing when content already matches.
    // That is a legitimate outcome, and it is indistinguishable from a miss.
    const fs = new FakeCollectorFs();
    fs.mkdirp(`${HOME}/.claude`);
    fs.writeText(`${HOME}/.claude/settings.json`, '{"same":true}');
    const d = deps(fs);

    const before = snapshotAgentConfigs(d);

    expect(agentEvidence(d, before, ['claude']).evidenced).toEqual([]);
  });

  it('an agent NOT DETECTED before the run cannot support a change claim', () => {
    // The phantom-marker family: git-ai creates `~/.copilot` during its own hooks
    // run, so a post-install marker scan reports agents the user never installed.
    // Evidence is anchored to the PRE-install snapshot for exactly that reason —
    // a directory that appeared during the run is not proof of an agent.
    const fs = new FakeCollectorFs();
    const d = deps(fs);
    const before = snapshotAgentConfigs(d);

    fs.mkdirp(`${HOME}/.copilot`);
    fs.writeText(`${HOME}/.copilot/hooks/git-ai.json`, '{"hooks":[]}');

    expect(agentEvidence(d, before, ['copilot']).evidenced).toEqual([]);
  });

  it('a snapshot that could not be taken yields NO evidence, never a false negative', () => {
    // A read failure must not read as "nothing changed", which would render a
    // fully-hooked machine as a fleet of unhooked agents.
    const hostile = {
      exists() {
        throw new Error('fs down');
      },
    } as unknown as FakeCollectorFs;
    const d = deps(hostile);

    const before = snapshotAgentConfigs(d);

    expect(before.digests.size).toBe(0);
    expect(agentEvidence(d, before, ['claude']).evidenced).toEqual([]);
  });
});

describe('the path table is version-bound, and says so when the pin moves', () => {
  it('every declared path is home-relative and non-empty', () => {
    // Cheap structural guard on hand-transcribed data: an absolute path or a
    // stray leading slash would silently miss on every machine.
    for (const agent of AGENT_MARKERS) {
      for (const rel of agent.configs) {
        expect(rel.startsWith('/')).toBe(false);
        expect(rel.length).toBeGreaterThan(0);
      }
    }
  });

  it('no two agents claim the same config file', () => {
    // A shared path would make one agent's write evidence for another.
    const seen = new Map<string, string>();
    for (const agent of AGENT_MARKERS) {
      for (const rel of agent.configs) {
        expect(seen.get(rel)).toBeUndefined();
        seen.set(rel, agent.id);
      }
    }
  });
});

/**
 * THE WINDOWS RUN, END TO END THROUGH THE REAL LIFECYCLE.
 *
 * The tests above drive `agentEvidence` directly, and that turned out not to be
 * enough: a mutation replacing the recorded agent list with the CLAIM — the exact
 * defect this work removes — passed the entire 387-test suite. Every fixture had
 * git-ai writing files for precisely the agents it named, so claimed and
 * evidenced could never disagree, and no test could tell which one was recorded.
 *
 * This reproduces the disagreement: git-ai names FOUR agents and writes for TWO.
 */
describe('installHooks records what it can evidence, not what git-ai named', () => {
  it('names four, writes two — the state records two and carries the other two as claims', async () => {
    const { installCollector } = await import(
      '../../../../src/services/doctor/collector/install.js'
    );
    const { readCollectorState } = await import(
      '../../../../src/services/doctor/collector/state.js'
    );
    const payload = new TextEncoder().encode('#!/bin/sh\necho git-ai\n');
    const digest = new NodeHash().sha256Hex(payload);
    const pin = {
      ...GITAI_PIN,
      artifacts: {
        ...GITAI_PIN.artifacts,
        'macos-arm64': { file: 'git-ai-macos-arm64', sha256: digest },
      },
    } as typeof GITAI_PIN;
    const binary = `${HOME}/.git-ai/bin/git-ai`;
    const url = `${GITAI_PIN.release_base_url}/${GITAI_PIN.version}/git-ai-macos-arm64`;

    const fs = new FakeCollectorFs();
    // FOUR agents present on the machine — this is what our marker scan sees.
    for (const marker of ['.claude', '.cursor', '.pi', '.factory']) fs.mkdirp(`${HOME}/${marker}`);

    const exec = new FakeSequencedExec(
      {
        // The viability probe (plan 082 · F007): this fixture must DECLARE that
        // the binary runs, because an unconfigured fake exits 0 in silence and
        // `installHooks` refuses that — deliberately, so a fixture that never
        // said the binary works breaks instead of quietly skipping the install.
        [`${binary} --version`]: { code: 0, stdout: 'git-ai 1.6.22' },
        // TWO reads on this path: the guard (EMPTY, which unlocks the install)
        // and the post-install verification (git-ai's own key, which is what
        // proves the vendor command really ran). A third entry here would leave
        // the verification reading EMPTY and record `unverified` — the fixture
        // would then be testing the wrong branch entirely.
        'git config --global --get-regexp ^trace2\\.': [
          { code: 1 },
          { code: 0, stdout: 'trace2.eventtarget af_unix:/tmp/s\n' },
        ],
        // git-ai claims all four…
        [`${binary} install-hooks`]: {
          code: 0,
          // COLOURED, because the real spinner is. `Spinner::success` wraps its
          // line in SGR codes and a ✓ glyph, so a parser tested only against
          // clean strings is tested against output the binary never produces —
          // the same mistake that made the previous parser dead on arrival.
          stdout: [
            `${ESC}[1;32m✓ Claude Code: Hooks updated${ESC}[0m`,
            `${ESC}[1;32m✓ Cursor: Hooks updated${ESC}[0m`,
            `${ESC}[1;32m✓ Pi: Hooks already up to date${ESC}[0m`,
            'Droid: Hooks updated',
          ].join('\n'),
        },
        [`${binary} status --json`]: { code: 0, stdout: '{"schema_version":"authorship/3.0.0"}' },
      },
      {
        // …and writes for only two of them.
        [`${binary} install-hooks`]: {
          [`${HOME}/.claude/settings.json`]: '{"hooks":{"git-ai":true}}',
          [`${HOME}/.cursor/hooks.json`]: '{"hooks":{"git-ai":true}}',
        },
      },
      fs,
    );

    await installCollector({
      ...deps(fs),
      exec,
      manifest: pin,
      http: new FakeDownload({ [url]: ok200(payload) }),
    });

    const state = readCollectorState(fs, REPO);

    // THE ASSERTION THAT KILLS THE MUTANT: the recorded list is the two we can
    // prove, not the four we were told.
    expect(state?.hooks.agents).toEqual(['claude', 'cursor']);
    expect(state?.hooks.claimed).toEqual(['claude', 'cursor', 'droid', 'pi']);
    expect(state?.hooks.detail).toContain('EVIDENCED');
    // And the two we could not confirm are still visible — never dropped, and
    // never asserted as unhooked.
    expect(state?.hooks.detail).toContain('droid');
    expect(state?.hooks.detail).toContain('pi');
    expect(state?.hooks.detail).toContain('not proof they are unhooked');
  });

  it('the unevidenced names do NOT become a reported coverage gap', async () => {
    // The regression the `claimed` field exists to prevent. Narrowing the
    // recorded list is right for the report and WRONG as an input to
    // `detected − covered`: it would turn every hooked-but-unevidenced agent into
    // "NOT instrumented", replacing an overclaim with an underclaim and driving
    // the automatic re-check to chase agents it already hooked.
    const { readCollectorHealth } = await import(
      '../../../../src/services/doctor/collector/health.js'
    );
    const { collectorStatePath, emptyCollectorState } = await import(
      '../../../../src/services/doctor/collector/state.js'
    );
    const payload = new TextEncoder().encode('#!/bin/sh\necho git-ai\n');
    const digest = new NodeHash().sha256Hex(payload);
    const pin = {
      ...GITAI_PIN,
      artifacts: {
        ...GITAI_PIN.artifacts,
        'macos-arm64': { file: 'git-ai-macos-arm64', sha256: digest },
      },
    } as typeof GITAI_PIN;
    const binary = `${HOME}/.git-ai/bin/git-ai`;

    const fs = new FakeCollectorFs();
    fs.seedBytes(binary, payload);
    for (const marker of ['.claude', '.pi']) fs.mkdirp(`${HOME}/${marker}`);
    const base = emptyCollectorState('2026-08-09T00:00:00.000Z', pin);
    fs.writeText(
      collectorStatePath(REPO),
      JSON.stringify({
        ...base,
        cli: {
          status: 'installed',
          path: binary,
          digest,
          verified_at: '2026-08-09T00:00:00.000Z',
          executable: true,
          detail: 'installed',
        },
        hooks: {
          status: 'installed',
          at: '2026-08-09T00:00:00.000Z',
          agents: ['claude'],
          claimed: ['claude', 'pi'],
          detail: 'evidenced claude',
        },
        note_schema: {
          expected: pin.expect_schema_version,
          observed: pin.expect_schema_version,
          status: 'match',
        },
      }),
    );

    const health = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: REPO,
      hash: new NodeHash(),
      manifest: pin,
    });

    // `pi` was claimed, so it is NOT a gap — but the row still says we could not
    // confirm it, so the honesty survives without the false alarm.
    expect(health.hooks.missing).toEqual([]);
    expect(health.verdict).not.toBe('hooks-incomplete');
    expect(health.detail).toContain('pi');
  });
});
