import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import {
  extractArtifact,
  matchExtractor,
} from '../../../src/services/telemetry/artifact-semantics.js';
import type { ArtifactEvent, Event } from '../../../src/services/telemetry/events.js';
import {
  type FleetEvidence,
  getFleetEvidence,
} from '../../../src/services/telemetry/fleet-evidence.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import type { SessionEvidenceDeps } from '../../../src/services/telemetry/session-evidence.js';

/**
 * THE PHASE-2 GATE (plan 052 · T011 · AC-07) — the golden 051-fleet SEMANTIC reconcile.
 *
 * The 051 debrief's §05 quality table was hand-assembled from repo files. This runs the
 * REAL semantic rollup over the REAL 051 fleet and diffs it against that table — but
 * FAITHFULLY: the rollup carries only what the INSTRUMENTED lanes captured. Per the
 * debrief's own honesty note, the orchestrator (claude) lane carried the plan / workshop
 * / dossier / backpressure / flight-plan artifact events; the coder emitted 0 artifact
 * events (F-07), and the reviewer + validator left no harness telemetry at all. So the
 * quality-STORY events — the 1 CRITICAL review finding and its FIX_REQUIRED→APPROVE fix
 * cycle — landed in BLIND lanes and are ABSENT from the rollup. That absence is the
 * honest answer (`semantics_measured:false`, never a fabricated 0), not a rollup bug.
 *
 * Method (the honest "over the real 051 fleet"): the orchestrator lane's artifact events
 * are replayed by running the REAL extractors (`artifact-semantics.ts`) over the REAL
 * committed 051 artifacts it authored — the same capture the live window would have run.
 * The review + validation are deliberately NOT attributed to the orchestrator: they ran
 * in untelemetered lanes, so they stay blind — reproducing the debrief's gap.
 *
 * Every discrepancy is enumerated in `docs/plans/052-.../evidence/fleet-051-note.md`
 * (§ semantics). This test pins the STABLE reconcile signals.
 */

const HOME = '/home/dev';
const REPO = '/home/dev/repo';
const ROOT = 'pij-4s10mb';
const CODER_PIJ = 'pij-g7t974';
const REVIEWER_PIJ = 'pij-106t2i1';
const VALIDATOR_PIJ = 'pij-wolk0r';

function tel(root: string): string {
  return `${root}/.harness/temp/telemetry`;
}
function fixture(rel: string): string {
  return readFileSync(new URL(`./fixtures/lane-sources/${rel}`, import.meta.url), 'utf8');
}
/** The real committed 051 plan dir (5 levels up: telemetry→services→test→cli→harness→root). */
function plan051(rel: string): string {
  return readFileSync(
    fileURLToPath(
      new URL(`../../../../../docs/plans/051-pij-fleet-session-eval/${rel}`, import.meta.url),
    ),
    'utf8',
  );
}

const CODER_SID = '34524328-5ab0-41c4-8cc9-62b03128930d';
const REVIEWER_SID = '6daaffe6-4e9b-4477-8d0d-007ca9dfb5b0';
const CODEX_ROLLOUT =
  '/home/dev/.codex/sessions/2026/07/04/rollout-2026-07-04T13-45-43-019f2b3b-6fbb-73b3-a9ec-b78a01deb9d0.jsonl';

/**
 * The orchestrator lane's artifact events — the REAL extractors run over the REAL 051
 * artifacts the orchestrator authored (plan, workshop, dossier, backpressure, the
 * flight plan, the execution log). The review + validation are OMITTED on purpose:
 * they ran in blind lanes (the honesty-note gap this reconcile is meant to surface).
 */
const ORCH_ARTIFACTS: Array<{ rel: string; repoRel: string }> = [
  {
    rel: 'pij-fleet-session-eval-plan.md',
    repoRel: 'docs/plans/051-pij-fleet-session-eval/pij-fleet-session-eval-plan.md',
  },
  {
    rel: 'workshops/001-fleet-join-and-eval-design.md',
    repoRel: 'docs/plans/051-pij-fleet-session-eval/workshops/001-fleet-join-and-eval-design.md',
  },
  {
    rel: 'research-dossier.md',
    repoRel: 'docs/plans/051-pij-fleet-session-eval/research-dossier.md',
  },
  {
    rel: 'backpressure-coverage.md',
    repoRel: 'docs/plans/051-pij-fleet-session-eval/backpressure-coverage.md',
  },
  { rel: 'the-flow.json', repoRel: 'docs/plans/051-pij-fleet-session-eval/the-flow.json' },
  {
    rel: 'tasks/phase-1/execution.log.md',
    repoRel: 'docs/plans/051-pij-fleet-session-eval/tasks/phase-1/execution.log.md',
  },
];

function orchestratorArtifactEvents(): ArtifactEvent[] {
  const out: ArtifactEvent[] = [];
  let minute = 1;
  for (const { rel, repoRel } of ORCH_ARTIFACTS) {
    const ex = matchExtractor(repoRel);
    if (ex === null) throw new Error(`no extractor for ${repoRel}`);
    const content = plan051(rel);
    const { counts, enums } = extractArtifact(ex, content);
    const t = `2026-07-04T04:${String(minute).padStart(2, '0')}:00Z`;
    minute += 1;
    out.push({
      t,
      kind: 'artifact',
      path: repoRel,
      artifact_type: ex.type,
      change: 'written',
      counts,
      enums,
      size: { lines: content.split('\n').length, bytes: Buffer.byteLength(content, 'utf8') },
    });
  }
  return out;
}

/** The orchestrator's live segment — real artifact events + a small (synthetic) live cost. */
function orchestratorSegment(): Segment {
  const events: Event[] = [
    { t: '2026-07-04T04:00:00Z', kind: 'turn', dur_s: 0, out: 100, model: 'claude-opus-4.8' },
    ...orchestratorArtifactEvents(),
    { t: '2026-07-04T04:30:00Z', kind: 'turn', dur_s: 0, out: 50 },
  ];
  const input: SegmentInput = {
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: '15eaa924-56f3-4427-9abc-000000000000',
    timecode: '2026-07-04T04:00:00Z',
    window: { since: 'session-start', from: 0, to: events.length },
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
    coder: { pijId: CODER_PIJ },
    reviewer: { pijId: REVIEWER_PIJ },
    validator: { pijId: VALIDATOR_PIJ },
    orchestrator: { pijId: ROOT },
  },
});

function reconcileDeps(): SessionEvidenceDeps {
  const files: Record<string, string> = {
    [`${REPO}/roster.json`]: ROSTER,
    [`${HOME}/.pij/pij-4s10mb.json`]: fixture('pij/pij-4s10mb.json'),
    [`${HOME}/.pij/pij-g7t974.json`]: fixture('pij/pij-g7t974.json'),
    [`${HOME}/.pij/pij-106t2i1.json`]: fixture('pij/pij-106t2i1.json'),
    [`${HOME}/.pij/pij-wolk0r.json`]: fixture('pij/pij-wolk0r.json'),
    [`${HOME}/.copilot/session-state/${CODER_SID}/events.jsonl`]: fixture(
      'copilot/coder-34524328.events.jsonl',
    ),
    [`${HOME}/.copilot/session-state/${REVIEWER_SID}/events.jsonl`]: fixture(
      'copilot/reviewer-6daaffe6.events.jsonl',
    ),
    [CODEX_ROLLOUT]: fixture('codex/validator-6fbb.rollout.jsonl'),
    [`${tel(REPO)}/orch/0.json`]: JSON.stringify(orchestratorSegment()),
  };
  const dirs: Record<string, string[]> = {
    [`${HOME}/.pij`]: ['pij-4s10mb.json', 'pij-g7t974.json', 'pij-106t2i1.json', 'pij-wolk0r.json'],
    [tel(REPO)]: ['orch'],
    [`${tel(REPO)}/orch`]: ['0.json'],
  };
  return {
    fs: new FakeFs(files, dirs),
    env: new FakeEnv({}, HOME),
    proc: new FakeProcess({}, REPO),
  };
}

async function reconcile(): Promise<FleetEvidence> {
  const fleet = await getFleetEvidence(ROOT, reconcileDeps(), {
    rosterPath: `${REPO}/roster.json`,
  });
  if (fleet === null) throw new Error('expected a fleet');
  return fleet;
}

describe('GOLDEN — the 051 fleet semantic reconcile vs debrief §05 (plan 052 · T011 · AC-07)', () => {
  it('exactly ONE lane is semantically measured — the instrumented orchestrator', async () => {
    const fleet = await reconcile();
    expect(fleet.semantics.measured_lanes).toBe(1);
    expect(fleet.semantics.blind_lanes).toBe(3);
    const orch = fleet.sessions.find((l) => l.role === 'orchestrator');
    expect(orch?.semantics.semantics_measured).toBe(true);
  });

  it('the three worker lanes are BLIND (semantics_measured:false) — the debrief gap, faithfully', async () => {
    const fleet = await reconcile();
    for (const pij of [CODER_PIJ, REVIEWER_PIJ, VALIDATOR_PIJ]) {
      const lane = fleet.sessions.find((l) => l.pij_id === pij);
      expect(lane?.semantics.semantics_measured).toBe(false);
      expect(lane?.semantics.artifact_events).toBe(0);
      // a blind lane carries NO dimension — never a zero-filled finding count.
      expect(lane?.semantics.findings).toBeUndefined();
    }
  });

  it('REPRODUCES §05 planning rows from the orchestrator lane (plan CS-3/1 phase, workshop, flight-plan, dossier)', async () => {
    const s = (await reconcile()).semantics;
    // Plan row: CS-3 · Simple · 1 phase (matches §05 exactly).
    expect(s.plan_phases).toBe(1);
    // Workshop row: the extractor counts 4 `Selected` markers (§05's hand count was 5 — D5
    // build-order wasn't `Selected`-marked; enumerated as a precision discrepancy in the note).
    expect(s.workshop_decisions).toBe(4);
    // Flow rail: 11 nodes. `done` is the CURRENT the-flow.json (run finished: 11 done) — §05's
    // 9/11 was captured mid-run at debrief time (time-of-capture drift, explained in the note).
    expect(s.nodes).toBe(11);
    expect(s.nodes_done).toBe(11);
  });

  it('is BLIND on the review story — NO findings, NO verdict path, NO fix cycle (they ran in a blind lane)', async () => {
    const s = (await reconcile()).semantics;
    // THE headline reconcile: §05 shows 1 CRITICAL + FIX_REQUIRED→APPROVE, but the review was
    // authored in the reviewer's untelemetered lane and the coder emitted 0 artifact events, so
    // the honest rollup carries NEITHER — absence, not a fabricated 0 (AC-07).
    expect(s.findings).toBeUndefined();
    expect(s.verdicts).toBeUndefined();
    expect(s.fix_cycles).toBeUndefined();
  });

  it('all four cost lanes still resolve (Phase 1 untouched) — the semantic layer is additive', async () => {
    const fleet = await reconcile();
    expect(fleet.sessions).toHaveLength(4);
    expect(fleet.totals.cost.measured_lanes).toBe(4);
  });
});
