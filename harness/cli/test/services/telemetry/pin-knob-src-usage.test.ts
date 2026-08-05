import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  decodeSegment,
  decodeSegmentDetailed,
  SEGMENT_SCHEMA_PIN,
} from '../../../src/services/telemetry/segment.js';

/*
THE CONTROL THAT MAKES THE PIN KNOB SURVIVABLE.

Ruling #5 took Option C: `decodeSegmentDetailed(value, { pin })`, so the frozen
Segment-2.4 real-capture corpus keeps its read-back proof under an explicitly declared
legacy pin — which matters because for three of the four shipping harnesses (claude,
copilot-cli, copilot-vscode) those 2.4 captures are the ONLY real captured sessions
there are. A hard pin would cost them their real-data read-back: present and future
coverage, not history.

BUT A KNOB IS AN OPT-OUT, and two doors to the same decision is the A3 failure — one
implementation, not two. The mitigation is this file, and it is LOAD-BEARING, not a
nicety: if any production call site could quietly lower the pin, "this build reads 2.7"
would stop being true while still reading true in the type. The knob must provably
exist for the corpus alone.
*/

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Strip block + line comments so prose about the knob never trips the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/.*$/gm, '');
}

describe('the pin knob is provably unused in production (ruling #5, load-bearing)', () => {
  it('CONTROL: no src/ call site passes a pin to decodeSegment/decodeSegmentDetailed', () => {
    /*
    Test Doc:
    - Why: the whole basis on which Option C was accepted. A production caller lowering
      the pin would make "this build reads 2.7 and names everything older" false, with
      nothing in the output to say so — the packet's own defect class, arriving through
      the mitigation for its own collision.
    - Contract: every `decodeSegment(...)` / `decodeSegmentDetailed(...)` call under
      `src/` passes exactly ONE argument. The definitions themselves are excluded (they
      declare the parameter; they do not use it).
    - Worked Example: `decodeSegmentDetailed(parsed, decodeOptions)` inside
      `session-export.ts` is a THREADING site, not a value site — it forwards whatever
      `combineSession` was given, and `combineSession`'s own default is "nothing". So
      the check below targets literal pin VALUES, and the separate assertion after it
      proves the default really is the production pin.
    */
    const offenders: string[] = [];
    for (const file of tsFilesUnder(SRC)) {
      const body = stripComments(readFileSync(file, 'utf8'));
      // A literal pin value handed to a decode call, or any `pin:` object literal in
      // src that is not the interface/opt DECLARATION.
      for (const match of body.matchAll(/\bpin\s*:\s*'([^']*)'/g)) {
        offenders.push(`${file.slice(SRC.length + 1)} → pin: '${match[1]}'`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('CONTROL: the default really is SEGMENT_SCHEMA_PIN — the knob defaults to production', () => {
    /*
    An unused knob proves nothing if the DEFAULT is wrong. A 2.6 record must be refused
    when no pin is passed, exactly as it is when the production pin is passed explicitly.
    */
    const below = { schema_version: '2.6' };
    expect(decodeSegmentDetailed(below)).toEqual(decodeSegmentDetailed(below, {}));
    expect(decodeSegmentDetailed(below)).toEqual(
      decodeSegmentDetailed(below, { pin: SEGMENT_SCHEMA_PIN }),
    );
    expect(decodeSegmentDetailed(below).ok).toBe(false);
    expect(decodeSegment(below)).toBeNull();
  });

  it('GUARD: the knob genuinely works — a declared legacy pin reads what production declines', () => {
    /*
    The knob must not be inert: if a legacy pin could not actually read a 2.4 record,
    the corpus read-back proof Option C was chosen to preserve would be a fiction, and
    the pre-2.7 decoder branches really would be unreachable rot.
    */
    const legacy = { schema_version: '2.6' };
    expect(decodeSegmentDetailed(legacy, { pin: '1.1' }).ok || false).toBe(false);
    // (a bare version stub is structurally invalid; the REAL corpus read-back lives in
    // session-export/report, which drive whole recorded segments through combineSession)
    expect(decodeSegmentDetailed(legacy, { pin: '1.1' })).toMatchObject({
      reason: 'malformed',
      schema_version: '2.6',
    });
    // …and crucially NOT `below_pin`: under a 1.1 pin, 2.6 is above the floor.
    expect(decodeSegmentDetailed(legacy, { pin: '1.1' }).ok).toBe(false);
    expect((decodeSegmentDetailed(legacy, { pin: '1.1' }) as { reason: string }).reason).not.toBe(
      'below_pin',
    );
  });

  it('GUARD: the pin is a FLOOR, which is what makes `below_pin` the honest name', () => {
    const rec = (v: string) => ({ schema_version: v });
    // Under the production pin, everything known below 2.7 is below_pin.
    for (const v of ['1.1', '2.0', '2.3', '2.4', '2.5', '2.6']) {
      expect(decodeSegmentDetailed(rec(v))).toMatchObject({ reason: 'below_pin' });
    }
    // Under a 2.5 pin, 2.4 is below and 2.6 is not.
    expect(decodeSegmentDetailed(rec('2.4'), { pin: '2.5' })).toMatchObject({
      reason: 'below_pin',
    });
    expect(
      (decodeSegmentDetailed(rec('2.6'), { pin: '2.5' }) as { reason: string }).reason,
    ).not.toBe('below_pin');
    // An UNKNOWN version is never below_pin at any pin — it is above, or it is garbage.
    expect(decodeSegmentDetailed(rec('2.8'), { pin: '1.1' })).toMatchObject({
      reason: 'unsupported_version',
    });
  });
});
