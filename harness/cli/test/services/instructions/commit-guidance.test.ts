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
  CORE_INSTRUCTION_PAGES,
  commitGuidanceBlock,
  injectAgentsBlock,
  readAgentsBlock,
} from '../../../src/services/instructions/commit-guidance.js';
import { loadVerbInstructions } from '../../../src/services/instructions/instructions-service.js';
import { FakeCollectorFs } from '../../support/collector-fakes.js';

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
