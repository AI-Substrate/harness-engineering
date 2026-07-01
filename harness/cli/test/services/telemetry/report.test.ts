import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { otlpLogsToEvents } from '../../../src/services/telemetry/otlp/logs.js';
import {
  buildReport,
  matchesFilter,
  REPORT_DIMENSIONS,
  type Rollup,
  TELEMETRY_REPORT_SCHEMA_VERSION,
} from '../../../src/services/telemetry/report.js';
import { computeRollup } from '../../../src/services/telemetry/rollup.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  type CombineSessionDeps,
  combineSession,
  type SessionExport,
} from '../../../src/services/telemetry/session-export.js';

/**
 * Phase 2 (plan 047) — `buildReport` → `TelemetryReport`.
 *
 * TDD for the rollup COUNTS (T002/T003 — exact across all five dimensions), the
 * per-dimension time/token ATTRIBUTION (T004/T005 — estimated, declared,
 * NON-VACUOUS: every equality flips to FAIL under a deliberate mutation), the D1
 * `bash_command` no-double-count exclusion, and the cross-session re-aggregation.
 * Inputs are REAL `SessionExport`s built by the REAL `combineSession` over the
 * real scrubbed corpus + real `serializeSegment` — never a bespoke shape.
 */

const GOLDEN = (rel: string): Segment =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as Segment;

const CLAUDE = GOLDEN('./fixtures/real/claude/2026-06-25-static-site/expected-segment.json');
const CURSOR = GOLDEN('./fixtures/real/cursor/2026-06-25-checks-walkthrough/expected-segment.json');
const COPILOT = GOLDEN('./fixtures/real/copilot-cli/2026-06-24-checks-run/expected-segment.json');

const tel = (root: string): string => `${root}/.harness/temp/telemetry`;

function makeDeps(
  files: Record<string, string>,
  dirs: Record<string, string[]>,
): CombineSessionDeps {
  return {
    fs: new FakeFs(files, dirs),
    proc: new FakeProcess({}, '/nowhere'),
    env: new FakeEnv({}, '/home/dev'),
  };
}

/** Build ONE real `SessionExport` from a session's segment(s) via the REAL combine. */
function exportOf(sub: string, segments: object[]): SessionExport {
  const files: Record<string, string> = {};
  const names: string[] = [];
  segments.forEach((seg, i) => {
    files[`${tel('/work')}/${sub}/${i}.json`] = JSON.stringify(seg);
    names.push(`${i}.json`);
  });
  return combineSession(sub, makeDeps(files, { [`${tel('/work')}/${sub}`]: names }), {
    root: '/work',
  });
}

/** A real serialized v2 segment carrying a chosen event stream. */
function seg(events: Event[], over: Partial<SegmentInput> = {}): Segment {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'sessX',
      timecode: '2026-06-29T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: events,
      ...over,
    },
    '/repo',
  );
}

/** Row map by key for terse assertions (FX002 shape: `{input, output}`, optional time). */
function byKey(
  r: Rollup,
): Record<string, { count: number; time_s?: number; input: number; output: number }> {
  const out: Record<string, { count: number; time_s?: number; input: number; output: number }> = {};
  for (const e of r.entries) {
    out[e.key] = {
      count: e.count,
      time_s: e.time_s,
      input: e.tokens.input,
      output: e.tokens.output,
    };
  }
  return out;
}

// ── T002/T003 — exact counts across the five dimensions (real corpus) ────────

describe('T002/T003 — rollup counts are EXACT across all five dimensions', () => {
  it('tool counts equal computeRollup.tools; skill counts equal computeRollup.skills.runs (per real session)', () => {
    for (const [sub, segment] of [
      ['claude', CLAUDE],
      ['cursor', CURSOR],
      ['copilot', COPILOT],
    ] as const) {
      const exp = exportOf(sub, [segment]);
      const events = otlpLogsToEvents(exp.signals.logs).filter((e) => e.kind !== 'flow_log');
      const cr = computeRollup(events);
      const report = buildReport([exp]);

      const tool = byKey(report.rollups.tool);
      for (const [name, count] of Object.entries(cr.tools)) {
        expect(tool[name]?.count).toBe(count);
      }
      const skill = byKey(report.rollups.skill);
      for (const [name, s] of Object.entries(cr.skills)) {
        expect(skill[name]?.count).toBe(s.runs);
      }
    }
  });

  it('claude: tool {Bash:10,Write:1,AskUserQuestion:1,Edit:2}; bash_command by signature (Σ=10); no harness', () => {
    const report = buildReport([exportOf('claude', [CLAUDE])]);
    const tool = byKey(report.rollups.tool);
    expect(tool.Bash.count).toBe(10);
    expect(tool.Write.count).toBe(1);
    expect(tool.AskUserQuestion.count).toBe(1);
    expect(tool.Edit.count).toBe(2);
    // FX001-5: bash_command now keys by the captured command SIGNATURE (`git commit`,
    // `gh api`, …), not a single `bash` bucket; the per-signature counts still sum to
    // the 10 Bash calls. MUTATION: report keying by tool name (drop `e.signature ?? sk`)
    // collapses these back to a single `bash:10` row → `git commit` vanishes → fails.
    const bc = byKey(report.rollups.bash_command);
    expect(bc.bash).toBeUndefined();
    expect(bc['git commit'].count).toBe(1);
    expect(bc['gh api'].count).toBe(2);
    expect(Object.values(bc).reduce((n, e) => n + e.count, 0)).toBe(10);
    expect(report.rollups.harness_command.entries).toHaveLength(0);
    expect(report.scope.single).toBe(true);
  });

  it('cursor: tool {Shell:8,Glob:1,Read:1}; bash_command {node:8} (signature-keyed)', () => {
    const report = buildReport([exportOf('cursor', [CURSOR])]);
    const tool = byKey(report.rollups.tool);
    expect(tool.Shell.count).toBe(8);
    expect(tool.Glob.count).toBe(1);
    expect(tool.Read.count).toBe(1);
    // FX001-5: the 8 `node harness/cli/bin/harness.js …` shell calls key by their
    // `node` signature (argv dropped, P12). MUTATION: keying by tool name yields a
    // `shell:8` row instead → `node` is undefined → fails.
    expect(byKey(report.rollups.bash_command).node.count).toBe(8);
    expect(byKey(report.rollups.bash_command).shell).toBeUndefined();
  });

  it('D1 — copilot: harness_command {doctor:1}; the co-timed bash is EXCLUDED (bash_command empty, no double-count)', () => {
    const report = buildReport([exportOf('copilot', [COPILOT])]);
    expect(byKey(report.rollups.harness_command).doctor.count).toBe(1);
    expect(byKey(report.rollups.tool).bash.count).toBe(1); // the tool dimension still sees it
    expect(report.rollups.bash_command.entries).toHaveLength(0); // but bash_command excludes it
  });

  it('D1 non-vacuity — a bash NOT co-timed with the harness call IS counted (exclusion is timestamp-precise)', () => {
    const coincident = seg([
      { t: '2026-06-29T00:00:20Z', kind: 'harness', verb: 'doctor' },
      { t: '2026-06-29T00:00:20Z', kind: 'tools', name: 'bash', count: 1, span_s: 0 },
    ]);
    const apart = seg([
      { t: '2026-06-29T00:00:20Z', kind: 'harness', verb: 'doctor' },
      { t: '2026-06-29T00:00:25Z', kind: 'tools', name: 'bash', count: 1, span_s: 0 },
    ]);
    // Co-timed → excluded (0 rows); shifted 5s → counted (bash:1). The assertion discriminates.
    expect(buildReport([exportOf('a', [coincident])]).rollups.bash_command.entries).toHaveLength(0);
    expect(byKey(buildReport([exportOf('b', [apart])]).rollups.bash_command).bash.count).toBe(1);
  });
});

// ── T003 — single-vs-many: one shape, cross-session re-aggregation ───────────

describe('T003 — cross-session (N>1) sums the SAME key into ONE entry (re-aggregate from Logs)', () => {
  const bashSeg = (id: string): Segment =>
    seg([{ t: '2026-06-29T00:00:01Z', kind: 'tools', name: 'Bash', count: 5, span_s: 0 }], {
      harness_session_id: id,
    });

  it('two sessions each with Bash×5 → bash_command {bash:10} (ONE summed row), scope.single=false', () => {
    const report = buildReport([exportOf('s1', [bashSeg('s1')]), exportOf('s2', [bashSeg('s2')])]);
    expect(report.scope.session_count).toBe(2);
    expect(report.scope.single).toBe(false);
    const bash = byKey(report.rollups.bash_command);
    expect(bash.bash.count).toBe(10); // 5 + 5 summed into one entry
    expect(report.rollups.bash_command.entries).toHaveLength(1);
    expect(byKey(report.rollups.tool).Bash.count).toBe(10);
  });

  it('is NON-VACUOUS: dropping one session flips the summed count 10 → 5', () => {
    const two = buildReport([exportOf('s1', [bashSeg('s1')]), exportOf('s2', [bashSeg('s2')])]);
    const one = buildReport([exportOf('s1', [bashSeg('s1')])]);
    expect(byKey(two.rollups.bash_command).bash.count).toBe(10);
    expect(byKey(one.rollups.bash_command).bash.count).toBe(5); // the count assertion discriminates
  });

  it('totals.time_s equals Σ per-session ACTIVE time (agent+human, idle excluded)', () => {
    const e1 = exportOf('c', [CLAUDE]);
    const e2 = exportOf('r', [CURSOR]);
    const expectedActive = [e1, e2].reduce((s, e) => {
      const a = computeRollup(otlpLogsToEvents(e.signals.logs)).activity;
      return s + a.agent_working_s + a.human_s;
    }, 0);
    // FX002-5: totals.time_s is ACTIVE time (never wall-span). Tolerate ±1 for the
    // separate rounding of agent/human vs the summed active float.
    const actual = buildReport([e1, e2]).totals.time_s;
    expect(Math.abs(actual - expectedActive)).toBeLessThanOrEqual(1);
  });
});

// ── FX002-4 — flow_stage brackets consecutive /the-flow skill calls ──────────

describe('FX002-4 — flow_stage brackets consecutive /the-flow skill calls (report-time)', () => {
  // Two the-flow calls (stages 07, 08 — the FX001 Facet-B digit is the stage id);
  // active time + non-cache tokens accrue per bracket. Read + skill08 share a t.
  const flowSeg = (turnT: string): Segment =>
    seg([
      {
        t: '2026-06-29T00:00:00Z',
        kind: 'skill',
        name: 'the-flow',
        status: 'completed',
        arg: '07',
      },
      { t: '2026-06-29T00:01:00Z', kind: 'tools', name: 'Read', count: 1, span_s: 0 },
      {
        t: '2026-06-29T00:01:00Z',
        kind: 'skill',
        name: 'the-flow',
        status: 'completed',
        arg: '08',
      },
      { t: turnT, kind: 'turn', dur_s: 0, out: 100, in: 40 },
    ]);

  it('stage 07 gets the 60s bracket, stage 08 the 120s bracket; counts 1 each', () => {
    const fs = byKey(
      buildReport([exportOf('f', [flowSeg('2026-06-29T00:03:00Z')])]).rollups.flow_stage,
    );
    expect(fs['07'].time_s).toBe(60);
    expect(fs['08'].time_s).toBe(120);
    expect(fs['07'].count).toBe(1);
    expect(fs['08'].count).toBe(1);
    // The turn falls in stage 08 → its non-cache tokens land there.
    expect(fs['08'].output).toBe(100);
    expect(fs['08'].input).toBe(40);
  });

  it('is NON-VACUOUS: moving the turn earlier (00:02:00) shrinks stage 08 120 -> 60', () => {
    const later = buildReport([exportOf('f', [flowSeg('2026-06-29T00:03:00Z')])]);
    const earlier = buildReport([exportOf('f', [flowSeg('2026-06-29T00:02:00Z')])]);
    expect(byKey(later.rollups.flow_stage)['08'].time_s).toBe(120);
    expect(byKey(earlier.rollups.flow_stage)['08'].time_s).toBe(60);
  });

  it('a /the-flow call with NO digit arg -> an "unlabeled" bracket', () => {
    const s = seg([
      { t: '2026-06-29T00:00:00Z', kind: 'skill', name: 'the-flow', status: 'completed' },
      { t: '2026-06-29T00:00:30Z', kind: 'turn', dur_s: 0, out: 10, in: 0 },
    ]);
    const fs = byKey(buildReport([exportOf('u', [s])]).rollups.flow_stage);
    expect(fs.unlabeled).toBeDefined();
    expect(fs.unlabeled.count).toBe(1);
  });
});

// ── FX002 — command token attribution (launching-out + following-in) ─────────

describe('FX002 — command tokens: launching-out (even) + following-in (byte-weighted)', () => {
  it("a command's output = its share of the LAUNCHING turn's out (input 0 with no next turn)", () => {
    const s = seg([
      { t: '2026-06-29T00:00:00Z', kind: 'turn', dur_s: 0, out: 200, in: 0 },
      { t: '2026-06-29T00:00:30Z', kind: 'tools', name: 'Read', count: 1, span_s: 0 },
    ]);
    const read = byKey(buildReport([exportOf('t', [s])]).rollups.tool).Read;
    expect(read.output).toBe(200);
    expect(read.input).toBe(0);
  });

  it("a command's input = its share of the FOLLOWING turn's non-cache in (the dump)", () => {
    const s = seg([
      { t: '2026-06-29T00:00:00Z', kind: 'turn', dur_s: 0, out: 50, in: 0 },
      { t: '2026-06-29T00:00:10Z', kind: 'tools', name: 'catbig', count: 1, span_s: 0 },
      { t: '2026-06-29T00:00:20Z', kind: 'turn', dur_s: 0, out: 10, in: 900 },
    ]);
    // MUTATION: attributing input from the SAME (launching) turn flips input 900 -> 0.
    const cat = byKey(buildReport([exportOf('t', [s])]).rollups.tool).catbig;
    expect(cat.output).toBe(50); // launching turn0 out
    expect(cat.input).toBe(900); // following turn1 non-cache in
  });

  it('even-split: two tools in the launching window share the out and the next-turn in', () => {
    const s = seg([
      { t: '2026-06-29T00:00:00Z', kind: 'turn', dur_s: 0, out: 200, in: 0 },
      { t: '2026-06-29T00:00:10Z', kind: 'tools', name: 'Read', count: 1, span_s: 0 },
      { t: '2026-06-29T00:00:11Z', kind: 'tools', name: 'Edit', count: 1, span_s: 0 },
      { t: '2026-06-29T00:00:20Z', kind: 'turn', dur_s: 0, out: 0, in: 80 },
    ]);
    const tool = byKey(buildReport([exportOf('t', [s])]).rollups.tool);
    expect(tool.Read.output).toBe(100);
    expect(tool.Edit.output).toBe(100);
    expect(tool.Read.input).toBe(40); // even-split of next-turn in=80 (no result_tokens)
    expect(tool.Edit.input).toBe(40);
  });

  it('FX003 byte-weight: the input-split is proportional to result_tokens, else even', () => {
    const weighted = seg([
      { t: '2026-06-29T00:00:00Z', kind: 'turn', dur_s: 0, out: 0, in: 0 },
      {
        t: '2026-06-29T00:00:10Z',
        kind: 'tools',
        name: 'catbig',
        count: 1,
        span_s: 0,
        result_tokens: 300,
      },
      {
        t: '2026-06-29T00:00:11Z',
        kind: 'tools',
        name: 'gitst',
        count: 1,
        span_s: 0,
        result_tokens: 100,
      },
      { t: '2026-06-29T00:00:20Z', kind: 'turn', dur_s: 0, out: 0, in: 400 },
    ]);
    const tool = byKey(buildReport([exportOf('w', [weighted])]).rollups.tool);
    expect(tool.catbig.input).toBe(300); // 400 x 300/400
    expect(tool.gitst.input).toBe(100); // 400 x 100/400

    // MUTATION (the reviewer's "zero result_tokens"): weighting collapses to even.
    const even = seg([
      { t: '2026-06-29T00:00:00Z', kind: 'turn', dur_s: 0, out: 0, in: 0 },
      {
        t: '2026-06-29T00:00:10Z',
        kind: 'tools',
        name: 'catbig',
        count: 1,
        span_s: 0,
        result_tokens: 0,
      },
      {
        t: '2026-06-29T00:00:11Z',
        kind: 'tools',
        name: 'gitst',
        count: 1,
        span_s: 0,
        result_tokens: 0,
      },
      { t: '2026-06-29T00:00:20Z', kind: 'turn', dur_s: 0, out: 0, in: 400 },
    ]);
    const tool2 = byKey(buildReport([exportOf('e', [even])]).rollups.tool);
    expect(tool2.catbig.input).toBe(200);
    expect(tool2.gitst.input).toBe(200);
  });

  it('is NON-VACUOUS: mutating the launching-turn output flips the attributed output', () => {
    const mk = (out: number): Segment =>
      seg([
        { t: '2026-06-29T00:00:00Z', kind: 'turn', dur_s: 0, out, in: 0 },
        { t: '2026-06-29T00:00:30Z', kind: 'tools', name: 'Read', count: 1, span_s: 0 },
      ]);
    expect(byKey(buildReport([exportOf('t', [mk(200)])]).rollups.tool).Read.output).toBe(200);
    expect(byKey(buildReport([exportOf('t', [mk(999)])]).rollups.tool).Read.output).toBe(999);
  });
});

// ── FX002 — honest attribution rules (mutation-defended) ─────────────────────

describe('FX002 — idle / cache / skill-window / no-command-time (mutation-defended)', () => {
  it('idle-excluded: a >IDLE_CAP gap before a prompt contributes ZERO active time', () => {
    const s = seg([
      { t: '2026-06-29T00:00:00Z', kind: 'skill', name: 'grill', status: 'completed' },
      { t: '2026-06-29T00:00:30Z', kind: 'turn', dur_s: 0, out: 10, in: 0 },
      { t: '2026-06-29T01:00:30Z', kind: 'prompt', words: 5 }, // +1h ending at a prompt = idle
    ]);
    const report = buildReport([exportOf('i', [s])]);
    // active = 30s; the idle hour is excluded. MUTATION: dropping the classifyGap
    // idle-zeroing balloons this to ~3630s.
    expect(report.totals.time_s).toBe(30);
    expect(byKey(report.rollups.skill).grill.time_s).toBe(30);
  });

  it('cache-excluded: a huge cache_read never inflates any per-dimension token', () => {
    const s = seg([
      {
        t: '2026-06-29T00:00:00Z',
        kind: 'turn',
        dur_s: 0,
        out: 60,
        in: 0,
        cache_read: 9_000_000,
        cache_create: 5000,
      },
      { t: '2026-06-29T00:00:10Z', kind: 'tools', name: 'Read', count: 1, span_s: 0 },
    ]);
    const report = buildReport([exportOf('c', [s])]);
    const read = byKey(report.rollups.tool).Read;
    // MUTATION: folding cache_read into the per-dim token balloons this to millions.
    expect(read.output).toBe(60);
    expect(read.input).toBe(0);
    // cache lives at the SESSION level only, labelled "context re-reads".
    expect(report.totals.cache.read).toBe(9_000_000);
    expect(report.totals.cache.create).toBe(5000);
    expect(report.totals.tokens.input).toBe(0);
    expect(report.totals.tokens.output).toBe(60);
  });

  it('skill window spans this-call -> NEXT skill call (idle-excluded), never a point', () => {
    const s = seg([
      { t: '2026-06-29T00:00:00Z', kind: 'skill', name: 'plan', status: 'superseded' },
      { t: '2026-06-29T00:00:40Z', kind: 'turn', dur_s: 0, out: 10, in: 5 },
      { t: '2026-06-29T00:01:00Z', kind: 'skill', name: 'build', status: 'completed' },
      { t: '2026-06-29T00:01:30Z', kind: 'turn', dur_s: 0, out: 20, in: 8 },
    ]);
    const skill = byKey(buildReport([exportOf('s', [s])]).rollups.skill);
    // MUTATION: collapsing the window to a point (end = si) flips both times to 0.
    expect(skill.plan.time_s).toBe(60); // [00:00, 01:00)
    expect(skill.build.time_s).toBe(30); // [01:00, end)
    // tokens accrue over each window (non-cache in/out).
    expect(skill.plan.output).toBe(10);
    expect(skill.plan.input).toBe(5);
    expect(skill.build.output).toBe(20);
    expect(skill.build.input).toBe(8);
  });

  it('command rows (tool / bash_command / harness_command) carry NO time_s field', () => {
    const s = seg([
      { t: '2026-06-29T00:00:00Z', kind: 'turn', dur_s: 0, out: 10, in: 0 },
      {
        t: '2026-06-29T00:00:10Z',
        kind: 'tools',
        name: 'Bash',
        count: 1,
        span_s: 0,
        signature: 'rg',
      },
      { t: '2026-06-29T00:00:20Z', kind: 'harness', verb: 'checks' },
    ]);
    const report = buildReport([exportOf('n', [s])]);
    for (const dim of ['tool', 'bash_command', 'harness_command'] as const) {
      for (const e of report.rollups[dim].entries) {
        expect(e.time_s).toBeUndefined();
        expect('time_s' in e).toBe(false);
      }
      expect(report.rollups[dim].total.time_s).toBeUndefined();
      expect(JSON.stringify(report.rollups[dim].entries)).not.toContain('time_s');
    }
  });

  it('P12/reconciliation: no cache/total on any per-dim ROW; sum per-dim tokens <= session', () => {
    const s = seg([
      {
        t: '2026-06-29T00:00:00Z',
        kind: 'turn',
        dur_s: 0,
        out: 200,
        in: 100,
        cache_read: 777,
        cache_create: 88,
      },
      { t: '2026-06-29T00:00:10Z', kind: 'tools', name: 'Read', count: 1, span_s: 0 },
      { t: '2026-06-29T00:00:20Z', kind: 'turn', dur_s: 0, out: 60, in: 40 },
      { t: '2026-06-29T00:00:30Z', kind: 'tools', name: 'Edit', count: 1, span_s: 0 },
    ]);
    const report = buildReport([exportOf('r', [s])]);
    for (const dim of REPORT_DIMENSIONS) {
      const rowsJson = JSON.stringify(report.rollups[dim].entries);
      for (const forbidden of ['cache_read', 'cache_create', 'total']) {
        expect(rowsJson).not.toContain(forbidden);
      }
      expect(report.rollups[dim].total.tokens.output).toBeLessThanOrEqual(
        report.totals.tokens.output,
      );
      expect(report.rollups[dim].total.tokens.input).toBeLessThanOrEqual(
        report.totals.tokens.input,
      );
    }
    expect(report.totals.tokens.output).toBe(260); // 200 + 60
    expect(report.totals.tokens.input).toBe(140); // 100 + 40 (non-cache)
    expect(report.totals.cache.read).toBe(777);
    expect(report.totals.cache.create).toBe(88);
  });

  it('reconciliation: sum flow_stage.time == active time when the session opens with /the-flow', () => {
    const s = seg([
      {
        t: '2026-06-29T00:00:00Z',
        kind: 'skill',
        name: 'the-flow',
        status: 'completed',
        arg: '01',
      },
      { t: '2026-06-29T00:00:30Z', kind: 'turn', dur_s: 0, out: 10, in: 0 },
      {
        t: '2026-06-29T00:01:00Z',
        kind: 'skill',
        name: 'the-flow',
        status: 'completed',
        arg: '02',
      },
      { t: '2026-06-29T00:01:40Z', kind: 'turn', dur_s: 0, out: 20, in: 0 },
    ]);
    const report = buildReport([exportOf('fs', [s])]);
    expect(report.rollups.flow_stage.total.time_s ?? 0).toBe(report.totals.time_s);
    expect(report.rollups.tool.total.time_s).toBeUndefined();
  });
});

// ── T005 — degraded honesty: v1 zero-duration + unknown subagent tokens ──────

describe('T005 — v1 (zero-timeline) sessions attribute counts without crashing or dividing by zero', () => {
  const v1raw = {
    schema_version: '1.1',
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: 'sessV1',
    timecode: '2026-06-20T00:00:00Z',
    window: { since: 'session-start', from: 0, to: 1 },
    branch: null,
    tokens: {
      input: 10,
      output: 20,
      cache_read: 0,
      cache_create: 0,
      total: 30,
      subagent_tokens: 5,
      grand_total: 35,
    },
    skills: { 'the-flow': 2 },
    tools: { Bash: 3 },
    harness_commands: { flow: 4 },
    models: { 'claude-opus-4-8': { turns: 1, output_tokens: 20 } },
  };

  it('preserves v1 counts, yields ~0 time (no timeline), and never throws', () => {
    let report: ReturnType<typeof buildReport> | undefined;
    expect(() => {
      report = buildReport([exportOf('v1', [v1raw])]);
    }).not.toThrow();
    if (report === undefined) throw new Error('unreachable');
    expect(byKey(report.rollups.skill)['the-flow'].count).toBe(2);
    expect(byKey(report.rollups.harness_command).flow.count).toBe(4);
    // Every synthetic v1 event shares one timecode → zero-width windows → 0 time everywhere.
    for (const e of report.rollups.skill.entries) expect(e.time_s).toBe(0);
    expect(report.totals.time_s).toBe(0);
  });
});

// ── Filtering, sorting, truncation ───────────────────────────────────────────

describe('filter — facets narrow the range and are echoed into report.filter', () => {
  const claudeExp = exportOf('c', [
    seg([{ t: '2026-06-29T00:00:01Z', kind: 'tools', name: 'Bash', count: 1, span_s: 0 }], {
      harness: 'claude-code',
      models: { 'claude-opus-4-8': { turns: 1, output_tokens: 1 } },
      branch: 'feat/x',
    }),
  ]);
  const copilotExp = exportOf('p', [
    seg([{ t: '2026-06-29T00:00:01Z', kind: 'tools', name: 'bash', count: 1, span_s: 0 }], {
      harness: 'copilot-cli',
      models: { 'gpt-5.5': { turns: 1, output_tokens: 1 } },
      branch: 'main',
    }),
  ]);

  it('--filter-harness keeps only matching sessions and echoes the facet', () => {
    const report = buildReport([claudeExp, copilotExp], { filter: { harness: ['copilot-cli'] } });
    expect(report.scope.session_count).toBe(1);
    expect(report.filter.harness).toEqual(['copilot-cli']);
    expect(report.provenance.harnesses).toEqual(['copilot-cli']);
  });

  it('--filter-model narrows on identity.models', () => {
    expect(
      buildReport([claudeExp, copilotExp], { filter: { model: ['claude-opus-4-8'] } }).scope
        .session_count,
    ).toBe(1);
  });

  it('matchesFilter is directly testable (fakes-over-mocks): branch facet', () => {
    expect(matchesFilter(claudeExp, { branch: ['feat/x'] })).toBe(true);
    expect(matchesFilter(claudeExp, { branch: ['main'] })).toBe(false);
  });

  it('repo is ECHO-ONLY (not applied) — a --filter-repo report keeps every session but records intent', () => {
    const report = buildReport([claudeExp, copilotExp], { filter: { repo: ['some-repo'] } });
    expect(report.scope.session_count).toBe(2); // NOT narrowed
    expect(report.filter.repo).toEqual(['some-repo']); // but echoed
  });
});

describe('sort + truncation', () => {
  const s = seg([
    { t: '2026-06-29T00:00:00Z', kind: 'tools', name: 'A', count: 1, span_s: 0 },
    { t: '2026-06-29T00:00:01Z', kind: 'tools', name: 'B', count: 5, span_s: 0 },
    { t: '2026-06-29T00:00:02Z', kind: 'tools', name: 'C', count: 3, span_s: 0 },
  ]);

  it('--sort count orders rows desc by count', () => {
    const tool = buildReport([exportOf('s', [s])], { sort: 'count' }).rollups.tool;
    expect(tool.entries.map((e) => e.key)).toEqual(['B', 'C', 'A']);
  });

  it('--top caps rows and surfaces `truncated` (never silent); total stays over ALL rows', () => {
    const tool = buildReport([exportOf('s', [s])], { sort: 'count', top: 2 }).rollups.tool;
    expect(tool.entries).toHaveLength(2);
    expect(tool.truncated).toBe(1);
    expect(tool.total.count).toBe(9); // 1+5+3 — computed before the cap
  });
});

describe('envelope basics', () => {
  it('pins the schema_version const and stamps provenance from the caller', () => {
    const report = buildReport(
      [exportOf('s', [seg([{ t: '2026-06-29T00:00:01Z', kind: 'turn', dur_s: 0, out: 1 }])])],
      {
        generatedAt: '2026-07-01T00:00:00Z',
        sourcePaths: ['./sessions'],
      },
    );
    expect(report.schema_version).toBe(TELEMETRY_REPORT_SCHEMA_VERSION);
    expect(report.provenance.generated_at).toBe('2026-07-01T00:00:00Z');
    expect(report.provenance.source_paths).toEqual(['./sessions']);
    expect(report.attribution.bash_command_key).toBe('shell-command-signature-or-tool-name');
  });
});

// ── Schema self-description: attribution.required (D1 contract) ───────────────

describe('report.schema.json — attribution.required pins the D1 self-description', () => {
  const schema = JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../src/services/telemetry/report.schema.json', import.meta.url)),
      'utf8',
    ),
  ) as { properties: { attribution: { required: string[] } } };

  it('requires bash_command_key + notes (a report omitting the D1 self-description must NOT validate)', () => {
    const required = schema.properties.attribution.required;
    // The two the D1 contract depends on — added by this fix.
    expect(required).toContain('bash_command_key');
    expect(required).toContain('notes');
    // …without dropping the original three (no regression).
    expect(required).toEqual(
      expect.arrayContaining(['tokens', 'time', 'exact', 'bash_command_key', 'notes']),
    );
  });

  it('the REAL emitted report satisfies EVERY attribution.required key', () => {
    const report = buildReport(
      [exportOf('s', [seg([{ t: '2026-06-29T00:00:01Z', kind: 'turn', dur_s: 0, out: 1 }])])],
      { generatedAt: '2026-07-01T00:00:00Z' },
    );
    const attribution = report.attribution as unknown as Record<string, unknown>;
    for (const key of schema.properties.attribution.required) {
      expect(attribution[key]).toBeDefined();
    }
    // …and the two this fix pins are present + correctly typed + non-empty.
    expect(typeof report.attribution.bash_command_key).toBe('string');
    expect(Array.isArray(report.attribution.notes)).toBe(true);
    expect(report.attribution.notes.length).toBeGreaterThan(0);
  });
});
