import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkStructure } from './html-structure.js';
import {
  CHROME_CANDIDATES,
  chromeArgs,
  cropArgs,
  resolveChrome,
  slicePlan,
  validateParams,
  verifyOutput,
  type SnapParams,
} from './snap-core.js';

/**
 * RED/GREEN suite for html-snap's pure core. The governance condition this
 * suite exists to prove (spine seq 542 thread): a control that has only run
 * against GOOD input has been demonstrated, not tested — so every known-bad
 * shape here must FAIL loudly, and the forced-env case must never fall back.
 */

const base: SnapParams = {
  file: '/tmp/x.html',
  width: 1440,
  pageHeight: 14000,
  offset: 0,
  cropHeight: 0,
  slices: 0,
  delayMs: 1200,
};

describe('resolveChrome — the ladder', () => {
  it('env set + exists → used, via env', () => {
    const r = resolveChrome('/opt/browser', (p) => p === '/opt/browser');
    expect(r).toEqual({ kind: 'ok', path: '/opt/browser', via: 'env' });
  });

  it('env set + MISSING → hard env-missing, NEVER a fallback to probes (known-bad)', () => {
    // Probes would succeed — the ladder must still refuse.
    const r = resolveChrome('/nonexistent/chrome', (p) => p !== '/nonexistent/chrome');
    expect(r.kind).toBe('env-missing');
  });

  it('no env → first existing candidate wins, via probe', () => {
    const hit = CHROME_CANDIDATES[3];
    const r = resolveChrome(undefined, (p) => p === hit);
    expect(r).toEqual({ kind: 'ok', path: hit, via: 'probe' });
  });

  it('nothing anywhere → none, naming every probed path (known-bad)', () => {
    const r = resolveChrome(undefined, () => false);
    expect(r.kind).toBe('none');
    if (r.kind === 'none') expect(r.probed).toEqual(CHROME_CANDIDATES);
  });
});

describe('validateParams — known-bad argument shapes fail', () => {
  it('good defaults pass clean', () => {
    expect(validateParams(base)).toEqual([]);
  });

  it('offset beyond the page fails (crop would fall off the render)', () => {
    const problems = validateParams({ ...base, offset: 99000, cropHeight: 900 });
    expect(problems.some((p) => p.problem.includes('exceeds --page-height'))).toBe(true);
  });

  it('offset without crop-height fails (would silently return the full page)', () => {
    const problems = validateParams({ ...base, offset: 500 });
    expect(problems.some((p) => p.flag === '--offset' && p.problem.includes('no-op'))).toBe(true);
  });

  it('slices and crop are mutually exclusive', () => {
    const problems = validateParams({ ...base, slices: 4, offset: 100, cropHeight: 800 });
    expect(problems.some((p) => p.flag === '--slices')).toBe(true);
  });

  it('non-integer / out-of-range numerics fail', () => {
    expect(validateParams({ ...base, width: 10 }).length).toBeGreaterThan(0);
    // below chrome-headless's 500px window floor: layout at 500 + crop to less = fake clipping (known-bad)
    expect(validateParams({ ...base, width: 390 }).length).toBeGreaterThan(0);
    expect(validateParams({ ...base, slices: 500 }).length).toBeGreaterThan(0);
    expect(validateParams({ ...base, delayMs: Number.NaN }).length).toBeGreaterThan(0);
  });
});

describe('command construction', () => {
  it('chrome argv is deterministic and reduced-motion settled', () => {
    const args = chromeArgs(base, '/abs/page.html', '/abs/out.png');
    expect(args).toContain('--force-prefers-reduced-motion');
    expect(args).toContain('--window-size=1440,14000');
    expect(args).toContain('--screenshot=/abs/out.png');
    expect(args[args.length - 1]).toBe('file:///abs/page.html');
  });

  it('sips crop: height width, then cropOffset y x', () => {
    const c = cropArgs('sips', '/f.png', '/o.png', 1440, 3000, 900);
    expect(c).toEqual({
      command: 'sips',
      args: ['-c', '900', '1440', '--cropOffset', '3000', '0', '/f.png', '--out', '/o.png'],
    });
  });

  it('sips offset 0 clamps to 1 — sips center-crops on 0, which would lie about the origin (known-bad)', () => {
    const c = cropArgs('sips', '/f.png', '/o.png', 1440, 0, 900);
    expect(c.args).toContain('1');
    expect(c.args).not.toContain('0,');
  });

  it('magick crop: geometry WxH+0+Y with +repage', () => {
    const c = cropArgs('magick', '/f.png', '/o.png', 1440, 3000, 900);
    expect(c.args).toContain('1440x900+0+3000');
  });
});

describe('slicePlan', () => {
  it('bands cover the page exactly, last absorbs the remainder', () => {
    const plan = slicePlan(10000, 3);
    expect(plan).toEqual([
      { offset: 0, height: 3333 },
      { offset: 3333, height: 3333 },
      { offset: 6666, height: 3334 },
    ]);
    expect(plan.reduce((a, b) => a + b.height, 0)).toBe(10000);
  });
});

describe('verifyOutput — an empty render is an ERROR, never a pass (known-bad)', () => {
  it('missing file fails', () => {
    expect(verifyOutput({ exists: false, bytes: null }).ok).toBe(false);
  });
  it('tiny/empty file fails with the screenshot-shaped-empty reason', () => {
    const v = verifyOutput({ exists: true, bytes: 12 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain('screenshot-shaped empty result');
  });
  it('a real render passes', () => {
    expect(verifyOutput({ exists: true, bytes: 250_000 }).ok).toBe(true);
  });
});

describe('checkStructure — screenshots cannot see these; the parser must (known-bad)', () => {
  const fixture = (name: string): string =>
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

  it('the eaten-gt + unclosed-figure fixture FAILS (the 065 freeze defect class)', () => {
    const problems = checkStructure(fixture('bad-nesting.html'));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.kind === 'eaten-gt')).toBe(true);
    // the unclosed figure surfaces when </body> closes over it
    expect(problems.some((p) => p.kind === 'mismatched-close' && p.detail.includes('<figure'))).toBe(true);
  });

  it('the good fixture passes clean', () => {
    expect(checkStructure(fixture('good.html'))).toEqual([]);
  });

  it('well-formed nesting with voids, self-closing svg, comments and script passes', () => {
    const ok = '<!doctype html><html><head><meta charset="utf-8"><script>if (1<2) {}</script></head>' +
      '<body><!-- c --><svg><path d="M0 0"/><rect x="1"/></svg><div><br><img src="x"></div></body></html>';
    expect(checkStructure(ok)).toEqual([]);
  });

  it('a mismatched close is reported with the line it closes over', () => {
    const bad = '<div>\n<section>\n</div>';
    const problems = checkStructure(bad);
    expect(problems.some((p) => p.kind === 'mismatched-close' && p.detail.includes('<section'))).toBe(true);
  });
});
