import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import {
  descriptorsClaiming,
  isActionable,
  resolveDescriptorIdentity,
  resolvePijIdentity,
  resolveSessionPijIdentity,
} from '../../../src/services/telemetry/pij-identity.js';
import { readPijRegistry } from '../../../src/services/telemetry/pij-registry.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import { combineSession } from '../../../src/services/telemetry/session-export.js';

/*
FX002 — an ADOPTED seat has no identity, so our own exemplar was unscorable.

`selectCapturedEnv` captures PIJ_SESSION_ID from the ENVIRONMENT. A seat that is
adopted — an existing terminal that registers itself rather than being spawned by
pij — never had that variable, so it captures nothing, the join key is absent, and
the fleet join fails at the root with NO error and NO marker. The seats doing the
most interesting work are usually adopted, including the orchestrator seats.

TWO HARD RULES, both controlled below:
  - NEVER fabricate an identity. A guessed id makes a join that LOOKS successful and
    is wrong — a false green, which this repo ranks as worse than a false red because
    nothing ever contests it.
  - An AMBIGUOUS descriptor match is UNRESOLVED, not a best guess.
*/

const HOME = '/home/dev';

/**
 * `pij-telegram`'s REAL committed shape, copied from a live `~/.pij` descriptor
 * (ids/paths only — no content). It is a RELAY: a bridge, not an agent session. It
 * carries NO `harnessSessionId` key at all and never will, by its nature, permanently.
 * A real-world referent beats a fabricated one, and this is the case that decides
 * whether "unresolved" is allowed to be alarming.
 */
const TELEGRAM_DESCRIPTOR = JSON.stringify({
  id: 'pij-telegram',
  folder: '/home/dev/pij',
  dataDir: '/home/dev/.pij/pij-telegram',
  pid: 24910,
  startedAt: '2026-08-04T05:04:33.248Z',
  harness: 'pi',
  lifecycle: 'bound',
  relay: true,
  systemState: 'unknown',
});
const desc = (harnessSessionId: string | null, over: Record<string, unknown> = {}) =>
  JSON.stringify({ harnessSessionId, harness: 'copilot', ...over });

/**
 * A fake `~/.pij`. A value of `RAW:<json>` seeds a verbatim descriptor body (used for
 * `pij-telegram`'s real shape); anything else is a plain `harnessSessionId`.
 */
function registryOf(entries: Record<string, string | null>) {
  const files: Record<string, string> = {};
  const names: string[] = [];
  for (const [pijId, sid] of Object.entries(entries)) {
    files[`${HOME}/.pij/${pijId}.json`] =
      typeof sid === 'string' && sid.startsWith('RAW:') ? sid.slice(4) : desc(sid);
    names.push(`${pijId}.json`);
  }
  return readPijRegistry({
    fs: new FakeFs(files, { [`${HOME}/.pij`]: names }),
    env: new FakeEnv({}, HOME),
  });
}

function segmentWith(capturedEnv: Record<string, string> | undefined) {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'copilot',
      harness_session_id: 'sessAdopted',
      timecode: '2026-06-29T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: [],
      captured_env: capturedEnv,
    } as SegmentInput,
    '/work',
  );
}

describe('FX002 — an unresolved identity is a STATE, not a silence', () => {
  it('GUARD: a normally SPAWNED seat still resolves its real id from env, unchanged', () => {
    /*
    Test Doc:
    - Why: the dossier's first guard. The fix must not disturb the case that already
      worked — a captured PIJ_SESSION_ID is the seat stating its own identity.
    - Contract: env wins outright, and `via` records that it came from env.
    */
    expect(
      resolvePijIdentity({ PIJ_SESSION_ID: 'pij-spawned-one' }, 'sessX', registryOf({})),
    ).toEqual({ status: 'resolved', pij_id: 'pij-spawned-one', via: 'env' });
  });

  it('GUARD: env WINS over the registry — corroboration never overrides self-declaration', () => {
    const registry = registryOf({ 'pij-other-seat': 'sessX' });
    expect(resolvePijIdentity({ PIJ_SESSION_ID: 'pij-spawned-one' }, 'sessX', registry)).toEqual({
      status: 'resolved',
      pij_id: 'pij-spawned-one',
      via: 'env',
    });
  });

  it('CONTROL: an ADOPTED seat (no PIJ_SESSION_ID) is recovered by reverse join', () => {
    /*
    Test Doc:
    - Why: THE fix. Pre-fix an adopted seat produced pij_session_id: null and nothing
      else — no error, no marker, indistinguishable from a seat with no pij at all.
    - Contract: the registry's descriptor claiming this harness session names the seat,
      and `via: 'registry'` records that it was RECOVERED, not self-declared.
    */
    const registry = registryOf({ 'pij-alright-muskox': 'sessAdopted', 'pij-other': 'sessOther' });
    expect(resolvePijIdentity(undefined, 'sessAdopted', registry)).toEqual({
      status: 'resolved',
      pij_id: 'pij-alright-muskox',
      via: 'registry',
    });
  });

  it('CONTROL: an AMBIGUOUS match is unresolved — never a first-wins guess', () => {
    /*
    Test Doc:
    - Why: the dossier's second guard, and the one most likely to be silently violated:
      several seats share a repo, and `pij-registry`'s own `by_harness_session` index is
      FIRST-WINS, so a collision is invisible through it. This resolver deliberately
      scans `by_pij` instead, so ambiguity can be SEEN.
    - Contract: >1 claiming descriptor -> unresolved/'ambiguous', carrying every
      candidate so a human can disambiguate. NOT the first one sorted.
    */
    const registry = registryOf({ 'pij-seat-b': 'sessShared', 'pij-seat-a': 'sessShared' });
    expect(resolvePijIdentity(undefined, 'sessShared', registry)).toEqual({
      status: 'unresolved',
      reason: 'ambiguous',
      actionable: true,
      candidates: ['pij-seat-a', 'pij-seat-b'],
    });
  });

  it('CONTROL: no descriptor match is its own reason, distinct from an unavailable registry', () => {
    /*
    "I read the registry and nothing claimed this session" and "I could not read the
    registry" are different facts. Folding them is the defect this packet exists for.
    */
    expect(
      resolvePijIdentity(undefined, 'sessAdopted', registryOf({ 'pij-x': 'sessOther' })),
    ).toEqual({
      status: 'unresolved',
      reason: 'no_descriptor_match',
      actionable: true,
      candidates: [],
    });
    expect(resolvePijIdentity(undefined, 'sessAdopted', registryOf({}))).toEqual({
      status: 'unresolved',
      reason: 'registry_unavailable',
      actionable: false,
      candidates: [],
    });
  });

  it('CONTROL: an unresolved identity NEVER yields a fabricated id', () => {
    /*
    Test Doc:
    - Why: the hard constraint. A guessed id makes a join that looks successful and is
      wrong. This asserts the negative directly across every unresolved shape.
    */
    const cases = [
      resolvePijIdentity(undefined, 'sessAdopted', registryOf({})),
      resolvePijIdentity(undefined, 'sessAdopted', registryOf({ 'pij-x': 'sessOther' })),
      resolvePijIdentity(undefined, 'sessShared', registryOf({ a: 'sessShared', b: 'sessShared' })),
      resolvePijIdentity({}, 'sessAdopted', registryOf({})),
      resolvePijIdentity({ PIJ_SESSION_ID: '' }, 'sessAdopted', registryOf({})),
    ];
    for (const result of cases) {
      expect(result.status).toBe('unresolved');
      expect(result).not.toHaveProperty('pij_id');
    }
  });

  it('CONTROL: a descriptor with NO join key is survived, not tripped over', () => {
    /*
    Test Doc:
    - Why: this has a real-world referent, established by a field scan of 458 `~/.pij`
      descriptors: `pij-telegram` carries harnessSessionId, spawnedBy, createdAt and
      state ALL null. It is not an agent session at all, and it sits in the same
      directory every read walks. A keyless descriptor must be skipped cleanly rather
      than matching, throwing, or being counted as a candidate.
    - Contract: descriptors with a null harness_session_id never claim any session, and
      their presence does not disturb resolution for the seats that do carry keys.
    */
    const registry = registryOf({ 'pij-live': 'sessAdopted', 'pij-telegram': null });
    expect(descriptorsClaiming(registry, 'sessAdopted')).toEqual(['pij-live']);
    // …and it claims nothing of its own, rather than matching a null-ish session id.
    expect(descriptorsClaiming(registry, '')).toEqual([]);
    expect(resolvePijIdentity(undefined, 'sessAdopted', registry)).toEqual({
      status: 'resolved',
      pij_id: 'pij-live',
      via: 'registry',
    });
    // A registry of ONLY keyless descriptors resolves unresolved — never a guess.
    expect(
      resolvePijIdentity(undefined, 'sessAdopted', registryOf({ 'pij-telegram': null })),
    ).toEqual({
      status: 'unresolved',
      reason: 'no_descriptor_match',
      actionable: true,
      candidates: [],
    });
  });

  it('CONTROL: the session-level resolver reads real SEGMENTS, and stays fail-safe', () => {
    /*
    Test Doc:
    - Why: the resolver must ride real serialized segments, not a hand-built shape, and
      a missing/exploding registry must resolve to a NAMED unavailable rather than
      throwing — fail-safe, but never silent.
    */
    const deps = { fs: new FakeFs(), env: new FakeEnv({}, HOME) };
    expect(resolveSessionPijIdentity([segmentWith(undefined)], 'sessAdopted', deps)).toEqual({
      status: 'unresolved',
      reason: 'registry_unavailable',
      actionable: false,
      candidates: [],
    });
    expect(
      resolveSessionPijIdentity(
        [segmentWith({ PIJ_SESSION_ID: 'pij-spawned-one' })],
        'sessAdopted',
        deps,
      ),
    ).toEqual({ status: 'resolved', pij_id: 'pij-spawned-one', via: 'env' });

    const exploding = {
      fs: {
        readText: () => {
          throw new Error('boom');
        },
        readdir: () => {
          throw new Error('boom');
        },
      },
      env: new FakeEnv({}, HOME),
    };
    expect(resolveSessionPijIdentity([segmentWith(undefined)], 'sessAdopted', exploding)).toEqual({
      status: 'unresolved',
      reason: 'registry_unavailable',
      actionable: false,
      candidates: [],
    });
  });
});

describe('FX002 at the REAL caller surface (ruling #1.1)', () => {
  const tel = (root: string) => `${root}/.harness/temp/telemetry`;

  function exportOf(capturedEnv: Record<string, string> | undefined, pij: Record<string, string>) {
    const seg = segmentWith(capturedEnv);
    const files: Record<string, string> = {
      [`${tel('/work')}/sessAdopted/0.json`]: JSON.stringify(seg),
    };
    const pijNames: string[] = [];
    for (const [pijId, sid] of Object.entries(pij)) {
      files[`${HOME}/.pij/${pijId}.json`] = desc(sid);
      pijNames.push(`${pijId}.json`);
    }
    return combineSession(
      'sessAdopted',
      {
        fs: new FakeFs(files, {
          [`${tel('/work')}/sessAdopted`]: ['0.json'],
          [`${HOME}/.pij`]: pijNames,
        }),
        proc: new FakeProcess({}, '/nowhere'),
        env: new FakeEnv({}, HOME),
      },
      { root: '/work' },
    );
  }

  it('CONTROL: the export SAYS the adopted seat was recovered, and fills the join key', () => {
    /*
    Test Doc:
    - Why: a channel nobody reads is not a channel. Pre-fix the envelope carried
      pij_session_id: null for an adopted seat and nothing else — the exemplar was
      unscorable and the output never said why.
    - Contract: identity.pij_identity names how it was established; pij_session_id is
      filled from a genuinely RESOLVED identity only.
    */
    const exp = exportOf(undefined, { 'pij-alright-muskox': 'sessAdopted' });
    expect(exp.identity.pij_identity).toEqual({
      status: 'resolved',
      pij_id: 'pij-alright-muskox',
      via: 'registry',
    });
    expect(exp.identity.pij_session_id).toBe('pij-alright-muskox');
  });

  it('CONTROL: an ambiguous seat is reported unresolved AND leaves the join key null', () => {
    /*
    The false-green control. A best guess here would produce a join that looks
    successful and is wrong; nothing downstream would ever contest it.
    */
    const exp = exportOf(undefined, { 'pij-seat-a': 'sessAdopted', 'pij-seat-b': 'sessAdopted' });
    expect(exp.identity.pij_identity).toEqual({
      status: 'unresolved',
      reason: 'ambiguous',
      actionable: true,
      candidates: ['pij-seat-a', 'pij-seat-b'],
    });
    expect(exp.identity.pij_session_id).toBeNull();
  });

  it('GUARD: a spawned seat is unchanged end-to-end', () => {
    const exp = exportOf({ PIJ_SESSION_ID: 'pij-spawned-one' }, {});
    expect(exp.identity.pij_session_id).toBe('pij-spawned-one');
    expect(exp.identity.pij_identity).toEqual({
      status: 'resolved',
      pij_id: 'pij-spawned-one',
      via: 'env',
    });
  });
});

describe('FX002 · ruling #7 — unresolved is a STATE, and only some of it is a finding', () => {
  it('CONTROL: a RELAY (pij-telegram, real shape) is unresolved and NOT actionable', () => {
    /*
    Test Doc:
    - Why: THE control for ruling #7. `pij-telegram` is a bridge, not an agent session,
      and will never carry a harness session id — permanently, by its nature. If that
      raised a finding it would raise one forever, and a permanent warning is one
      everyone learns to ignore, which would then bury the real unresolved cases behind
      it. An alarm whose only steady output is noise guards nothing.
    - Contract: reason `no_session_by_nature`, `actionable: false`, no fabricated id.
    */
    const registry = registryOf({ 'pij-telegram': `RAW:${TELEGRAM_DESCRIPTOR}` });
    expect(registry.by_pij.get('pij-telegram')?.relay).toBe(true);
    expect(registry.by_pij.get('pij-telegram')?.harness_session_id).toBeNull();
    expect(resolveDescriptorIdentity('pij-telegram', registry)).toEqual({
      status: 'unresolved',
      reason: 'no_session_by_nature',
      actionable: false,
      candidates: [],
    });
  });

  it('CONTROL: a NON-relay seat with no session id IS actionable — the twin fact', () => {
    /*
    The distinction that makes the previous control worth having: the same missing key
    means something different on a seat that should have had one. Collapsing these two
    is exactly what ruling #7 forbids.
    */
    const registry = registryOf({ 'pij-agent-seat': null });
    expect(resolveDescriptorIdentity('pij-agent-seat', registry)).toEqual({
      status: 'unresolved',
      reason: 'session_key_missing',
      actionable: true,
      candidates: [],
    });
  });

  it('GUARD: a keyed seat still resolves, and an unknown pij id is actionable', () => {
    const registry = registryOf({ 'pij-live': 'sessAdopted' });
    expect(resolveDescriptorIdentity('pij-live', registry)).toEqual({
      status: 'resolved',
      pij_id: 'pij-live',
      via: 'registry',
    });
    expect(resolveDescriptorIdentity('pij-absent', registry)).toMatchObject({
      reason: 'no_descriptor_match',
      actionable: true,
    });
  });

  it('GUARD: a capability gap is not a subject failure — registry_unavailable is NOT actionable', () => {
    /*
    This repo's standing rule, applied here: "the registry could not be read" says
    nothing about the seat, so it must not be filed as a finding against it.
    */
    expect(resolveDescriptorIdentity('pij-anything', registryOf({}))).toMatchObject({
      reason: 'registry_unavailable',
      actionable: false,
    });
  });

  it('GUARD: every actionable flag comes from ONE decider, so no consumer re-derives it', () => {
    expect(isActionable('no_session_by_nature')).toBe(false);
    expect(isActionable('registry_unavailable')).toBe(false);
    expect(isActionable('session_key_missing')).toBe(true);
    expect(isActionable('no_descriptor_match')).toBe(true);
    expect(isActionable('ambiguous')).toBe(true);
  });

  it('GUARD: a relay sitting in the registry never disturbs a real seat resolving', () => {
    const registry = registryOf({
      'pij-telegram': `RAW:${TELEGRAM_DESCRIPTOR}`,
      'pij-live': 'sessAdopted',
    });
    expect(resolvePijIdentity(undefined, 'sessAdopted', registry)).toEqual({
      status: 'resolved',
      pij_id: 'pij-live',
      via: 'registry',
    });
  });
});
