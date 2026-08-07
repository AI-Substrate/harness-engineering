import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitAttribution } from '../../../src/adapters/git/fake-git-attribution.js';
import { FakeSocketProbe } from '../../../src/adapters/net/fake-socket-probe.js';
import type { ProbeOutcome } from '../../../src/adapters/net/socket-probe-port.js';
import { readIngress } from '../../../src/services/doctor/collector/ingress.js';
import type { VerbRegistry } from '../../../src/services/extensions/registry.js';
import {
  AGENTS_BLOCK_BEGIN,
  AGENTS_BLOCK_END,
  COMMIT_OUTCOME_GUIDANCE,
  COMMIT_OUTCOMES,
  CORE_INSTRUCTION_PAGES,
  type CommitOutcomeId,
  commitGuidanceBlock,
  injectAgentsBlock,
  NUDGE_PREREQUISITE,
  readAgentsBlock,
  renderRecovery,
} from '../../../src/services/instructions/commit-guidance.js';
import { loadVerbInstructions } from '../../../src/services/instructions/instructions-service.js';
import { FakeCollectorFs } from '../../support/collector-fakes.js';
import { PRE_075_BLOCK } from '../../support/pre-075-block.js';

/**
 * Plan 074 · ac-0008 — the two guidance seams.
 *
 * Seam 1: `harness instructions commit` resolves a CORE page. The instructions
 * surface previously resolved only extension-registry verbs, so a core verb
 * could carry no briefing at all.
 *
 * Seam 2: the `AGENTS.md` managed block — fenced markers, idempotent
 * inject/refresh, and a promise that never overclaims.
 */

const EMPTY: VerbRegistry = { verbs: [], records: [] };
const CWD = '/repo';
const SOCK = '/home/u/.git-ai/internal/daemon/trace2.sock';

describe('plan 074 · ac-0008 seam 1 — the instructions surface resolves a CORE page', () => {
  it('`instructions commit` resolves, with an EMPTY extension registry', () => {
    const outcome = loadVerbInstructions('commit', EMPTY, new FakeFs());

    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') throw new Error('expected ok');
    expect(outcome.instructions).toBe(CORE_INSTRUCTION_PAGES.commit);
    expect(outcome.path).toBe('(core)');
  });

  it('an unknown verb is still an honest unknown — the registration is additive', () => {
    expect(loadVerbInstructions('nope', EMPTY, new FakeFs()).kind).toBe('unknown-verb');
  });

  it('states the two safe shapes and the honest guarantee, without overclaiming', () => {
    const page = CORE_INSTRUCTION_PAGES.commit ?? '';

    expect(page).toContain('harness commit');
    expect(page).toContain('harness doctor telemetry-nudge');
    expect(page).toContain('can silently lose attribution');
    // The guarantee is "never silent", NOT "always delivered".
    expect(page).toContain('never SILENT about attribution');
    expect(page).toContain('**NOT guaranteed**: delivery');
  });
});

describe('plan 074 · ac-0008 seam 2 — the AGENTS.md managed block', () => {
  it('creates AGENTS.md with the fenced block when the file is absent', () => {
    const fs = new FakeFs();
    const outcome = injectAgentsBlock({ fs, cwd: CWD });

    expect(outcome).toEqual({ ok: true, path: '/repo/AGENTS.md', action: 'created' });
    const text = fs.readText('/repo/AGENTS.md') ?? '';
    expect(text).toContain(AGENTS_BLOCK_BEGIN);
    expect(text).toContain(AGENTS_BLOCK_END);
  });

  it('appends the block to an existing file, leaving prior content untouched', () => {
    const fs = new FakeFs({ '/repo/AGENTS.md': '# Agents\n\nHouse rules.\n' });
    const outcome = injectAgentsBlock({ fs, cwd: CWD });

    expect(outcome).toEqual({ ok: true, path: '/repo/AGENTS.md', action: 'inserted' });
    const text = fs.readText('/repo/AGENTS.md') ?? '';
    expect(text).toContain('House rules.');
    expect(text).toContain(commitGuidanceBlock());
  });

  it('is IDEMPOTENT — a second run changes nothing', () => {
    const fs = new FakeFs({ '# Agents': '' });
    injectAgentsBlock({ fs, cwd: CWD });
    const first = fs.readText('/repo/AGENTS.md');
    const second = injectAgentsBlock({ fs, cwd: CWD });

    expect(second).toEqual({ ok: true, path: '/repo/AGENTS.md', action: 'unchanged' });
    expect(fs.readText('/repo/AGENTS.md')).toBe(first);
  });

  it('REFRESHES a stale block in place, touching nothing outside the markers', () => {
    const stale = commitGuidanceBlock().replace('Committing in this repo', 'Ancient heading');
    const fs = new FakeFs({
      '/repo/AGENTS.md': `# Agents\n\nHouse rules.\n\n${stale}\n\nTrailing prose.\n`,
    });

    const outcome = injectAgentsBlock({ fs, cwd: CWD });

    expect(outcome).toEqual({ ok: true, path: '/repo/AGENTS.md', action: 'refreshed' });
    const text = fs.readText('/repo/AGENTS.md') ?? '';
    expect(text).toContain('House rules.');
    expect(text).toContain('Trailing prose.');
    expect(text).toContain(commitGuidanceBlock());
    expect(text).not.toContain('Ancient heading');
  });

  it('reads back the block state honestly', () => {
    const fs = new FakeFs();
    expect(readAgentsBlock({ fs, cwd: CWD })).toBe('no-file');

    fs.writeText('/repo/AGENTS.md', '# Agents\n');
    expect(readAgentsBlock({ fs, cwd: CWD })).toBe('absent');

    injectAgentsBlock({ fs, cwd: CWD });
    expect(readAgentsBlock({ fs, cwd: CWD })).toBe('current');

    fs.writeText('/repo/AGENTS.md', commitGuidanceBlock().replace('never silent', 'always fine'));
    expect(readAgentsBlock({ fs, cwd: CWD })).toBe('stale');
  });

  it('carries the same guarantee as the instructions page, and never claims delivery', () => {
    const block = commitGuidanceBlock();

    expect(block).toContain('harness commit');
    expect(block).toContain('silently lose attribution');
    expect(block).toContain('outcome is never silent');
    expect(block).toContain('Neither shape guarantees delivery');
    expect(block).toContain('harness instructions commit');
  });
});

describe('plan 076 — the outcome contract is ONE table, and both surfaces render from it', () => {
  /*
  Test Doc:
  - Why: `CommitMode` gained a fourth member in plan 075 and the managed block was
    left promising two outcomes, so a Windows agent was told to expect an outcome
    it cannot get and sent to a recovery command that refuses there. The words were
    wrong because the CONTRACT existed twice, in two hand-maintained prose copies.
  - Contract: one exported `Record<CommitMode, …>` table; both surfaces render the
    same outcome list from it; the mode→outcome collapse is declared, never inferred.
  - Quality Contribution: the compile error (ac-0002) is the real guard — these
    tests pin what the compiler cannot: that the rendered WORDS actually reach both
    surfaces, and that a future mode cannot be quietly folded into an existing outcome.
  */

  it('ac-0002/ac-0004 — the table is TOTAL over CommitMode, and the collapse is declared', () => {
    // The four modes are exactly commit-service's union. A fifth member fails
    // `tsc` at COMMIT_OUTCOME_GUIDANCE (Dim-0 evidence in the execution log) —
    // this assertion only pins the mapping the compiler cannot judge.
    expect(Object.keys(COMMIT_OUTCOME_GUIDANCE).sort()).toEqual([
      'direct-verified',
      'file-buffered',
      'harness-buffered',
      'ingress-unverified',
    ]);

    // The prose collapse is DECLARED: the two buffered modes name the same
    // outcome, and the other two do not share with anyone. A future mode folded
    // into an existing outcome has to change this line to do it.
    expect(COMMIT_OUTCOME_GUIDANCE['direct-verified'].outcome).toBe('verified');
    expect(COMMIT_OUTCOME_GUIDANCE['file-buffered'].outcome).toBe('buffered');
    expect(COMMIT_OUTCOME_GUIDANCE['harness-buffered'].outcome).toBe('buffered');
    expect(COMMIT_OUTCOME_GUIDANCE['ingress-unverified'].outcome).toBe('unverified');
  });

  it('ac-0003 — every outcome the table declares appears in BOTH surfaces', () => {
    const block = commitGuidanceBlock();
    const page = CORE_INSTRUCTION_PAGES.commit ?? '';

    // Iterating the TABLE, not a list of its own: an entry cannot be added and
    // silently omitted from either surface (the F011 lesson — a guard that checks
    // instances instead of the contract is false comfort).
    for (const id of Object.keys(COMMIT_OUTCOMES) as CommitOutcomeId[]) {
      const outcome = COMMIT_OUTCOMES[id];
      for (const text of [outcome.label, outcome.promise]) {
        expect(block).toContain(text);
        expect(page).toContain(text);
      }
      // The recovery reaches both surfaces too — rendered from the disposition,
      // never authored twice.
      const rendered = renderRecovery(outcome.recovery);
      expect(block).toContain(rendered);
      expect(page).toContain(rendered);
    }
    // Every mode's selecting condition reaches both surfaces too, so a reader can
    // tell WHICH outcome they got and not merely that the set has four members.
    for (const mode of Object.keys(
      COMMIT_OUTCOME_GUIDANCE,
    ) as (keyof typeof COMMIT_OUTCOME_GUIDANCE)[]) {
      expect(block).toContain(COMMIT_OUTCOME_GUIDANCE[mode].when);
      expect(page).toContain(COMMIT_OUTCOME_GUIDANCE[mode].when);
    }
  });

  it('review F002 — the nudge disposition is LOAD-BEARING: no authored string may name the verb', () => {
    /*
    Test Doc:
    - Why: round 1 declared `nudge` and never rendered it — a guard-shaped datum
      free to disagree with the prose beside it, which is the same false comfort
      the guarantee is supposed to remove.
    - Contract: the renderer is the ONLY writer of the verb's name. An author who
      hand-writes "run the nudge" into a promise fails here, so the disposition and
      the rendered instruction cannot drift apart.
    - Quality Contribution: converts an advertised-but-unenforced contract into an
      enforced one, without pretending the type system did it.
    */
    for (const id of Object.keys(COMMIT_OUTCOMES) as CommitOutcomeId[]) {
      const outcome = COMMIT_OUTCOMES[id];
      const { recovery } = outcome;
      const authored =
        recovery.nudge === 'drains-this'
          ? [recovery.before]
          : recovery.nudge === 'not-the-remedy'
            ? [recovery.instead, recovery.because]
            : [recovery.instead];
      for (const text of [outcome.label, outcome.promise, ...authored]) {
        expect(text).not.toContain('telemetry-nudge');
      }

      // …and the rendered instruction always follows the disposition.
      const rendered = renderRecovery(recovery);
      if (recovery.nudge === 'drains-this') {
        expect(rendered).toContain('Drain it with `harness doctor telemetry-nudge`');
        expect(rendered).toContain(NUDGE_PREREQUISITE);
      } else if (recovery.nudge === 'not-the-remedy') {
        expect(rendered).toContain('Do NOT run `harness doctor telemetry-nudge`');
        expect(rendered).not.toContain('Drain it with');
      } else {
        // `not-applicable` stays SILENT about the verb — it neither prescribes it
        // nor forbids it, because `harness commit`'s own next_action names it on a
        // verify miss and a blanket "Do NOT" here would contradict the code.
        expect(rendered).not.toContain('telemetry-nudge');
      }
    }
  });

  it('review F002 follow-on — the VERIFIED outcome does not contradict what `harness commit` itself tells a verify miss', () => {
    /*
    Test Doc:
    - Why: making `nudge` load-bearing naively would have rendered a blanket
      "Do NOT run the nudge" for `direct-verified`. But commit-service's verify-MISS
      branch names that very command in its own `next_action`. Guidance that
      contradicts the shipped command is the same overclaim in a new place.
    - Contract: the verified outcome uses the `not-applicable` arm — it states what
      to do and stays silent about the verb, so neither surface argues with the code.
    - Quality Contribution: pins the distinction so a later tidy-up cannot collapse
      three dispositions back into two and reintroduce the contradiction.
    */
    expect(COMMIT_OUTCOMES.verified.recovery.nudge).toBe('not-applicable');
    const rendered = renderRecovery(COMMIT_OUTCOMES.verified.recovery);
    expect(rendered).not.toContain('telemetry-nudge');
    expect(rendered).toContain('nothing to drain');
  });

  it('review F001 — the BUFFERED outcome states the POSIX prerequisite, so Windows readers are not sent to a nudge that refuses', () => {
    /*
    Test Doc:
    - Why: `runNudge()` returns `unsupported-platform` for EVERY win32 host before
      it reaches a replay path, so `file-buffered` and `harness-buffered` — both
      reachable on Windows — were handed a recovery command that drains nothing.
      We fixed the named-pipe branch's honesty and left this one lying.
    - Contract: the drainable outcome states the prerequisite UNCONDITIONALLY, in
      both surfaces. Not platform detection: this text is committed into an
      AGENTS.md that any OS may check out, so the rendering host is not the
      reading host and a `process.platform` branch would bake in the wrong answer.
    - Quality Contribution: pins the one sentence that makes the shared buffered
      promise true on every platform it can be read on.
    */
    const buffered = COMMIT_OUTCOMES.buffered;
    expect(buffered.recovery.nudge).toBe('drains-this');
    expect(NUDGE_PREREQUISITE).toContain('POSIX-ONLY');
    expect(NUDGE_PREREQUISITE).toContain('refuses on platform grounds and drains nothing');
    expect(NUDGE_PREREQUISITE).toContain('stay on disk');

    // Both Windows-reachable buffered modes collapse onto it, so both are covered.
    expect(COMMIT_OUTCOME_GUIDANCE['file-buffered'].outcome).toBe('buffered');
    expect(COMMIT_OUTCOME_GUIDANCE['harness-buffered'].outcome).toBe('buffered');

    for (const surface of [commitGuidanceBlock(), CORE_INSTRUCTION_PAGES.commit ?? '']) {
      expect(surface).toContain(NUDGE_PREREQUISITE);
    }
  });

  it('review R2-F001 — EVERY standalone recovery instruction carries the prerequisite, not just the outcome list', () => {
    /*
    Test Doc:
    - Why: round 2 fixed the outcome list and left the page's standalone RECOVERY
      block asserting that the verb "rotates the buffer" and "replays that segment"
      — both of which a win32 host returns before ever doing. Proximity to a correct
      list does not make an independent command recipe truthful: a reader can act on
      that block alone.
    - Contract: the page states the POSIX prerequisite at least twice (once with the
      buffered outcome, once with the standalone block), and every paragraph that
      asserts replay behaviour is qualified.
    - Quality Contribution: pins the invariant "the prerequisite travels with every
      recovery instruction", which is the general rule R2-F001 is one instance of.
    */
    const page = CORE_INSTRUCTION_PAGES.commit ?? '';

    const prerequisites = page.split(NUDGE_PREREQUISITE).length - 1;
    expect(prerequisites).toBeGreaterThanOrEqual(2);

    // The standalone block no longer promises unconditional replay.
    expect(page).toContain('RECOVERY, on a POSIX host.');
    expect(page).not.toContain('RECOVERY. Run it from an UNSANDBOXED shell.');

    // The replay assertion and the prerequisite are in the same section: the text
    // after the rotate/replay sentence still names the POSIX-only condition.
    const afterReplay = page.slice(page.indexOf('rotates the\nbuffer to a segment'));
    expect(afterReplay).toContain(NUDGE_PREREQUISITE);
  });

  it('ac-0001 — the block names the unverified outcome and does NOT offer the nudge as its remedy', () => {
    const block = commitGuidanceBlock();
    const unverified = COMMIT_OUTCOMES.unverified;

    expect(block).toContain('NOT VERIFIED');
    expect(block).toContain('nothing was buffered');
    // The remedy for a named-pipe reader is a git command they can actually run,
    // and an explicit "do NOT" on the one that refuses on their platform.
    expect(unverified.recovery.nudge).toBe('not-the-remedy');
    expect(block).toContain('Do NOT run `harness doctor telemetry-nudge`');
    expect(block).toContain('git notes --ref=ai show HEAD');
  });

  it('ac-0001 — the block no longer states or implies a two-member outcome set', () => {
    const block = commitGuidanceBlock();

    // The pre-075 sentence promised exactly two outcomes. Its absence is the fix.
    expect(block).not.toContain('either confirms a `refs/notes/ai` note landed or');
    expect(block).not.toBe(PRE_075_BLOCK);
  });

  it('ac-0007 — the markers are byte-exact, so blocks already in the wild are still found', () => {
    // Idempotency and stale-detection both hang off these two strings; changing
    // either orphans every block already injected into a consumer repo.
    expect(AGENTS_BLOCK_BEGIN).toBe('<!-- BEGIN harness:commit-guidance -->');
    expect(AGENTS_BLOCK_END).toBe('<!-- END harness:commit-guidance -->');
    expect(PRE_075_BLOCK.startsWith(AGENTS_BLOCK_BEGIN)).toBe(true);
    expect(PRE_075_BLOCK.endsWith(AGENTS_BLOCK_END)).toBe(true);
  });

  it('ac-0005/ac-0007 — a stale block refreshes in place with user content on BOTH sides intact', () => {
    const head = '# Agents\n\nHouse rules, above.\n\n';
    const tail = '\n\n## Local conventions\n\nHouse rules, below.\n';
    const fs = new FakeFs({ '/repo/AGENTS.md': `${head}${PRE_075_BLOCK}${tail}` });

    expect(readAgentsBlock({ fs, cwd: CWD })).toBe('stale');

    const first = injectAgentsBlock({ fs, cwd: CWD });
    expect(first).toEqual({ ok: true, path: '/repo/AGENTS.md', action: 'refreshed' });

    const text = fs.readText('/repo/AGENTS.md') ?? '';
    // BYTE-identical on both sides — the block owns the region between its fences
    // and nothing else.
    expect(text.slice(0, head.length)).toBe(head);
    expect(text.slice(text.length - tail.length)).toBe(tail);
    expect(text).toBe(`${head}${commitGuidanceBlock()}${tail}`);
    expect(readAgentsBlock({ fs, cwd: CWD })).toBe('current');

    // A second run is `unchanged` and writes nothing new.
    expect(injectAgentsBlock({ fs, cwd: CWD })).toEqual({
      ok: true,
      path: '/repo/AGENTS.md',
      action: 'unchanged',
    });
    expect(fs.readText('/repo/AGENTS.md')).toBe(text);
  });
});

describe('plan 074 · ac-0008 — the warning and the degraded envelope both point at the page', () => {
  it('the ingress-blocked doctor warning names `harness instructions commit`', async () => {
    const { readCollectorHealth } = await import(
      '../../../src/services/doctor/collector/health.js'
    );
    const { emptyCollectorState, collectorStatePath } = await import(
      '../../../src/services/doctor/collector/state.js'
    );
    const { GITAI_PIN } = await import('../../../src/services/doctor/collector/pin.js');
    const { NodeHash } = await import('../../../src/adapters/hash/node-hash.js');

    const HOME = '/home/u';
    const BINARY = '/home/u/.git-ai/bin/git-ai';
    const PAYLOAD = new TextEncoder().encode('#!/bin/sh\n');
    const DIGEST = new NodeHash().sha256Hex(PAYLOAD);
    const manifest = {
      ...GITAI_PIN,
      artifacts: {
        ...GITAI_PIN.artifacts,
        'macos-arm64': { file: 'git-ai-macos-arm64', sha256: DIGEST },
      },
    } as typeof GITAI_PIN;

    const state = {
      ...emptyCollectorState('2026-08-07T00:00:00.000Z', GITAI_PIN),
      cli: {
        status: 'installed' as const,
        path: BINARY,
        digest: DIGEST,
        verified_at: '2026-08-07T00:00:00.000Z',
        executable: true,
        detail: 'installed',
      },
      hooks: {
        status: 'installed' as const,
        at: '2026-08-07T00:00:00.000Z',
        agents: ['claude'],
        detail: 'hooks installed',
      },
      note_schema: {
        expected: GITAI_PIN.expect_schema_version,
        observed: GITAI_PIN.expect_schema_version,
        status: 'match' as const,
      },
    };

    const fs = new FakeCollectorFs({ [collectorStatePath('/repo')]: JSON.stringify(state) });
    fs.seedBytes(BINARY, PAYLOAD);
    fs.writeText(SOCK, '');

    const ingress = await ingressWith('denied');
    const health = readCollectorHealth({
      fs,
      host: { platform: 'darwin', arch: 'arm64', home: HOME },
      cwd: '/repo',
      hash: new NodeHash(),
      manifest,
      ingress,
    });

    expect(health.verdict).toBe('ingress-blocked');
    expect(health.detail).toContain('CANNOT reach its ingress socket');
    expect(health.detail).toContain('known-human');
    expect(health.next_action).toContain('harness commit');
    expect(health.next_action).toContain('harness doctor telemetry-nudge');
    expect(health.next_action).toContain('harness instructions commit');
  });
});

async function ingressWith(outcome: ProbeOutcome) {
  const cfs = new FakeCollectorFs();
  cfs.writeText(SOCK, '');
  return readIngress({
    fs: cfs,
    probe: new FakeSocketProbe({ [SOCK]: outcome }),
    git: new FakeGitAttribution({ trace2Target: `af_unix:stream:${SOCK}` }),
    env: { get: () => undefined },
  });
}
