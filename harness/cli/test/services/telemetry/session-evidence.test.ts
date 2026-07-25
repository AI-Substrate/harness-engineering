import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { segmentToOtlpLogs } from '../../../src/services/telemetry/otlp/logs.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  getSessionEvidence,
  getSessionEvidenceFromContext,
  locateSession,
  type SessionEvidenceContext,
  type SessionEvidenceDeps,
} from '../../../src/services/telemetry/session-evidence.js';

/**
 * T002 (plan 041 Phase 1 · AC-01/02/03 · Findings 02b/03/06) — `getSessionEvidence`.
 *
 * Pins the read path to the plan-037 real fixture corpus (claude + copilot-cli,
 * both carry `invariants.json` + `expected-segment.json`): the committed golden IS
 * a serialized segment, so we tag it with a `captured_env.PIJ_SESSION_ID`, drop it
 * into a FakeFs buffer, and assert the folded evidence. Event kinds the two real
 * captures happen not to exercise (skill / flow / checks / compaction) are covered
 * by hand-built segments run through the REAL `serializeSegment`, so the derivation
 * is proven against the actual contract — not a bespoke shape.
 *
 * Also pins: the worktree-safe, cwd-independent locator (Finding 02b — the spike),
 * the `PIJ_SESSION_ID` join (two pij sessions in one buffer never bleed), gaps →
 * explicit `gaps[]` (null subagent tokens / empty plans_touched, Finding 03), and
 * the fail-safe `null` (missing id never throws).
 */

const HOME = '/home/dev';

const GOLDEN = (rel: string): Segment =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as Segment;

const CLAUDE = GOLDEN('./fixtures/real/claude/2026-06-25-static-site/expected-segment.json');
const COPILOT = GOLDEN('./fixtures/real/copilot-cli/2026-06-24-checks-run/expected-segment.json');

/** Tag a serialized segment with the pij join key (the live capture writes this from `$PIJ_SESSION_ID`). */
function tag(seg: Segment, pijId: string): Segment {
  return { ...seg, captured_env: { ...(seg.captured_env ?? {}), PIJ_SESSION_ID: pijId } };
}

/** The telemetry buffer dir under a worktree root (mirrors `cursor.telemetryDir`). */
function tel(root: string): string {
  return `${root}/.harness/temp/telemetry`;
}

/** Lay segments out as a FakeFs buffer: `<tel>/<sub>/<seq>.json`, one sub per group. */
function layout(
  root: string,
  groups: Array<{ sub: string; segments: object[] }>,
): { files: Record<string, string>; dirs: Record<string, string[]> } {
  const files: Record<string, string> = {};
  const dirs: Record<string, string[]> = { [tel(root)]: groups.map((g) => g.sub) };
  for (const g of groups) {
    const names: string[] = [];
    g.segments.forEach((seg, i) => {
      const name = `${i}.json`;
      names.push(name);
      files[`${tel(root)}/${g.sub}/${name}`] = JSON.stringify(seg);
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

/** A hand-built serialized segment carrying an arbitrary event stream + pij tag. */
function synthetic(pijId: string, events: Event[], over: Partial<SegmentInput> = {}): Segment {
  const input: SegmentInput = {
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: 'syn',
    timecode: '2026-06-29T00:00:00Z',
    window: { since: 'session-start', from: 0, to: 1 },
    branch: null,
    tokens: {
      input: 1,
      output: 1,
      cache_create: 0,
      cache_read: 0,
      total: 2,
      subagent_tokens: 0,
      grand_total: 2,
    },
    event_stream: events,
    captured_env: { PIJ_SESSION_ID: pijId },
    ...over,
  };
  return serializeSegment(input, '/repo');
}

describe('locateSession — worktree-safe, cwd-independent buffer resolution (Finding 02b)', () => {
  it('resolves the pij peer folder from ~/.pij/<id>.json regardless of cwd', () => {
    const { files, dirs } = layout('/work', [{ sub: 'sessA', segments: [tag(CLAUDE, 'pij-a')] }]);
    const { deps } = makeDeps({
      files: { ...files, [`${HOME}/.pij/pij-a.json`]: JSON.stringify({ folder: '/work' }) },
      dirs,
      home: HOME,
      cwd: '/somewhere/else', // cwd has NO buffer — resolution must not depend on it
    });
    expect(locateSession('pij-a', deps)).toBe(tel('/work'));
  });

  it('honors an explicit worktree override', () => {
    const { files, dirs } = layout('/wt', [{ sub: 'sessA', segments: [tag(CLAUDE, 'pij-a')] }]);
    const { deps } = makeDeps({ files, dirs, home: HOME, cwd: '/elsewhere' });
    expect(locateSession('pij-a', deps, { worktree: '/wt' })).toBe(tel('/wt'));
  });

  it('returns null for an unknown id (no pij state, empty cwd buffer) — never throws', () => {
    const { deps } = makeDeps({ home: HOME, cwd: '/empty' });
    expect(locateSession('pij-missing', deps)).toBeNull();
  });
});

describe('getSessionEvidence — fold plan-037 fixtures into normalized evidence', () => {
  it('parses the claude golden: tools/files from the segment, empty derived fields, plans gap', async () => {
    const { files, dirs } = layout('/wt', [{ sub: 'sessA', segments: [tag(CLAUDE, 'pij-c')] }]);
    const { deps } = makeDeps({ files, dirs });
    const ev = await getSessionEvidence('pij-c', deps, { worktree: '/wt' });

    expect(ev).not.toBeNull();
    if (!ev) return;
    expect(ev.pij_session_id).toBe('pij-c');
    expect(ev.harness).toBe('claude-code');
    expect(ev.segments).toBe(1);
    // tools = SUM of each `tools` event's count (matches the segment's v1 tools view)
    expect(ev.tools).toEqual({ Bash: 10, Write: 1, AskUserQuestion: 1, Edit: 2 });
    // files read from the segment FIELD (duplicates preserved — there is no file event kind)
    expect(ev.files).toEqual({
      written: ['.github/workflows/pages.yml'],
      edited: ['.github/workflows/pages.yml', '.github/workflows/pages.yml'],
    });
    expect(ev.skills).toEqual({});
    expect(ev.skill_order).toEqual([]);
    expect(ev.flow_seams).toEqual([]);
    expect(ev.harness_verbs).toEqual({});
    expect(ev.checks).toEqual([]);
    expect(ev.compactions).toBe(0);
    // subagent_tokens is a known 0 here → NOT a gap; plans_touched absent → gap
    expect(ev.gaps).toEqual(['plans_touched']);
    expect(ev.token_evidence).toMatchObject({
      coverage: 'measured',
      source: 'live',
      fields: {
        input: { value: CLAUDE.tokens?.input, source: 'live' },
        cache_read: { value: CLAUDE.tokens?.cache_read, source: 'live' },
        cache_create: { value: CLAUDE.tokens?.cache_create, source: 'live' },
      },
    });
  });

  it('parses the copilot-cli golden: harness verb + tool counts', async () => {
    const { files, dirs } = layout('/wt', [{ sub: 'sessX', segments: [tag(COPILOT, 'pij-k')] }]);
    const { deps } = makeDeps({ files, dirs });
    const ev = await getSessionEvidence('pij-k', deps, { worktree: '/wt' });

    expect(ev).not.toBeNull();
    if (!ev) return;
    expect(ev.harness).toBe('copilot-cli');
    expect(ev.tools).toEqual({ bash: 1 });
    expect(ev.harness_verbs).toEqual({ doctor: 1 });
    expect(ev.files).toEqual({ written: [], edited: [] });
    expect(ev.checks).toEqual([]);
    expect(ev.gaps).toEqual(['plans_touched']);
  });

  it('joins by captured_env.PIJ_SESSION_ID — two pij sessions in one buffer never bleed', async () => {
    const { files, dirs } = layout('/wt', [
      { sub: 'sessA', segments: [tag(CLAUDE, 'pij-a')] },
      { sub: 'sessB', segments: [tag(COPILOT, 'pij-b')] },
    ]);
    const { deps } = makeDeps({ files, dirs });

    const a = await getSessionEvidence('pij-a', deps, { worktree: '/wt' });
    const b = await getSessionEvidence('pij-b', deps, { worktree: '/wt' });
    expect(a?.harness).toBe('claude-code');
    expect(a?.segments).toBe(1);
    expect(b?.harness).toBe('copilot-cli');
    expect(b?.segments).toBe(1);
  });

  it('derives skills/flow_seams/checks/compactions from the event stream (synthetic, real serializer)', async () => {
    const events: Event[] = [
      { t: '2026-06-29T00:00:01Z', kind: 'skill', name: 'the-flow', status: 'completed' },
      { t: '2026-06-29T00:00:02Z', kind: 'flow', flow: 'sdd', stage: '1b', status: 'active' },
      { t: '2026-06-29T00:00:03Z', kind: 'tools', name: 'Bash', count: 2, span_s: 1 },
      { t: '2026-06-29T00:00:04Z', kind: 'checks', status: 'degraded' },
      { t: '2026-06-29T00:00:05Z', kind: 'harness', verb: 'flow' },
      { t: '2026-06-29T00:00:06Z', kind: 'skill', name: 'validate-v2', status: 'completed' },
      { t: '2026-06-29T00:00:07Z', kind: 'flow', flow: 'sdd', stage: '5', status: 'active' },
      { t: '2026-06-29T00:00:08Z', kind: 'compaction' },
      { t: '2026-06-29T00:00:09Z', kind: 'skill', name: 'the-flow', status: 'completed' },
      { t: '2026-06-29T00:00:10Z', kind: 'checks', status: 'ok' },
    ];
    const { files, dirs } = layout('/wt', [{ sub: 's', segments: [synthetic('pij-syn', events)] }]);
    const { deps } = makeDeps({ files, dirs });
    const ev = await getSessionEvidence('pij-syn', deps, { worktree: '/wt' });

    expect(ev).not.toBeNull();
    if (!ev) return;
    expect(ev.skills).toEqual({ 'the-flow': 2, 'validate-v2': 1 });
    expect(ev.skill_order).toEqual(['the-flow', 'validate-v2']);
    expect(ev.flow_seams).toEqual(['sdd:1b', 'sdd:5']);
    expect(ev.harness_verbs).toEqual({ flow: 1 });
    expect(ev.checks).toEqual([{ status: 'degraded' }, { status: 'ok' }]);
    expect(ev.compactions).toBe(1);
    expect(ev.tools).toEqual({ Bash: 2 });
    // F13 (AC-08): wall-span from the first event (…:01Z) to the last (…:10Z) = 9s.
    expect(ev.duration_s).toBe(9);
  });

  it('F13: duration_s is null when fewer than two timestamped events exist (honest, never 0)', async () => {
    const one = synthetic('pij-one', [{ t: '2026-06-29T00:00:01Z', kind: 'compaction' }]);
    const { files, dirs } = layout('/wt', [{ sub: 's', segments: [one] }]);
    const { deps } = makeDeps({ files, dirs });
    const ev = await getSessionEvidence('pij-one', deps, { worktree: '/wt' });
    // NON-VACUITY: a single-event run has an UNKNOWN span → null, not 0.
    expect(ev?.duration_s).toBeNull();
  });

  it('F13: duration_s spans across segments (min of seg0 → max of seg1)', async () => {
    const seg0 = synthetic('pij-span', [
      { t: '2026-06-29T00:00:00Z', kind: 'skill', name: 'a', status: 'completed' },
    ]);
    const seg1 = synthetic('pij-span', [
      { t: '2026-06-29T00:02:00Z', kind: 'skill', name: 'b', status: 'completed' },
    ]);
    const { files, dirs } = layout('/wt', [{ sub: 's', segments: [seg0, seg1] }]);
    const { deps } = makeDeps({ files, dirs });
    const ev = await getSessionEvidence('pij-span', deps, { worktree: '/wt' });
    expect(ev?.duration_s).toBe(120); // 2 minutes across the two segments
  });

  it('F4: harness_session_id is folded from the matched segments (the key `session save` takes)', async () => {
    const seg = synthetic('pij-hs', [{ t: '2026-06-29T00:00:01Z', kind: 'compaction' }], {
      harness_session_id: 'claude-abc123',
    });
    const { files, dirs } = layout('/wt', [{ sub: 's', segments: [seg] }]);
    const { deps } = makeDeps({ files, dirs });
    const ev = await getSessionEvidence('pij-hs', deps, { worktree: '/wt' });
    expect(ev?.harness_session_id).toBe('claude-abc123');
  });

  it('F4: harness_session_id is null (honest) when no segment carries a non-empty one', async () => {
    const seg = synthetic('pij-nohs', [{ t: '2026-06-29T00:00:01Z', kind: 'compaction' }], {
      harness_session_id: '',
    });
    const { files, dirs } = layout('/wt', [{ sub: 's', segments: [seg] }]);
    const { deps } = makeDeps({ files, dirs });
    const ev = await getSessionEvidence('pij-nohs', deps, { worktree: '/wt' });
    // NON-VACUITY: an empty id folds to null, never a fabricated placeholder.
    expect(ev?.harness_session_id).toBeNull();
  });

  it('aggregates across segments (counts sum, skill_order preserved) and tracks gaps', async () => {
    const seg0 = synthetic(
      'pij-agg',
      [{ t: '2026-06-29T00:00:01Z', kind: 'skill', name: 'a', status: 'completed' }],
      { plans_touched: ['041-foo'] }, // a non-empty plans list → NO plans gap
    );
    const seg1 = synthetic(
      'pij-agg',
      [
        { t: '2026-06-29T00:00:02Z', kind: 'skill', name: 'b', status: 'completed' },
        { t: '2026-06-29T00:00:03Z', kind: 'skill', name: 'a', status: 'completed' },
      ],
      { tokens: null }, // null tokens → subagent_tokens gap
    );
    const { files, dirs } = layout('/wt', [{ sub: 's', segments: [seg0, seg1] }]);
    const { deps } = makeDeps({ files, dirs });
    const ev = await getSessionEvidence('pij-agg', deps, { worktree: '/wt' });

    expect(ev).not.toBeNull();
    if (!ev) return;
    expect(ev.segments).toBe(2);
    expect(ev.skills).toEqual({ a: 2, b: 1 });
    expect(ev.skill_order).toEqual(['a', 'b']);
    expect(ev.gaps).toEqual(['subagent_tokens']); // plans present in seg0 → only the tokens gap
  });

  it('recovers typed token evidence from a whole-session ref after local prune', async () => {
    const segment = synthetic(
      'pij-pruned',
      [
        {
          t: '2026-06-29T00:00:01Z',
          kind: 'usage',
          observation_kind: 'final_shutdown',
          in: 10,
          out: 20,
          cache_read: 30,
          cache_create: 40,
        },
      ],
      { harness_session_id: 'hs-pruned', tokens: null },
    );
    const gitRead = new FakeGitRead({
      'refs/harness-telemetry/2026/06/29/hs-pruned': [
        {
          name: 'session.logs.jsonl',
          content: `${JSON.stringify(segmentToOtlpLogs(segment))}\n`,
        },
      ],
    });
    const { deps } = makeDeps({});

    const evidence = await getSessionEvidence('pij-pruned', { ...deps, gitRead });
    expect(evidence).toMatchObject({
      harness_session_id: 'hs-pruned',
      segments: 1,
      token_evidence: {
        coverage: 'measured',
        source: 'ref',
        fields: { output: { value: 20, source: 'ref' } },
      },
    });
  });
  it('returns null for an unknown pij session (fail-safe, never throws)', async () => {
    const { files, dirs } = layout('/wt', [{ sub: 's', segments: [tag(CLAUDE, 'pij-a')] }]);
    const { deps } = makeDeps({ files, dirs });
    expect(await getSessionEvidence('pij-nope', deps, { worktree: '/wt' })).toBeNull();
  });

  it('tolerates a corrupt buffer file — skips it, never throws', async () => {
    const { files, dirs } = layout('/wt', [{ sub: 's', segments: [tag(CLAUDE, 'pij-a')] }]);
    files[`${tel('/wt')}/s/1.json`] = '{ not valid json';
    dirs[`${tel('/wt')}/s`] = ['0.json', '1.json'];
    const { deps } = makeDeps({ files, dirs });
    const ev = await getSessionEvidence('pij-a', deps, { worktree: '/wt' });
    expect(ev?.segments).toBe(1); // the good segment still folds; the corrupt one is skipped
  });
});

/**
 * Finding 1 (dlg-0002 cross-model FIX) — the Phase2-facing facade must be callable
 * from an extension `VerbContext` shape (`{cwd:string, fs:{readText,readdir},
 * env:{get}}`) with NO `EnvPort`/`ProcessPort`. These are the compile-level proof
 * (the literal ctx object below has only contract methods — it would not type-check
 * if the facade demanded full ports) AND the behavioral proof (same evidence as the
 * port-injected deps form, over the same fixture).
 */
describe('getSessionEvidenceFromContext — callable from an extension VerbContext (Finding 1)', () => {
  it('a VerbContext-shaped ctx yields the SAME evidence as the deps form (HOME → pij-folder)', async () => {
    const { files, dirs } = layout('/work', [{ sub: 'sessA', segments: [tag(CLAUDE, 'pij-ctx')] }]);
    const all = { ...files, [`${HOME}/.pij/pij-ctx.json`]: JSON.stringify({ folder: '/work' }) };
    const fs = new FakeFs(all, dirs);

    // Baseline: the port-injected deps form (real fakes), resolving via pij folder.
    const deps: SessionEvidenceDeps = {
      fs,
      env: new FakeEnv({}, HOME),
      proc: new FakeProcess({}, '/somewhere/else'), // cwd has NO buffer
    };
    const viaDeps = await getSessionEvidence('pij-ctx', deps);

    // Facade: ONLY the VerbContext subset — a plain literal, no EnvPort/ProcessPort.
    const ctx: SessionEvidenceContext = {
      cwd: '/somewhere/else',
      fs: { readText: (p) => fs.readText(p), readdir: (p) => fs.readdir(p) },
      env: { get: (n) => (n === 'HOME' ? HOME : undefined) },
    };
    const viaCtx = await getSessionEvidenceFromContext('pij-ctx', ctx);

    expect(viaCtx).not.toBeNull();
    expect(viaCtx).toEqual(viaDeps); // byte-for-byte parity proves the adaptation is faithful
    expect(viaCtx?.harness).toBe('claude-code'); // resolved via env.get('HOME'), not cwd
  });

  it('passes opts.worktree through (override beats cwd/pij resolution)', async () => {
    const { files, dirs } = layout('/wt', [{ sub: 'sessX', segments: [tag(COPILOT, 'pij-wt')] }]);
    const fs = new FakeFs(files, dirs);
    const ctx: SessionEvidenceContext = {
      cwd: '/elsewhere', // no buffer here, and no pij state on disk
      fs: { readText: (p) => fs.readText(p), readdir: (p) => fs.readdir(p) },
      env: { get: () => undefined },
    };
    const ev = await getSessionEvidenceFromContext('pij-wt', ctx, { worktree: '/wt' });
    expect(ev?.harness).toBe('copilot-cli');
    expect(ev?.harness_verbs).toEqual({ doctor: 1 });
  });

  it('falls back to USERPROFILE when HOME is unset (Windows home resolution)', async () => {
    const WP = 'C:/Users/dev';
    const { files, dirs } = layout('/work', [
      { sub: 'sessA', segments: [tag(COPILOT, 'pij-win')] },
    ]);
    const all = { ...files, [`${WP}/.pij/pij-win.json`]: JSON.stringify({ folder: '/work' }) };
    const fs = new FakeFs(all, dirs);
    const ctx: SessionEvidenceContext = {
      cwd: 'C:/elsewhere', // cwd has no buffer → must resolve via USERPROFILE → pij folder
      fs: { readText: (p) => fs.readText(p), readdir: (p) => fs.readdir(p) },
      env: { get: (n) => (n === 'USERPROFILE' ? WP : undefined) }, // HOME unset
    };
    const ev = await getSessionEvidenceFromContext('pij-win', ctx);
    expect(ev?.harness).toBe('copilot-cli');
  });
});
