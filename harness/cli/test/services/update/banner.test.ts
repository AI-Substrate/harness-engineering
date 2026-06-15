import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import type { Envelope } from '../../../src/output/envelope.js';
import type { Writers } from '../../../src/output/output-port.js';
import { buildBannerDecorator, formatUpdateBanner } from '../../../src/services/update/banner.js';

const HOME = '/home/u';
const PATH = '/home/u/.harness/update-check.json';
const FRESH_CACHE = { [PATH]: '{"last_success_iso":"2026-06-15T00:00:00.000Z","latest":"0.3.0"}' };

function recordingWriters(): Writers & { outText: string; errText: string } {
  const w = {
    outText: '',
    errText: '',
    out(t: string) {
      w.outText += t;
    },
    err(t: string) {
      w.errText += t;
    },
  };
  return w;
}

function envelope(): Envelope {
  return { command: 'doctor', status: 'ok', timestamp: '2026-06-15T00:00:00.000Z' };
}

describe('formatUpdateBanner', () => {
  it('renders exactly the AC8 line, sourcing the command from the field', () => {
    expect(
      formatUpdateBanner({ installed: '0.2.0', latest: '0.3.0', command: 'harness update' }),
    ).toBe('update available to 0.3.0 from 0.2.0 — run: harness update\n');
  });
});

describe('buildBannerDecorator', () => {
  it('human mode: sets the additive field AND writes one stderr line', () => {
    /*
    Test Doc:
    - Why: the bespoke human {emit} ports bypass renderHuman, so the banner must
      come from the exit chokepoint decorator (KF-09/AC8).
    - Contract: a known update ⇒ env.update_available set + one stderr line (human).
    - Usage Notes: cache read is sync (FsPort) — no network on the hot path.
    - Quality Contribution: pins both the JSON field and the human stderr line.
    - Worked Example: cached latest 0.3.0 vs installed 0.2.0 ⇒ banner.
    */
    const writers = recordingWriters();
    const decorate = buildBannerDecorator({
      fs: new FakeFs(FRESH_CACHE),
      env: new FakeEnv({}, HOME),
      installed: '0.2.0',
      mode: 'human',
      writers,
    });
    const env = envelope();
    decorate(env);
    expect(env.update_available).toEqual({
      installed: '0.2.0',
      latest: '0.3.0',
      command: 'harness update',
    });
    expect(writers.errText).toBe('update available to 0.3.0 from 0.2.0 — run: harness update\n');
    expect(writers.outText).toBe(''); // never stdout
  });

  it('json mode: sets the field but writes NO human line', () => {
    const writers = recordingWriters();
    const decorate = buildBannerDecorator({
      fs: new FakeFs(FRESH_CACHE),
      env: new FakeEnv({}, HOME),
      installed: '0.2.0',
      mode: 'json',
      writers,
    });
    const env = envelope();
    decorate(env);
    expect(env.update_available?.latest).toBe('0.3.0');
    expect(writers.errText).toBe('');
    expect(writers.outText).toBe('');
  });

  it('no known update: leaves the envelope untouched and writes nothing', () => {
    const writers = recordingWriters();
    // installed already latest ⇒ no notice
    const decorate = buildBannerDecorator({
      fs: new FakeFs(FRESH_CACHE),
      env: new FakeEnv({}, HOME),
      installed: '0.3.0',
      mode: 'human',
      writers,
    });
    const env = envelope();
    decorate(env);
    expect(env.update_available).toBeUndefined();
    expect(writers.errText).toBe('');

    // no cache at all ⇒ also nothing
    const writers2 = recordingWriters();
    buildBannerDecorator({
      fs: new FakeFs(),
      env: new FakeEnv({}, HOME),
      installed: '0.2.0',
      mode: 'human',
      writers: writers2,
    })(envelope());
    expect(writers2.errText).toBe('');
  });
});
