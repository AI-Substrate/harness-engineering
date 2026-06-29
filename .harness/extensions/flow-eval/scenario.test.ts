import { existsSync, readFileSync } from 'node:fs';
import { dirname, join as njoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../harness/cli/src/adapters/fs/fake-fs.js';
import { loadScenario, type ScenarioFs } from './scenario.js';

/*
Test Doc:
- Why: the loader is the AC-04 gate — a VALID committed bundle must load into a typed
  object, and EVERY malformed shape must return a descriptive `error` (never a throw,
  never a silent partial). Pins the workshop §1–§2 schema + the type/source-lane check.
- Contract: load over the committed md-to-pdf fixture → ok with 13 assertions; missing
  file / bad JSON / missing field / unknown type / source-lane mismatch / dup id / empty
  list → { ok:false, error } whose message names the fault.
*/

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_SCENARIOS = njoin(HERE, 'fixtures', 'scenarios');

/** A ScenarioFs backed by the REAL committed fixture on disk (proves it's valid). */
const diskFs: ScenarioFs = {
  exists: (p) => existsSync(p),
  readText: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
};

/** A minimal VALID scenario.json (overridable to construct malformed variants). */
function scenarioJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    slug: 'x',
    title: 't',
    task: 'do a thing',
    base: { repo: '.', ref: 'HEAD' },
    subject: { harness: 'claude', model: 'opus' },
    flow: { mode: 'simple', stages: ['explore'] },
    prompts: { orchestrator: 'prompts/o.md', subject: 'prompts/s.md' },
    assertions: 'assertions.json',
    ...over,
  });
}

function assertionsJson(assertions: unknown[]): string {
  return JSON.stringify({ scenario: 'x', assertions });
}

/** Seed a FakeFs at scenariosRoot=/s with a scenario bundle for slug `x`. */
function bundleFs(scenario: string, assertions: string): FakeFs {
  return new FakeFs({
    '/s/x/scenario.json': scenario,
    '/s/x/assertions.json': assertions,
  });
}

describe('loadScenario — the committed md-to-pdf fixture', () => {
  it('loads the bundle into a typed object with all 13 assertions', () => {
    const r = loadScenario('md-to-pdf', diskFs, FIXTURE_SCENARIOS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scenario.config.slug).toBe('md-to-pdf');
    expect(r.scenario.config.base.ref).toBe('v0.6.0');
    expect(r.scenario.config.subject).toMatchObject({ harness: 'claude', model: 'opus' });
    expect(r.scenario.assertions).toHaveLength(13);
    expect(r.scenario.assertions[0]).toMatchObject({
      id: 'A1',
      type: 'skill-called',
      source: 'telemetry',
      required: true,
    });
    // judged is carried through as a normal entry (the scorer routes it later).
    expect(r.scenario.assertions.at(-1)).toMatchObject({ type: 'judged', source: 'judged' });
  });
});

describe('loadScenario — malformed bundles return a descriptive error (no throw)', () => {
  it('missing scenario.json', () => {
    const r = loadScenario('x', new FakeFs(), '/s');
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/scenario not found/);
  });

  it('invalid JSON in scenario.json', () => {
    const r = loadScenario('x', bundleFs('{ not json', assertionsJson([])), '/s');
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/invalid JSON/i);
  });

  it("missing required field ('base')", () => {
    const bad = scenarioJson({ base: undefined });
    const r = loadScenario('x', bundleFs(bad, assertionsJson([])), '/s');
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/base/);
  });

  it('unknown assertion type', () => {
    const r = loadScenario(
      'x',
      bundleFs(scenarioJson(), assertionsJson([{ id: 'A1', type: 'teleport', source: 'telemetry', params: {} }])),
      '/s',
    );
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/unknown type 'teleport'/);
  });

  it('source not valid for the type (lane mismatch)', () => {
    const r = loadScenario(
      'x',
      bundleFs(scenarioJson(), assertionsJson([{ id: 'A1', type: 'file-created', source: 'telemetry', params: {} }])),
      '/s',
    );
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/source 'telemetry' is not valid for type 'file-created'/);
  });

  it('duplicate assertion id', () => {
    const r = loadScenario(
      'x',
      bundleFs(
        scenarioJson(),
        assertionsJson([
          { id: 'A1', type: 'tool-used', source: 'telemetry', params: { tool: 'Write' } },
          { id: 'A1', type: 'tool-used', source: 'telemetry', params: { tool: 'Edit' } },
        ]),
      ),
      '/s',
    );
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/duplicate id 'A1'/);
  });

  it('empty assertions list', () => {
    const r = loadScenario('x', bundleFs(scenarioJson(), assertionsJson([])), '/s');
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/empty/);
  });
});
