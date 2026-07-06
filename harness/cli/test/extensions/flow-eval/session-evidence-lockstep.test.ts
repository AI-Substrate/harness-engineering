import { describe, expect, it } from 'vitest';
// The extension re-declares SessionEvidence (it can't import CLI internals); F13
// (plan 046 · AC-08) adds `duration_s` and F4 adds `harness_session_id` to BOTH.
// This file is the LOCK-STEP proof: it imports both decls and asserts mutual
// structural assignability, so a field added to one without the other fails to
// COMPILE — the drift guard the packet requires. (Extension path mirrors
// e2e-md-to-pdf.test.ts: five levels up.)
import type { SessionEvidence as ExtEvidence } from '../../../../../.harness/extensions/flow-eval/resolvers.js';
import type { SessionEvidence as CliEvidence } from '../../../src/services/telemetry/session-evidence.js';

/** A full CLI-shaped evidence value — carrying `duration_s` + `harness_session_id`, it must satisfy BOTH types. */
const SAMPLE: CliEvidence = {
  pij_session_id: 'pij-lock',
  harness_session_id: 'hs-lock',
  harness: 'claude-code',
  segments: 3,
  skills: { 'the-flow': 1 },
  skill_order: ['the-flow'],
  files: { written: ['x.ts'], edited: [] },
  flow_seams: ['sdd:1b'],
  harness_verbs: { checks: 1 },
  checks: [{ status: 'ok' }],
  compactions: 0,
  tools: { Bash: 2 },
  gaps: [],
  duration_s: 42,
};

describe('SessionEvidence F13 lock-step (CLI ⟷ flow-eval extension)', () => {
  it('the CLI evidence is assignable to the extension evidence AND back (both carry duration_s)', () => {
    const asExt: ExtEvidence = SAMPLE; // fails to compile if the extension lacks duration_s
    const asCli: CliEvidence = asExt; // …and vice versa
    expect(asExt.duration_s).toBe(42);
    expect(asCli.duration_s).toBe(42);
    expect('duration_s' in SAMPLE).toBe(true);
  });

  it('honest absence: duration_s accepts null on both decls', () => {
    const cli: CliEvidence = { ...SAMPLE, duration_s: null };
    const ext: ExtEvidence = cli;
    expect(ext.duration_s).toBeNull();
  });

  it('F4: harness_session_id is lock-stepped across BOTH decls (and accepts null honestly)', () => {
    const asExt: ExtEvidence = SAMPLE; // fails to compile if the extension lacks harness_session_id
    expect(asExt.harness_session_id).toBe('hs-lock');
    const cliNull: CliEvidence = { ...SAMPLE, harness_session_id: null };
    const extNull: ExtEvidence = cliNull;
    expect(extNull.harness_session_id).toBeNull();
    expect('harness_session_id' in SAMPLE).toBe(true);
  });
});
