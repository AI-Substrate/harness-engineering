import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  parsePijDescriptor,
  pijDir,
  readPijRegistry,
} from '../../../src/services/telemetry/pij-registry.js';

/**
 * Plan 052 · T006 — the pij registry join port (dossier F-04). Proven against the
 * reconstructed-to-real-shape 051 roster descriptors (the live worker descriptors
 * were reaped when the peers died; the orchestrator `pij-4s10mb` is the real one,
 * scrubbed). The registry supplies the pijId ↔ harnessSessionId / transcriptPath
 * join the ledger readers need.
 */

const HOME = '/home/dev';

function fixture(rel: string): string {
  return readFileSync(new URL(`./fixtures/lane-sources/${rel}`, import.meta.url), 'utf8');
}

const ORCH = fixture('pij/pij-4s10mb.json');
const CODER = fixture('pij/pij-g7t974.json');
const CODEX = fixture('pij/pij-wolk0r.json');

function registryFs(): FakeFs {
  return new FakeFs(
    {
      [`${pijDir(HOME)}/pij-4s10mb.json`]: ORCH,
      [`${pijDir(HOME)}/pij-g7t974.json`]: CODER,
      [`${pijDir(HOME)}/pij-wolk0r.json`]: CODEX,
      [`${pijDir(HOME)}/not-a-pij.txt`]: 'noise',
    },
    { [pijDir(HOME)]: ['pij-4s10mb.json', 'pij-g7t974.json', 'pij-wolk0r.json', 'not-a-pij.txt'] },
  );
}

function deps(fs: FakeFs, home: string | undefined = HOME) {
  return { fs, env: new FakeEnv({}, home) };
}

describe('parsePijDescriptor — the join fields (F-04)', () => {
  it('lifts harness / harnessSessionId / transcriptPath / spawnedBy', () => {
    expect(parsePijDescriptor('pij-wolk0r', CODEX)).toEqual({
      pij_id: 'pij-wolk0r',
      harness: 'codex',
      harness_session_id: '019f2b3b-6fbb-73b3-a9ec-b78a01deb9d0',
      transcript_path:
        '/home/dev/.codex/sessions/2026/07/04/rollout-2026-07-04T13-45-43-019f2b3b-6fbb-73b3-a9ec-b78a01deb9d0.jsonl',
      spawned_by: 'pij-4s10mb',
      model: null,
      // FX002: additive. A relay (bridge) descriptor never carries a harnessSessionId
      // by its nature; an ordinary agent seat like this one is not a relay.
      relay: false,
    });
  });

  it('a copilot descriptor carries no transcriptPath (null, never fabricated)', () => {
    const d = parsePijDescriptor('pij-g7t974', CODER);
    expect(d?.harness).toBe('copilot');
    expect(d?.harness_session_id).toBe('34524328-5ab0-41c4-8cc9-62b03128930d');
    expect(d?.transcript_path).toBeNull();
  });

  it('corrupt JSON / non-object → null (never throws)', () => {
    expect(parsePijDescriptor('x', '{bad')).toBeNull();
    expect(parsePijDescriptor('x', '"a string"')).toBeNull();
    expect(parsePijDescriptor('x', 'null')).toBeNull();
  });
});

describe('readPijRegistry — the whole registry (F-04)', () => {
  it('builds by_pij + reverse by_harness_session; skips non-pij files', () => {
    const reg = readPijRegistry(deps(registryFs()));
    expect(reg.available).toBe(true);
    expect([...reg.by_pij.keys()].sort()).toEqual(['pij-4s10mb', 'pij-g7t974', 'pij-wolk0r']);
    expect(reg.by_harness_session.get('34524328-5ab0-41c4-8cc9-62b03128930d')).toBe('pij-g7t974');
    expect(reg.by_harness_session.get('15eaa924-56f3-4427-9abc-000000000000')).toBe('pij-4s10mb');
  });

  it('absent home → unavailable, empty maps (never throws)', () => {
    const reg = readPijRegistry(deps(new FakeFs({}), undefined));
    expect(reg.available).toBe(false);
    expect(reg.by_pij.size).toBe(0);
  });

  it('absent ~/.pij dir → unavailable (source simply not present)', () => {
    const reg = readPijRegistry(deps(new FakeFs({})));
    expect(reg.available).toBe(false);
  });
});
