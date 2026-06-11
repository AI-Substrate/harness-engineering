import { describe, expect, it } from 'vitest';
import { helpPalette, helpStyleConfig, resolveUseColor } from '../../src/output/style.js';

const ESC = '\x1b[';

describe('resolveUseColor', () => {
  it('ON for an interactive human run; OFF when piped or JSON (the default gate)', () => {
    /*
    Test Doc:
    - Why: color must appear for a human at an interactive TTY (the feature ask) but never
      pollute piped/JSON output that an agent or CI parses.
    - Contract: resolveUseColor({mode,isTty,env}) is true ONLY when mode==='human' AND isTty,
      absent any color env override.
    - Quality Contribution: pins the default gate so help color stays a human-only affordance.
    */
    expect(resolveUseColor({ mode: 'human', isTty: true, env: {} })).toBe(true);
    expect(resolveUseColor({ mode: 'human', isTty: false, env: {} })).toBe(false);
    expect(resolveUseColor({ mode: 'json', isTty: true, env: {} })).toBe(false);
  });

  it('honors NO_COLOR / FORCE_COLOR / CLICOLOR_FORCE precedence (mirrors commander)', () => {
    /*
    Test Doc:
    - Why: both help surfaces must agree with commander's own `useColor()` in every env so a
      user's global NO_COLOR (or a CI FORCE_COLOR) behaves identically across them.
    - Contract: NO_COLOR (non-empty) or FORCE_COLOR=0/false force OFF; a truthy FORCE_COLOR or any
      CLICOLOR_FORCE forces ON; an empty NO_COLOR is treated as unset.
    */
    expect(resolveUseColor({ mode: 'human', isTty: true, env: { NO_COLOR: '1' } })).toBe(false);
    expect(resolveUseColor({ mode: 'human', isTty: true, env: { NO_COLOR: '' } })).toBe(true);
    expect(resolveUseColor({ mode: 'human', isTty: true, env: { FORCE_COLOR: '0' } })).toBe(false);
    expect(resolveUseColor({ mode: 'json', isTty: false, env: { FORCE_COLOR: '1' } })).toBe(true);
    expect(resolveUseColor({ mode: 'json', isTty: false, env: { CLICOLOR_FORCE: '1' } })).toBe(
      true,
    );
  });
});

describe('helpPalette', () => {
  it('disabled → identity (no ANSI); enabled → wraps text in SGR codes, text preserved', () => {
    const off = helpPalette(false);
    expect(off.heading('Commands:')).toBe('Commands:');
    expect(off.extHeading('Extensions:')).toBe('Extensions:');
    expect(off.dim('explain')).toBe('explain');

    const on = helpPalette(true);
    expect(on.heading('Commands:')).toContain(ESC);
    expect(on.heading('Commands:')).toContain('Commands:');
    expect(on.extHeading('Extensions:')).toContain(ESC);
    expect(on.extHeading('Extensions:')).toContain('Extensions:');
  });
});

describe('helpStyleConfig (commander styleTitle hook)', () => {
  it('accents Extensions green + Commands cyan; other titles plain bold; title text intact', () => {
    /*
    Test Doc:
    - Why: the `--help` distinction between core and contributed verbs rides on the heading accent;
      and ONLY titles may be styled so option/arg/description substrings stay stable for tests/pipes.
    - Contract: styleTitle wraps 'Extensions:' in green (32m), 'Commands:' in cyan (36m), every other
      title in bold (1m) only — never inserting codes inside the title word itself.
    */
    const cfg = helpStyleConfig();
    expect(cfg.styleTitle).toBeTypeOf('function');
    const styleTitle = cfg.styleTitle as (s: string) => string;

    const ext = styleTitle('Extensions:');
    const cmd = styleTitle('Commands:');
    const opt = styleTitle('Options:');

    expect(ext).toContain('32m'); // green
    expect(cmd).toContain('36m'); // cyan
    expect(opt).toContain('1m'); // bold
    expect(opt).not.toContain('32m');
    expect(ext).toContain('Extensions:');
    expect(cmd).toContain('Commands:');
    expect(opt).toContain('Options:');
  });
});
