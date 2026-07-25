import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import {
  buildFleetEvidence,
  buildLedgerLane,
  type FleetRoster,
  getFleetEvidence,
  parseRoster,
} from '../../../src/services/telemetry/fleet-evidence.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import type { SessionEvidenceDeps } from '../../../src/services/telemetry/session-evidence.js';

/**
 * T002 (plan 051 Phase 1 · AC-02/03/04) — `getFleetEvidence` + `buildFleetEvidence`.
 *
 * The read-side FLEET join: merge N per-session {@link SessionEvidence} (REUSING the
 * exported `fold`) into one FleetEvidence with honest cost/time totals. Fixtures are
 * built through the REAL `serializeSegment` so the merge is proven against the actual
 * segment contract — not a bespoke shape (repo convention: real-shaped fixtures).
 *
 * Pins the load-bearing semantics:
 *  - AC-02: copilot `tokens: null` lanes are `cost_measured: false`, EXCLUDED from
 *    `totals.cost` (never zero-filled) and counted in `unmeasured_lanes`.
 *  - AC-03: `wall_clock_s` (union of lane spans) and `active_s` (sum) come from
 *    `event_stream[].t`, non-null; overlap ⇒ wall < active (parallelism).
 *  - AC-04: with a roster, membership scopes to it and `orphans`/`unrostered` diffs
 *    populate; without one the scope is `env-tree` and both are empty.
 */

const ROOT = 'pij-root';
const HOME = '/home/dev';

/** The telemetry buffer dir under a worktree root (mirrors `cursor.telemetryDir`). */
function tel(root: string): string {
  return `${root}/.harness/temp/telemetry`;
}

/** A turn event carrying an ISO timestamp + optional model/output — the time+model source. */
function turn(t: string, model?: string, out = 1): Event {
  const e: Event = { t, kind: 'turn', dur_s: 0, out };
  if (model !== undefined) e.model = model;
  return e;
}

/** Build a real-shaped serialized segment with the pij join keys in `captured_env`. */
function seg(opts: {
  sid: string;
  parent?: string | null;
  pijHarness?: string;
  harness?: string;
  events: Event[];
  tokens?: SegmentInput['tokens'];
  models?: SegmentInput['models'];
  timecode?: string;
}): Segment {
  const env: Record<string, string> = { PIJ_SESSION_ID: opts.sid };
  if (opts.parent) env.PIJ_PARENT_ID = opts.parent;
  if (opts.pijHarness) env.PIJ_HARNESS = opts.pijHarness;
  const input: SegmentInput = {
    command: 'flow',
    harness: opts.harness ?? 'claude-code',
    harness_session_id: `hs-${opts.sid}`,
    timecode: opts.timecode ?? opts.events[0]?.t ?? '2026-07-04T00:00:00Z',
    window: { since: 'session-start', from: 0, to: 1 },
    branch: null,
    tokens: opts.tokens ?? null,
    event_stream: opts.events,
    captured_env: env,
    models: opts.models,
  };
  return serializeSegment(input, '/repo');
}

/** Whole tokens object where grand_total is the headline cost. */
function tok(grand: number, output: number): SegmentInput['tokens'] {
  return {
    input: 0,
    output,
    cache_create: 0,
    cache_read: 0,
    total: output,
    subagent_tokens: 0,
    grand_total: grand,
  };
}

/** Lay segments out as a FakeFs buffer: `<tel>/<sub>/<seq>.json`, one sub per session. */
function layout(
  root: string,
  groups: Array<{ sub: string; segments: Segment[] }>,
): { files: Record<string, string>; dirs: Record<string, string[]> } {
  const files: Record<string, string> = {};
  const dirs: Record<string, string[]> = { [tel(root)]: groups.map((g) => g.sub) };
  for (const g of groups) {
    const names: string[] = [];
    g.segments.forEach((s, i) => {
      const name = `${i}.json`;
      names.push(name);
      files[`${tel(root)}/${g.sub}/${name}`] = JSON.stringify(s);
    });
    dirs[`${tel(root)}/${g.sub}`] = names;
  }
  return { files, dirs };
}

function makeDeps(opts: {
  files?: Record<string, string>;
  dirs?: Record<string, string[]>;
  home?: string;
  cwd?: string;
}): { deps: SessionEvidenceDeps; fs: FakeFs } {
  const fs = new FakeFs(opts.files ?? {}, opts.dirs ?? {});
  const deps: SessionEvidenceDeps = {
    fs,
    env: new FakeEnv({}, opts.home),
    proc: new FakeProcess({}, opts.cwd ?? '/nowhere'),
  };
  return { deps, fs };
}

/** A canonical 3-lane fleet: 2 measured claude children + 1 unmeasured copilot child. */
function threeLaneSegments(): Segment[] {
  return [
    seg({
      sid: 'pij-claude-a',
      parent: ROOT,
      pijHarness: 'claude',
      harness: 'claude-code',
      tokens: tok(1000, 100),
      models: { 'claude-opus-4.8': { turns: 1, output_tokens: 100 } },
      events: [turn('2026-07-04T00:00:00Z', 'claude-opus-4.8'), turn('2026-07-04T00:10:00Z')],
    }),
    seg({
      sid: 'pij-claude-b',
      parent: ROOT,
      pijHarness: 'claude',
      harness: 'claude-code',
      tokens: tok(400, 40),
      events: [turn('2026-07-04T00:20:00Z'), turn('2026-07-04T00:25:00Z')],
    }),
    seg({
      sid: 'pij-copilot',
      parent: ROOT,
      pijHarness: 'copilot',
      harness: 'copilot-cli',
      tokens: null, // F-07: copilot lanes capture null tokens
      events: [turn('2026-07-04T00:30:00Z'), turn('2026-07-04T00:40:00Z')],
    }),
  ];
}

describe('buildFleetEvidence — env-tree join, cost + time totals (D2/D3)', () => {
  it('joins the three children under the root, orchestrator lane absent', () => {
    const fleet = buildFleetEvidence(ROOT, threeLaneSegments(), null);
    expect(fleet).not.toBeNull();
    if (fleet === null) return;
    expect(fleet.root_pij_id).toBe(ROOT);
    expect(fleet.scope).toBe('env-tree');
    expect(fleet.sessions).toHaveLength(3);
    // Sorted by descending cost — the measured claude lanes lead.
    expect(fleet.sessions.map((l) => l.pij_id)).toEqual([
      'pij-claude-a',
      'pij-claude-b',
      'pij-copilot',
    ]);
    expect(fleet.totals.segments).toBe(3);
  });

  it('AC-02: copilot lane is cost_measured:false, EXCLUDED from totals (never zero-filled)', () => {
    const fleet = buildFleetEvidence(ROOT, threeLaneSegments(), null);
    if (fleet === null) throw new Error('expected a fleet');
    const copilot = fleet.sessions.find((l) => l.pij_id === 'pij-copilot');
    expect(copilot?.cost_measured).toBe(false);
    expect(copilot?.tokens).toEqual({ grand_total: 0, output: 0 });
    // grand_total = 1000 + 400 (claude only); copilot's null lane is NOT added as 0.
    expect(fleet.totals.cost.grand_total).toBe(1400);
    expect(fleet.totals.cost.output).toBe(140);
    expect(fleet.totals.cost.measured_lanes).toBe(2);
    expect(fleet.totals.cost.unmeasured_lanes).toBe(1);
  });

  it('reduces typed usage once across a live lane instead of summing snapshots', () => {
    const segments = [
      seg({
        sid: ROOT,
        tokens: tok(5, 5),
        events: [
          { t: '2026-07-04T00:00:01Z', kind: 'usage', observation_kind: 'message_output', out: 5 },
        ],
      }),
      seg({
        sid: ROOT,
        tokens: tok(100, 20),
        events: [
          {
            t: '2026-07-04T00:00:02Z',
            kind: 'usage',
            observation_kind: 'cumulative_checkpoint',
            in: 10,
            out: 20,
            cache_read: 30,
            cache_create: 40,
          },
        ],
      }),
      seg({
        sid: ROOT,
        tokens: tok(110, 22),
        events: [
          {
            t: '2026-07-04T00:00:03Z',
            kind: 'usage',
            observation_kind: 'final_shutdown',
            in: 11,
            out: 22,
            cache_read: 33,
            cache_create: 44,
          },
        ],
      }),
    ];
    const fleet = buildFleetEvidence(ROOT, segments, null);

    expect(fleet?.sessions[0]).toMatchObject({
      cost_measured: true,
      tokens: { grand_total: 110, output: 22 },
    });
    expect(fleet?.totals.cost).toMatchObject({ grand_total: 110, output: 22 });
  });

  it('does not let stale segment totals replace partial typed evidence', () => {
    const fleet = buildFleetEvidence(
      ROOT,
      [
        seg({
          sid: ROOT,
          tokens: tok(999, 99),
          events: [
            {
              t: '2026-07-04T00:00:03Z',
              kind: 'usage',
              observation_kind: 'final_shutdown',
              out: 22,
            },
          ],
        }),
      ],
      null,
    );

    expect(fleet?.sessions[0]).toMatchObject({
      cost_measured: false,
      tokens: { grand_total: 0, output: 22 },
    });
  });
  it('carries per-lane harness/model/role fields (AC-01 surface)', () => {
    const fleet = buildFleetEvidence(ROOT, threeLaneSegments(), null);
    if (fleet === null) throw new Error('expected a fleet');
    const a = fleet.sessions.find((l) => l.pij_id === 'pij-claude-a');
    expect(a?.harness).toBe('claude'); // the PIJ_HARNESS label, not `claude-code`
    expect(a?.model).toBe('claude-opus-4.8');
    expect(a?.role).toBeNull(); // no roster ⇒ no role
    const copilot = fleet.sessions.find((l) => l.pij_id === 'pij-copilot');
    expect(copilot?.harness).toBe('copilot');
    expect(copilot?.model).toBeNull();
  });

  it('AC-03: wall_clock_s (union) and active_s (sum) are non-null and honest under overlap', () => {
    // Two lanes with OVERLAPPING spans: [0,20] and [10,30] (minutes).
    const segments = [
      seg({
        sid: 'pij-x',
        parent: ROOT,
        pijHarness: 'claude',
        tokens: tok(10, 1),
        events: [turn('2026-07-04T00:00:00Z'), turn('2026-07-04T00:20:00Z')],
      }),
      seg({
        sid: 'pij-y',
        parent: ROOT,
        pijHarness: 'claude',
        tokens: tok(10, 1),
        events: [turn('2026-07-04T00:10:00Z'), turn('2026-07-04T00:30:00Z')],
      }),
    ];
    const fleet = buildFleetEvidence(ROOT, segments, null);
    if (fleet === null) throw new Error('expected a fleet');
    // active = 20min + 20min = 40min = 2400s; wall = union [0,30] = 30min = 1800s.
    expect(fleet.totals.time.active_s).toBe(2400);
    expect(fleet.totals.time.wall_clock_s).toBe(1800);
    // parallelism = active/wall > 1 ⇒ the lanes ran concurrently.
    expect(fleet.totals.time.active_s).toBeGreaterThan(fleet.totals.time.wall_clock_s ?? 0);
  });

  it('returns null when no segment joins to the root (fail-safe)', () => {
    const orphanSeg = seg({
      sid: 'pij-lonely',
      parent: 'pij-other',
      events: [turn('2026-07-04T00:00:00Z')],
    });
    expect(buildFleetEvidence(ROOT, [orphanSeg], null)).toBeNull();
    expect(buildFleetEvidence(ROOT, [], null)).toBeNull();
  });

  it('embeds the unchanged per-session SessionEvidence in each lane (reused fold)', () => {
    const fleet = buildFleetEvidence(ROOT, threeLaneSegments(), null);
    if (fleet === null) throw new Error('expected a fleet');
    const a = fleet.sessions.find((l) => l.pij_id === 'pij-claude-a');
    expect(a?.evidence.pij_session_id).toBe('pij-claude-a');
    expect(a?.evidence.segments).toBe(1);
    expect(a?.evidence.harness).toBe('claude-code');
  });
});

describe('buildFleetEvidence — roster scoping + D1 diffs (AC-04)', () => {
  const roster: FleetRoster = {
    members: [
      { role: 'coder', pij_id: 'pij-claude-a' },
      { role: 'reviewer', pij_id: 'pij-claude-b' },
      { role: 'validator', pij_id: 'pij-absent' }, // rostered but never spawned into the tree
    ],
  };

  it('scopes to the roster, attaches roles, and reports orphans + unrostered', () => {
    const fleet = buildFleetEvidence(ROOT, threeLaneSegments(), roster);
    if (fleet === null) throw new Error('expected a fleet');
    expect(fleet.scope).toBe('roster');
    // MEMBERSHIP scopes to the roster: only the two rostered lanes are in `sessions`.
    expect(fleet.sessions.map((l) => l.pij_id)).toEqual(['pij-claude-a', 'pij-claude-b']);
    // roles land on the matched lanes
    expect(fleet.sessions.find((l) => l.pij_id === 'pij-claude-a')?.role).toBe('coder');
    expect(fleet.sessions.find((l) => l.pij_id === 'pij-claude-b')?.role).toBe('reviewer');
    // the unrostered env-tree child is NOT a lane (diff only — not in `sessions`)
    expect(fleet.sessions.find((l) => l.pij_id === 'pij-copilot')).toBeUndefined();
    // orphan: rostered id with no env-tree match
    expect(fleet.orphans).toEqual(['pij-absent']);
    // unrostered: env-tree child not in the roster
    expect(fleet.unrostered).toEqual(['pij-copilot']);
  });

  it('a MEASURED unrostered child does NOT contaminate cost/time totals (F1 regression)', () => {
    // Roster covers ONLY pij-claude-a (measured, cost 1000). pij-claude-b is a
    // MEASURED (cost 400) env-tree child that is NOT in the roster. On the old
    // "labelled-not-scoped" behaviour it would leak into `sessions`/totals — this
    // pins that it does not: totals reflect the rostered lane alone.
    const coderOnly: FleetRoster = { members: [{ role: 'coder', pij_id: 'pij-claude-a' }] };
    const fleet = buildFleetEvidence(ROOT, threeLaneSegments(), coderOnly);
    if (fleet === null) throw new Error('expected a fleet');
    expect(fleet.scope).toBe('roster');
    // Only the rostered lane is present — the measured pij-claude-b is excluded.
    expect(fleet.sessions.map((l) => l.pij_id)).toEqual(['pij-claude-a']);
    // Cost is the rostered lane's alone (1000), NOT 1400 (the +400 leak) — one measured lane.
    expect(fleet.totals.cost.grand_total).toBe(1000);
    expect(fleet.totals.cost.output).toBe(100);
    expect(fleet.totals.cost.measured_lanes).toBe(1);
    expect(fleet.totals.cost.unmeasured_lanes).toBe(0);
    expect(fleet.totals.segments).toBe(1);
    // Time is the rostered lane's span [00:00,00:10] = 600s, not the union of all three.
    expect(fleet.totals.time.wall_clock_s).toBe(600);
    expect(fleet.totals.time.active_s).toBe(600);
    // Both unrostered children (one measured, one not) are diff-only.
    expect(fleet.unrostered).toEqual(['pij-claude-b', 'pij-copilot']);
    expect(fleet.orphans).toEqual([]);
  });

  it('env-tree scope (no roster) leaves both diffs empty', () => {
    const fleet = buildFleetEvidence(ROOT, threeLaneSegments(), null);
    if (fleet === null) throw new Error('expected a fleet');
    expect(fleet.orphans).toEqual([]);
    expect(fleet.unrostered).toEqual([]);
  });
});

describe('parseRoster — tolerant flow-pair run.json parse', () => {
  it('parses role → pijId + persisted join keys (SUGG-001), skipping null (lazy) members', () => {
    const raw = JSON.stringify({
      orchestrator: ROOT,
      roster: {
        coder: { pijId: 'pij-g7t974', harness: 'copilot', harnessSessionId: 'cf83-uuid' },
        reviewer: { pijId: null, note: 'lazy' },
        validator: {
          pijId: 'pij-wolk0r',
          harness: 'codex',
          transcriptPath: '/x/rollout.jsonl',
          model: 'gpt-5.5',
        },
      },
    });
    const parsed = parseRoster(raw);
    expect(parsed?.members).toEqual([
      {
        role: 'coder',
        pij_id: 'pij-g7t974',
        harness: 'copilot',
        harness_session_id: 'cf83-uuid',
        transcript_path: null,
        model: null,
      },
      {
        role: 'validator',
        pij_id: 'pij-wolk0r',
        harness: 'codex',
        harness_session_id: null,
        transcript_path: '/x/rollout.jsonl',
        model: 'gpt-5.5',
      },
    ]);
  });

  it('returns null for a body with no roster, and never throws on garbage', () => {
    expect(parseRoster(JSON.stringify({ run_id: 'x' }))).toBeNull();
    expect(parseRoster('not json {')).toBeNull();
  });
});

describe('getFleetEvidence — ports path, worktree-safe buffer resolution', () => {
  it('resolves the fleet from the cwd buffer and reads a roster from disk', () => {
    const { files, dirs } = layout('/wt', [
      { sub: 'hs-a', segments: [threeLaneSegments()[0]] },
      { sub: 'hs-b', segments: [threeLaneSegments()[1]] },
      { sub: 'hs-c', segments: [threeLaneSegments()[2]] },
    ]);
    const rosterPath = '/wt/.flow-pair/runs/r/run.json';
    const rosterRaw = JSON.stringify({
      roster: { coder: { pijId: 'pij-claude-a' }, reviewer: { pijId: 'pij-claude-b' } },
    });
    const { deps } = makeDeps({
      files: { ...files, [rosterPath]: rosterRaw },
      dirs,
      home: HOME,
      cwd: '/wt',
    });
    return getFleetEvidence(ROOT, deps, { worktree: '/wt', rosterPath }).then((fleet) => {
      expect(fleet).not.toBeNull();
      expect(fleet?.scope).toBe('roster');
      // Roster scopes membership: the two rostered claude lanes only (copilot is unrostered).
      expect(fleet?.sessions).toHaveLength(2);
      expect(fleet?.sessions.map((l) => l.pij_id)).toEqual(['pij-claude-a', 'pij-claude-b']);
      expect(fleet?.totals.cost.grand_total).toBe(1400);
      expect(fleet?.unrostered).toEqual(['pij-copilot']);
    });
  });

  it('returns null for an unknown root (no buffer) — never throws', async () => {
    const { deps } = makeDeps({ home: HOME, cwd: '/empty' });
    expect(await getFleetEvidence('pij-nope', deps, { worktree: '/empty' })).toBeNull();
  });

  it('scope is env-tree when no roster path is given', async () => {
    const { files, dirs } = layout('/wt', [
      { sub: 'hs-a', segments: [threeLaneSegments()[0]] },
      { sub: 'hs-b', segments: [threeLaneSegments()[1]] },
      { sub: 'hs-c', segments: [threeLaneSegments()[2]] },
    ]);
    const { deps } = makeDeps({ files, dirs, home: HOME, cwd: '/wt' });
    const fleet = await getFleetEvidence(ROOT, deps, { worktree: '/wt' });
    expect(fleet?.scope).toBe('env-tree');
    expect(fleet?.orphans).toEqual([]);
  });
});

/**
 * AC-07 — `fleet-export.schema.json` is CLOSED and counts-only. The repo carries no
 * JSON-schema validator (ajv), so this pins the closed-key contract STRUCTURALLY:
 * a tiny recursive checker walks a REAL `buildFleetEvidence` payload against the
 * schema and reports any key that escapes an `additionalProperties: false` object.
 *
 * NON-VACUOUS: inject an un-enumerated key (at the top level AND deep in a lane) and
 * the checker flips from 0 → ≥1 violation; flip `additionalProperties` to `true` in
 * the schema and the same injection would pass — so the guard genuinely bites.
 */
type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
};

const FLEET_SCHEMA = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../src/services/telemetry/fleet-export.schema.json', import.meta.url),
    ),
    'utf8',
  ),
) as JsonSchema;

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  const def = root.$defs?.[ref.replace('#/$defs/', '')];
  if (!def) throw new Error(`unresolved $ref ${ref}`);
  return def;
}

/** Collect every key that appears under an `additionalProperties:false` object but is not enumerated. */
function closedViolations(
  schema: JsonSchema,
  value: unknown,
  root: JsonSchema,
  path = '$',
): string[] {
  if (schema.$ref) return closedViolations(resolveRef(schema.$ref, root), value, root, path);
  const out: string[] = [];
  if (Array.isArray(value)) {
    if (schema.items) {
      value.forEach((v, i) => {
        out.push(...closedViolations(schema.items as JsonSchema, v, root, `${path}[${i}]`));
      });
    }
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const props = schema.properties ?? {};
    const addl = schema.additionalProperties;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const child = props[k];
      if (child) {
        out.push(...closedViolations(child, v, root, `${path}.${k}`));
      } else if (addl === false || addl === undefined) {
        out.push(`${path}.${k}`); // un-enumerated key under a closed object
      } else if (typeof addl === 'object') {
        out.push(...closedViolations(addl, v, root, `${path}.${k}`));
      }
    }
  }
  return out;
}

describe('AC-07 — fleet-export.schema.json is closed (un-enumerated key fails)', () => {
  it('a real buildFleetEvidence payload validates clean (0 violations)', () => {
    const fleet = buildFleetEvidence(ROOT, threeLaneSegments(), {
      members: [{ role: 'coder', pij_id: 'pij-claude-a' }],
    });
    if (fleet === null) throw new Error('expected a fleet');
    expect(closedViolations(FLEET_SCHEMA, fleet, FLEET_SCHEMA)).toEqual([]);
  });

  it('rejects an un-enumerated key at the top level', () => {
    const fleet = buildFleetEvidence(ROOT, threeLaneSegments(), null);
    if (fleet === null) throw new Error('expected a fleet');
    const bad = { ...fleet, leaked_prose: 'this must not be allowed' };
    expect(closedViolations(FLEET_SCHEMA, bad, FLEET_SCHEMA)).toContain('$.leaked_prose');
  });

  it('rejects an un-enumerated key deep inside a lane', () => {
    const fleet = buildFleetEvidence(ROOT, threeLaneSegments(), null);
    if (fleet === null) throw new Error('expected a fleet');
    const bad = structuredClone(fleet) as unknown as {
      sessions: Array<Record<string, unknown>>;
    };
    bad.sessions[0].secret_field = 'nope';
    expect(closedViolations(FLEET_SCHEMA, bad, FLEET_SCHEMA)).toContain(
      '$.sessions[0].secret_field',
    );
  });

  it('declares the top-level closed key set', () => {
    expect([...(FLEET_SCHEMA.required ?? [])].sort()).toEqual(
      ['orphans', 'root_pij_id', 'scope', 'sessions', 'totals', 'unrostered'].sort(),
    );
    expect(FLEET_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('P063 Phase 2 — billing-only ledger lanes', () => {
  const deps = (files: Record<string, string>): SessionEvidenceDeps => ({
    fs: new FakeFs(files),
    env: new FakeEnv({}, '/home/u'),
    proc: new FakeProcess({}, '/repo'),
  });

  it('preserves a total-only Codex headline without fabricating measured buckets', () => {
    const path = '/rollout.jsonl';
    const raw = JSON.stringify({
      type: 'token_count',
      payload: { info: { total_token_usage: { total_tokens: 999 } } },
    });
    const lane = buildLedgerLane(
      'pij-codex',
      'validator',
      {
        harness: 'codex',
        harness_session_id: 'hs-codex',
        transcript_path: path,
        model: null,
      } as never,
      deps({ [path]: raw }),
    );

    expect(lane).toMatchObject({
      cost_measured: true,
      tokens: { grand_total: 999, output: 0 },
      token_evidence: { coverage: 'unavailable', source: null },
      billing: { token_buckets: { total: 999 } },
    });
  });

  it('does not stamp a measured cache_create:0 the codex rollout never reported', () => {
    // Finding 09: codex reports input/cached/output/reasoning and has no cache-write
    // concept. Synthesizing a measured 0 is a zero-without-evidence, and it flipped the
    // lane to `measured` on the strength of a number nobody observed.
    const path = '/rollout.jsonl';
    const raw = JSON.stringify({
      type: 'token_count',
      payload: {
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 40,
            output_tokens: 20,
            total_tokens: 120,
          },
        },
      },
    });
    const lane = buildLedgerLane(
      'pij-codex',
      'validator',
      {
        harness: 'codex',
        harness_session_id: 'hs-codex',
        transcript_path: path,
        model: null,
      } as never,
      deps({ [path]: raw }),
    );

    expect(lane?.token_evidence.fields.cache_create).toMatchObject({
      value: null,
      coverage: 'unavailable',
    });
    // The buckets codex DID report stay measured; only the invented one goes away.
    expect(lane?.token_evidence.fields.output).toMatchObject({ value: 20, coverage: 'measured' });
    expect(lane?.token_evidence.coverage).toBe('partial');
    expect(lane?.token_evidence.reason).toBe('vendor_field_absent');
  });

  it('keeps nano-AIU billing while token buckets remain unavailable', () => {
    const path = '/home/u/.copilot/session-state/hs-copilot/events.jsonl';
    const raw = JSON.stringify({
      type: 'session.shutdown',
      data: { totalNanoAiu: 123 },
    });
    const lane = buildLedgerLane(
      'pij-copilot',
      'coder',
      {
        harness: 'copilot',
        harness_session_id: 'hs-copilot',
        transcript_path: null,
        model: null,
      } as never,
      deps({ [path]: raw }),
    );

    expect(lane).toMatchObject({
      cost_measured: false,
      token_evidence: { coverage: 'unavailable', source: null },
      billing: { nano_aiu: 123 },
    });
  });
});

// ── finding 08: one stale v1 segment must not collapse the whole fleet read ───────
describe('P063 finding 08 — a pre-v2.0 buffered segment degrades, it does not throw', () => {
  it('survives a segment with no event_stream instead of nulling every lane', async () => {
    const v1 = {
      command: 'flow',
      timecode: '2026-07-04T00:00:00Z',
      captured_env: { PIJ_SESSION_ID: ROOT, PIJ_HARNESS: 'claude' },
      tokens: {
        input: 10,
        output: 5,
        cache_read: 0,
        cache_create: 0,
        total: 15,
        subagent_tokens: 0,
        grand_total: 15,
      },
    };
    const repo = '/repo';
    const fs = new FakeFs(
      { [`${tel(repo)}/a/0.json`]: JSON.stringify(v1) },
      { [tel(repo)]: ['a'], [`${tel(repo)}/a`]: ['0.json'] },
    );
    const fleet = await getFleetEvidence(ROOT, {
      fs,
      env: new FakeEnv({}, HOME),
      proc: new FakeProcess({}, repo),
    });

    // Before the fix `segs.flatMap((seg) => seg.event_stream)` threw on the absent
    // array, `getFleetEvidence`'s catch swallowed it, and the ENTIRE fleet read
    // returned null — every lane lost because of one stale file.
    expect(fleet).not.toBeNull();
    expect(fleet?.sessions.map((l) => l.pij_id)).toContain(ROOT);
  });
});
