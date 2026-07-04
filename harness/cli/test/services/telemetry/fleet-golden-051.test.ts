import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import {
  type FleetEvidence,
  type FleetLane,
  getFleetEvidence,
} from '../../../src/services/telemetry/fleet-evidence.js';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import type { SessionEvidenceDeps } from '../../../src/services/telemetry/session-evidence.js';

/**
 * THE PHASE GATE (plan 052 · T007 · AC-01) — the golden 051-fleet test.
 *
 * `get-fleet pij-4s10mb --roster …` over the REAL 051 run resolves **4/4 lanes** at
 * the EXACT numbers the debrief recovered by hand, via deterministic readers instead
 * of archaeology:
 *   - coder (copilot, pij-g7t974)      → 1,742.9 AIC   (source: ledger)
 *   - reviewer (copilot, pij-106t2i1)  →   298.5 AIC   (source: ledger)
 *   - validator (codex, pij-wolk0r)    → 1,368,083 tok (source: ledger)
 *   - orchestrator (claude, pij-4s10mb)→ live segments (source: live)
 *
 * Fixtures are the SCRUBBED REAL side-channels (counts/ids only): the actual coder +
 * reviewer `session.shutdown` events, the validator rollout `token_count` tail, and
 * the roster's pij descriptors (the orchestrator's is real; the reaped workers'
 * reconstructed to the real shape). The join is the pij registry: pij id →
 * harnessSessionId (copilot) / transcriptPath (codex). This is the run whose workers
 * have DIED — only the side channels + the still-live orchestrator remain (dossier
 * F-05). Precedence live → ledger makes it whole.
 */

const HOME = '/home/dev';
const REPO = '/home/dev/repo';
const ROOT = 'pij-4s10mb';

function tel(root: string): string {
  return `${root}/.harness/temp/telemetry`;
}

function fixture(rel: string): string {
  return readFileSync(new URL(`./fixtures/lane-sources/${rel}`, import.meta.url), 'utf8');
}

const FLEET_SCHEMA = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../src/services/telemetry/fleet-export.schema.json', import.meta.url),
    ),
    'utf8',
  ),
);

// ── the orchestrator's live segment (the only lane still in the buffer) ──────────
const CODER_SID = '34524328-5ab0-41c4-8cc9-62b03128930d';
const REVIEWER_SID = '6daaffe6-4e9b-4477-8d0d-007ca9dfb5b0';
const CODEX_ROLLOUT =
  '/home/dev/.codex/sessions/2026/07/04/rollout-2026-07-04T13-45-43-019f2b3b-6fbb-73b3-a9ec-b78a01deb9d0.jsonl';
const CODER_EVENTS = `${HOME}/.copilot/session-state/${CODER_SID}/events.jsonl`;
const CODER_PIJ = 'pij-g7t974';
const VALIDATOR_PIJ = 'pij-wolk0r';

function orchestratorSegment(): Segment {
  const events: Event[] = [
    { t: '2026-07-04T04:00:00Z', kind: 'turn', dur_s: 0, out: 100, model: 'claude-opus-4.8' },
    { t: '2026-07-04T04:30:00Z', kind: 'turn', dur_s: 0, out: 50 },
  ];
  const input: SegmentInput = {
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: '15eaa924-56f3-4427-9abc-000000000000',
    timecode: '2026-07-04T04:00:00Z',
    window: { since: 'session-start', from: 0, to: 2 },
    branch: null,
    tokens: {
      input: 500,
      output: 150,
      cache_create: 0,
      cache_read: 0,
      total: 650,
      subagent_tokens: 0,
      grand_total: 650,
    },
    event_stream: events,
    captured_env: { PIJ_SESSION_ID: ROOT, PIJ_HARNESS: 'claude' },
    models: { 'claude-opus-4.8': { turns: 1, output_tokens: 150 } },
  };
  return serializeSegment(input, REPO);
}

const ROSTER = JSON.stringify({
  roster: {
    coder: { pijId: 'pij-g7t974' },
    reviewer: { pijId: 'pij-106t2i1' },
    validator: { pijId: 'pij-wolk0r' },
    orchestrator: { pijId: ROOT },
  },
});

/**
 * The golden fixture deps. `overrides` patches the seeded file map AFTER the base
 * build (a `null` value DELETES that path — modelling an ABSENT side channel; a
 * string REPLACES it — modelling a malformed one), so the fix-001 negatives can flip
 * one lane's ledger without rebuilding the whole roster.
 */
function goldenDeps(overrides?: Record<string, string | null>): SessionEvidenceDeps {
  const seg = orchestratorSegment();
  const files: Record<string, string> = {
    // roster
    [`${REPO}/roster.json`]: ROSTER,
    // pij registry (the join)
    [`${HOME}/.pij/pij-4s10mb.json`]: fixture('pij/pij-4s10mb.json'),
    [`${HOME}/.pij/pij-g7t974.json`]: fixture('pij/pij-g7t974.json'),
    [`${HOME}/.pij/pij-106t2i1.json`]: fixture('pij/pij-106t2i1.json'),
    [`${HOME}/.pij/pij-wolk0r.json`]: fixture('pij/pij-wolk0r.json'),
    // copilot shutdown ledgers (coder + reviewer)
    [CODER_EVENTS]: fixture('copilot/coder-34524328.events.jsonl'),
    [`${HOME}/.copilot/session-state/${REVIEWER_SID}/events.jsonl`]: fixture(
      'copilot/reviewer-6daaffe6.events.jsonl',
    ),
    // codex rollout ledger (validator) — at the descriptor's transcriptPath
    [CODEX_ROLLOUT]: fixture('codex/validator-6fbb.rollout.jsonl'),
    // orchestrator live buffer segment
    [`${tel(REPO)}/orch/0.json`]: JSON.stringify(seg),
  };
  const dirs: Record<string, string[]> = {
    [`${HOME}/.pij`]: ['pij-4s10mb.json', 'pij-g7t974.json', 'pij-106t2i1.json', 'pij-wolk0r.json'],
    [tel(REPO)]: ['orch'],
    [`${tel(REPO)}/orch`]: ['0.json'],
  };
  for (const [path, content] of Object.entries(overrides ?? {})) {
    if (content === null) delete files[path];
    else files[path] = content;
  }
  return {
    fs: new FakeFs(files, dirs),
    env: new FakeEnv({}, HOME),
    proc: new FakeProcess({}, REPO),
  };
}

async function golden(): Promise<FleetEvidence> {
  const fleet = await getFleetEvidence(ROOT, goldenDeps(), { rosterPath: `${REPO}/roster.json` });
  if (fleet === null) throw new Error('expected a fleet');
  return fleet;
}

function laneByRole(fleet: FleetEvidence, role: string): FleetLane {
  const lane = fleet.sessions.find((l) => l.role === role);
  if (lane === undefined) throw new Error(`no lane for role ${role}`);
  return lane;
}

/** AIC (the human billing unit) rounded to 1dp, from a lane's nano_aiu. */
function aic1dp(lane: FleetLane): number {
  const nano = lane.billing?.nano_aiu ?? 0;
  return Number((nano / 1e9).toFixed(1));
}

describe('GOLDEN — the real 051 fleet resolves 4/4 lanes (plan 052 · T007 · AC-01)', () => {
  it('reports all four lanes, roster-scoped, no orphans', async () => {
    const fleet = await golden();
    expect(fleet.scope).toBe('roster');
    expect(fleet.sessions).toHaveLength(4);
    expect(fleet.orphans).toEqual([]);
    expect(fleet.sessions.map((l) => l.role).sort()).toEqual([
      'coder',
      'orchestrator',
      'reviewer',
      'validator',
    ]);
  });

  it('coder lane: 1,742.9 AIC from the copilot shutdown ledger (source: ledger)', async () => {
    const coder = laneByRole(await golden(), 'coder');
    expect(coder.harness).toBe('copilot');
    expect(coder.source).toBe('ledger');
    expect(coder.cost_measured).toBe(true);
    expect(coder.billing?.nano_aiu).toBe(1742858875000);
    expect(aic1dp(coder)).toBe(1742.9);
    expect(coder.billing?.token_buckets).toEqual({
      input: 16009,
      output: 139800,
      cache_read: 19952600,
      cache_create: 620359,
    });
  });

  it('reviewer lane: 298.5 AIC (a read-only peer, ledger-only)', async () => {
    const reviewer = laneByRole(await golden(), 'reviewer');
    expect(reviewer.source).toBe('ledger');
    expect(reviewer.billing?.nano_aiu).toBe(298534500000);
    expect(aic1dp(reviewer)).toBe(298.5);
  });

  it('validator lane: 1,368,083 tokens from the codex rollout (source: ledger)', async () => {
    const validator = laneByRole(await golden(), 'validator');
    expect(validator.harness).toBe('codex');
    expect(validator.source).toBe('ledger');
    expect(validator.cost_measured).toBe(true);
    expect(validator.billing?.token_buckets?.total).toBe(1368083);
    expect(validator.tokens.grand_total).toBe(1368083);
  });

  it('orchestrator lane: live segments (source: live), measured', async () => {
    const orch = laneByRole(await golden(), 'orchestrator');
    expect(orch.pij_id).toBe(ROOT);
    expect(orch.source).toBe('live');
    expect(orch.cost_measured).toBe(true);
    expect(orch.evidence.segments).toBe(1);
  });

  it('all four lanes are cost_measured — the debrief gap is closed (AC-01)', async () => {
    const fleet = await golden();
    expect(fleet.totals.cost.measured_lanes).toBe(4);
    expect(fleet.totals.cost.unmeasured_lanes).toBe(0);
  });

  it('the golden fleet validates clean against the closed schema (source + billing)', async () => {
    const fleet = await golden();
    expect(closedViolations(FLEET_SCHEMA, fleet, FLEET_SCHEMA)).toEqual([]);
  });

  it('the closed schema rejects an un-enumerated key inside a lane billing block (P12)', async () => {
    const fleet = await golden();
    const ledgerIdx = fleet.sessions.findIndex((l) => l.source === 'ledger');
    expect(ledgerIdx).toBeGreaterThanOrEqual(0);
    const bad = structuredClone(fleet) as unknown as {
      sessions: Array<{ billing?: Record<string, unknown> }>;
    };
    const lane = bad.sessions[ledgerIdx];
    lane.billing = { ...(lane.billing ?? {}), leaked_usd: 12.5 };
    expect(closedViolations(FLEET_SCHEMA, bad, FLEET_SCHEMA)).toContain(
      `$.sessions[${ledgerIdx}].billing.leaked_usd`,
    );
  });
});

describe('AC-06 — a flushed lane resolves via its ref rollup (source: ref) before the ledger', () => {
  const CODEX_ROLLOUT_SID = '019f2b3b-6fbb-73b3-a9ec-b78a01deb9d0';

  it('the validator, flushed to a ref, appears as source:"ref" (not orphan, not ledger)', async () => {
    // Its committed rollup carries 777,000 tokens — distinct from the codex ledger's
    // 1,368,083, so the assertion proves the REF tier won (precedence ref → ledger).
    const seg = serializeSegment(
      {
        command: 'flow',
        harness: 'codex',
        harness_session_id: CODEX_ROLLOUT_SID,
        timecode: '2026-07-04T00:00:00Z',
        window: { since: 'session-start', from: 0, to: 1 },
        branch: null,
        tokens: {
          input: 700000,
          output: 77000,
          cache_create: 0,
          cache_read: 0,
          total: 777000,
          subagent_tokens: 0,
          grand_total: 777000,
        },
        event_stream: [
          { t: '2026-07-04T00:00:00Z', kind: 'turn', dur_s: 0, in: 700000, out: 77000 },
        ],
      } as SegmentInput,
      REPO,
    );
    const gitRead = new FakeGitRead({
      [`refs/harness-telemetry/2026/07/04/${CODEX_ROLLOUT_SID}`]: [
        { name: 'session.logs.jsonl', content: `${JSON.stringify(segmentToOtlpLogs(seg))}\n` },
      ],
    });
    const fleet = await getFleetEvidence(ROOT, goldenDeps(), {
      rosterPath: `${REPO}/roster.json`,
      gitRead,
    });
    if (fleet === null) throw new Error('expected a fleet');
    const validator = fleet.sessions.find((l) => l.role === 'validator');
    expect(validator?.source).toBe('ref');
    expect(validator?.tokens.grand_total).toBe(777000);
    // The copilot workers still resolve via their ledgers (no ref) — precedence is per-lane.
    expect(fleet.sessions.find((l) => l.role === 'coder')?.source).toBe('ledger');
    expect(fleet.orphans).toEqual([]);
  });
});

// ── fix-001: a malformed side channel degrades the lane, it does not vanish ───────
describe('fix-001 — a malformed side-channel ledger degrades to an unmeasured lane (honesty invariant)', () => {
  // A `session.shutdown` that is PRESENT but carries no numeric `totalNanoAiu` — the
  // truncated / schema-drifted shape a real reader degrades to `measured:false`.
  const MALFORMED_COPILOT_SHUTDOWN = `${JSON.stringify({
    type: 'session.shutdown',
    data: { tokenDetails: { input: { tokenCount: 5 } } },
  })}\n`;
  // A codex rollout with a `token_count` event but no `total_token_usage.total_tokens`.
  const MALFORMED_CODEX_ROLLOUT = `${JSON.stringify({
    type: 'event_msg',
    payload: { type: 'token_count', info: { model_context_window: 200000 } },
  })}\n`;

  it('a rostered copilot member with a malformed shutdown stays a cost_measured:false ledger lane, counted in unmeasured_lanes', async () => {
    const fleet = await getFleetEvidence(
      ROOT,
      goldenDeps({ [CODER_EVENTS]: MALFORMED_COPILOT_SHUTDOWN }),
      { rosterPath: `${REPO}/roster.json` },
    );
    if (fleet === null) throw new Error('expected a fleet');

    // PRESENT, not vanished: the coder is still a first-class lane in sessions[]…
    const coder = fleet.sessions.find((l) => l.pij_id === CODER_PIJ);
    expect(coder).toBeDefined();
    expect(coder?.role).toBe('coder');
    expect(coder?.source).toBe('ledger');
    expect(coder?.cost_measured).toBe(false);
    expect(coder?.tokens).toEqual({ grand_total: 0, output: 0 });
    expect(coder?.billing).toBeUndefined();

    // …NOT quietly dropped into orphans, and the roster is still whole (4 lanes)…
    expect(fleet.orphans).not.toContain(CODER_PIJ);
    expect(fleet.sessions).toHaveLength(4);

    // …and COUNTED as an unmeasured lane so the accounting stays honest (F1).
    expect(fleet.totals.cost.unmeasured_lanes).toBe(1);
    expect(fleet.totals.cost.measured_lanes).toBe(3);

    // still a clean, closed-schema fleet (the degraded lane validates).
    expect(closedViolations(FLEET_SCHEMA, fleet, FLEET_SCHEMA)).toEqual([]);
  });

  it('a rostered codex member with a malformed rollout also degrades (both ledger branches)', async () => {
    const fleet = await getFleetEvidence(
      ROOT,
      goldenDeps({ [CODEX_ROLLOUT]: MALFORMED_CODEX_ROLLOUT }),
      { rosterPath: `${REPO}/roster.json` },
    );
    if (fleet === null) throw new Error('expected a fleet');

    const validator = fleet.sessions.find((l) => l.pij_id === VALIDATOR_PIJ);
    expect(validator).toBeDefined();
    expect(validator?.source).toBe('ledger');
    expect(validator?.cost_measured).toBe(false);
    expect(validator?.tokens).toEqual({ grand_total: 0, output: 0 });
    expect(fleet.orphans).not.toContain(VALIDATOR_PIJ);
    expect(fleet.totals.cost.unmeasured_lanes).toBe(1);
    expect(closedViolations(FLEET_SCHEMA, fleet, FLEET_SCHEMA)).toEqual([]);
  });

  it('by contrast an ABSENT side channel (no file) stays an honest orphan — the split is real, not over-correcting', async () => {
    const fleet = await getFleetEvidence(ROOT, goldenDeps({ [CODER_EVENTS]: null }), {
      rosterPath: `${REPO}/roster.json`,
    });
    if (fleet === null) throw new Error('expected a fleet');

    // no side-channel FILE at all → an orphan, never a zero-filled phantom lane.
    expect(fleet.sessions.find((l) => l.pij_id === CODER_PIJ)).toBeUndefined();
    expect(fleet.orphans).toContain(CODER_PIJ);
    expect(fleet.sessions).toHaveLength(3);
    expect(fleet.totals.cost.unmeasured_lanes).toBe(0);
    expect(fleet.totals.cost.measured_lanes).toBe(3);
  });
});

// ── a minimal closed-schema walker (mirrors fleet-evidence.test.ts) ──────────────
type JsonSchema = Record<string, unknown> & {
  $ref?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  $defs?: Record<string, JsonSchema>;
};

function resolveRef(ref: string, root: JsonSchema): JsonSchema {
  const def = root.$defs?.[ref.replace('#/$defs/', '')];
  if (!def) throw new Error(`unresolved $ref ${ref}`);
  return def;
}

function closedViolations(
  schema: JsonSchema,
  value: unknown,
  root: JsonSchema,
  path = '$',
): string[] {
  if (schema.$ref) return closedViolations(resolveRef(schema.$ref, root), value, root, path);
  const out: string[] = [];
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => {
      out.push(...closedViolations(schema.items as JsonSchema, v, root, `${path}[${i}]`));
    });
    return out;
  }
  if (value !== null && typeof value === 'object' && schema.properties) {
    for (const [k, v] of Object.entries(value)) {
      const child = schema.properties[k];
      if (child) {
        out.push(...closedViolations(child, v, root, `${path}.${k}`));
      } else if (schema.additionalProperties === false) {
        out.push(`${path}.${k}`);
      } else if (typeof schema.additionalProperties === 'object') {
        out.push(...closedViolations(schema.additionalProperties, v, root, `${path}.${k}`));
      }
    }
  }
  return out;
}
