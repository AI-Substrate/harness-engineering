import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import type { HarnessVerb } from '../../../src/services/extensions/contract.js';
import type { VerbRegistry } from '../../../src/services/extensions/registry.js';
import { CORE_INSTRUCTIONS } from '../../../src/services/instructions/core-instructions.js';
import {
  buildCoreInstructions,
  loadVerbInstructions,
} from '../../../src/services/instructions/instructions-service.js';

const mkVerb = (name: string): HarnessVerb => ({
  name,
  summary: `${name} verb`,
  run: () => ({ status: 'ok' }),
});

const FLOW_DIR = '/repo/.harness/extensions/flow';
const SURVEY_DIR = '/repo/.harness/extensions/survey';

/** Two loaded extensions: `flow` (single verb) and `survey` (multi-verb: survey + report). */
function registry(): VerbRegistry {
  return {
    verbs: [mkVerb('flow'), mkVerb('survey'), mkVerb('report')],
    records: [
      { entryPath: `${FLOW_DIR}/extension.ts`, status: 'loaded', verbs: [mkVerb('flow')] },
      {
        entryPath: `${SURVEY_DIR}/extension.ts`,
        status: 'loaded',
        verbs: [mkVerb('survey'), mkVerb('report')],
      },
    ],
  };
}

describe('buildCoreInstructions', () => {
  it('returns the baked core briefing plus the verbs whose folders carry instructions.md', () => {
    /*
    Test Doc:
    - Why: a zero-context agent self-briefs from the tool itself (plan 014 AC-1) — the core
      briefing is a baked TS constant (versions with the CLI), and the agent needs to know
      WHICH verbs have their own briefing before querying them.
    - Contract: buildCoreInstructions(registry, fs) → { instructions: CORE_INSTRUCTIONS,
      verbs_with_instructions } where membership = FsPort existence check of
      dirname(record.entryPath)/instructions.md per verb (D4/D5).
    - Quality Contribution: pins the bare `harness instructions` payload shape.
    - Worked Example: flow has instructions.md, survey does not → ['flow'].
    */
    const fs = new FakeFs({ [`${FLOW_DIR}/instructions.md`]: '# Flow briefing' });
    const result = buildCoreInstructions(registry(), fs);
    expect(result.instructions).toBe(CORE_INSTRUCTIONS);
    expect(result.instructions.length).toBeGreaterThan(200);
    expect(result.verbs_with_instructions).toEqual(['flow']);
  });

  it('lists every verb of a multi-verb extension when its shared file exists (AC-2)', () => {
    const fs = new FakeFs({
      [`${FLOW_DIR}/instructions.md`]: '# Flow',
      [`${SURVEY_DIR}/instructions.md`]: '# Survey pack',
    });
    expect(buildCoreInstructions(registry(), fs).verbs_with_instructions).toEqual([
      'flow',
      'survey',
      'report',
    ]);
  });

  it('returns an empty verb list when no extension carries a briefing', () => {
    expect(buildCoreInstructions(registry(), new FakeFs()).verbs_with_instructions).toEqual([]);
  });
});

describe('CORE_INSTRUCTIONS — friction capture + drain (plan 015 AC-8)', () => {
  it('teaches the capture verb, the drain path, and the two storage classes', () => {
    /*
    Test Doc:
    - Why: the baked briefing is the ONLY zero-context channel (finding 09) — a fresh agent
      knowing nothing but `npx harness instructions` must learn how to capture friction and
      how to drain it after a context wipe, or AC-8 fails.
    - Contract: CORE_INSTRUCTIONS names `harness observe`, the `--list --json`/`--clear`
      drain path, `harness record retro` materialization, and both storage classes.
    */
    expect(CORE_INSTRUCTIONS).toContain('harness observe');
    expect(CORE_INSTRUCTIONS).toContain('--list --json');
    expect(CORE_INSTRUCTIONS).toContain('--clear');
    expect(CORE_INSTRUCTIONS).toContain('harness record retro');
    expect(CORE_INSTRUCTIONS).toContain('.harness/temp/');
    expect(CORE_INSTRUCTIONS).toContain('.harness/records/');
  });

  it('the envelope contract still leads — the capture section comes after it', () => {
    const envelopeAt = CORE_INSTRUCTIONS.indexOf('## The envelope contract');
    const captureAt = CORE_INSTRUCTIONS.indexOf('harness observe');
    expect(envelopeAt).toBeGreaterThanOrEqual(0);
    expect(captureAt).toBeGreaterThan(envelopeAt);
  });
});

describe('loadVerbInstructions', () => {
  it('returns the entire unmodified file content for a known verb (AC-2)', () => {
    const content = '# Flow briefing\n\nYou bring the inference; the verb brings determinism.\n';
    const fs = new FakeFs({ [`${FLOW_DIR}/instructions.md`]: content });
    expect(loadVerbInstructions('flow', registry(), fs)).toEqual({
      kind: 'ok',
      verb: 'flow',
      path: `${FLOW_DIR}/instructions.md`,
      instructions: content,
    });
  });

  it('multi-verb extensions share ONE instructions.md via the verb→folder mapping (D5)', () => {
    const fs = new FakeFs({ [`${SURVEY_DIR}/instructions.md`]: '# Shared briefing' });
    const forSurvey = loadVerbInstructions('survey', registry(), fs);
    const forReport = loadVerbInstructions('report', registry(), fs);
    expect(forSurvey.kind).toBe('ok');
    expect(forReport).toEqual(forSurvey === null ? null : { ...forSurvey, verb: 'report' });
  });

  it('reads at invocation time — an edit is visible on the next call, no rebuild (D4)', () => {
    /*
    Test Doc:
    - Why: per-extension briefings are runtime-loaded markdown — edit → next invocation
      MUST serve the new content with no rebuild and no cross-call caching (spec AC-2, D4).
    - Contract: loadVerbInstructions hits FsPort.readText on every call.
    - Worked Example: read, overwrite via FakeFs.writeText, read again → new content.
    */
    const fs = new FakeFs({ [`${FLOW_DIR}/instructions.md`]: 'v1' });
    expect(loadVerbInstructions('flow', registry(), fs)).toMatchObject({ instructions: 'v1' });
    fs.writeText(`${FLOW_DIR}/instructions.md`, 'v2 — edited live');
    expect(loadVerbInstructions('flow', registry(), fs)).toMatchObject({
      instructions: 'v2 — edited live',
    });
  });

  it('unknown verb → unknown-verb outcome (act maps it to unconfigured, D3)', () => {
    expect(loadVerbInstructions('nosuchverb', registry(), new FakeFs())).toEqual({
      kind: 'unknown-verb',
      verb: 'nosuchverb',
    });
  });

  it('known verb without instructions.md → missing outcome carrying the expected path (D3)', () => {
    expect(loadVerbInstructions('flow', registry(), new FakeFs())).toEqual({
      kind: 'missing',
      verb: 'flow',
      path: `${FLOW_DIR}/instructions.md`,
    });
  });

  it('file exists but cannot be read as text → unreadable outcome (E145 at the act, D3)', () => {
    const fs = new FakeFs();
    // a DIRECTORY named instructions.md: exists() is true, readText() is null.
    fs.mkdirp(`${FLOW_DIR}/instructions.md`);
    expect(loadVerbInstructions('flow', registry(), fs)).toEqual({
      kind: 'unreadable',
      verb: 'flow',
      path: `${FLOW_DIR}/instructions.md`,
    });
  });
});
