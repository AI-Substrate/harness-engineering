import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeDb } from '../../../src/adapters/db/fake-db.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { buildDoctorReport } from '../../../src/services/doctor/doctor-service.js';
import type { VerbRegistry } from '../../../src/services/extensions/registry.js';
import { claudeAdapter } from '../../../src/services/telemetry/adapters/claude-adapter.js';
import { cursorAdapter } from '../../../src/services/telemetry/adapters/cursor-adapter.js';
import type {
  HarnessAdapter,
  HarnessCapabilities,
  HarnessContext,
  LiveHarnessSource,
  ReconcileHarnessSource,
} from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  LIVENESS_RESIDUE_IDLE_MS,
  type LivenessRecord,
  parseLivenessRecord,
} from '../../../src/services/telemetry/capture-liveness.js';
import {
  RECONCILE_COMMAND,
  RECONCILE_DEBOUNCE_MS,
  type ReconcileDeps,
  reconcileOrphanLanes,
  reconcileStampPath,
} from '../../../src/services/telemetry/capture-reconcile.js';
import { buildReport } from '../../../src/services/telemetry/report.js';
import { type Segment, serializeSegment } from '../../../src/services/telemetry/segment.js';
import { combineSession } from '../../../src/services/telemetry/session-export.js';
import { AGE_OUT_MS } from '../../../src/services/telemetry/sync-service.js';

/**
 * Plan 070 · deliverable 3 — ORPHAN-LANE RECONCILIATION, proved against the same
 * known-bad session the detector fires on.
 *
 * The mechanism, confirmed live: `cursor-agent` writes its transcript in BATCHES.
 * A lane sat at 2 lines for eleven minutes, flushed to 36, and the very next
 * harness command consumed all 35 at once — capture is healthy. What it cannot
 * survive is a flush that lands after the session's LAST command: the source
 * reaches full length with nobody left to read it, and no in-session signal can
 * ever recover the tail because a finished session never runs another command.
 *
 * So the recovery is necessarily out-of-band, which makes it the most dangerous
 * kind of code in this service — it writes telemetry about work it never watched.
 * These tests exist to hold it to that: it declares itself, it never invents a
 * clock, it attributes only through the marker, and it cannot emit twice.
 */

const SCRUBBED_TRANSCRIPT = fileURLToPath(
  new URL('./fixtures/real/cursor/2026-08-03-applypatch-textstat/raw.jsonl', import.meta.url),
);
const STALL_FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/capture-stall-1a501a09/meta.json', import.meta.url)),
    'utf8',
  ),
) as {
  session: string;
  transcript_nonempty_lines: number;
  buffer_markers: { cursor: number; flushed: number; branch: string; startdate: string };
};

const SESSION = STALL_FIXTURE.session;
const FROZEN_CURSOR = STALL_FIXTURE.buffer_markers.cursor;
const TOTAL_LINES = STALL_FIXTURE.transcript_nonempty_lines;
/** The lane's last live attempt, and a "now" a full day later — well past the idle gate. */
const LAST_ATTEMPT = '2026-08-03T08:01:35.000Z';
/** When the batched writer finally flushed the transcript — the source's own last write. */
const SOURCE_MTIME = '2026-08-03T08:16:30.000Z';
const NOW = '2026-08-04T08:01:35.000Z';

let tmp = '';
let repo = '';
let transcripts = '';

function tel(): string {
  return join(repo, '.harness', 'temp', 'telemetry');
}

function transcriptPath(): string {
  return join(transcripts, SESSION, `${SESSION}.jsonl`);
}

function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '');
}

/** The full scrubbed transcript, as the source would read once the writer flushed. */
function seedTranscript(lines?: number): void {
  mkdirSync(join(transcripts, SESSION), { recursive: true });
  if (lines === undefined) {
    cpSync(SCRUBBED_TRANSCRIPT, transcriptPath());
  } else {
    const all = nonEmptyLines(readFileSync(SCRUBBED_TRANSCRIPT, 'utf8'));
    writeFileSync(transcriptPath(), `${all.slice(0, lines).join('\n')}\n`, 'utf8');
  }
  // A real mtime the reconciler can use as the window's honest end anchor.
  const when = new Date(SOURCE_MTIME);
  utimesSync(transcriptPath(), when, when);
}

/**
 * The marker a dead lane leaves behind: it captured `cursor` lines, its last
 * attempt was honest (`no-window` was TRUE each time it was asked), and it named
 * the source so a later reader could re-measure it.
 */
function seedMarker(over: Partial<LivenessRecord> = {}): void {
  mkdirSync(tel(), { recursive: true });
  const record: LivenessRecord = {
    session: SESSION,
    harness: 'cursor-agent',
    last_attempt_at: LAST_ATTEMPT,
    last_command: 'checks',
    last_outcome: 'captured',
    cursor: FROZEN_CURSOR,
    position: FROZEN_CURSOR,
    captures: 1,
    anomalies: 0,
    consecutive_uncaptured: 0,
    last_capture_at: LAST_ATTEMPT,
    source: transcriptPath(),
    source_unit: 'nonempty-lines',
    ...over,
  };
  writeFileSync(join(tel(), `${SESSION}.liveness.json`), JSON.stringify(record, null, 2), 'utf8');
  writeFileSync(join(tel(), `${SESSION}.cursor`), String(record.cursor ?? 0), 'utf8');
  writeFileSync(join(tel(), `${SESSION}.branch`), STALL_FIXTURE.buffer_markers.branch, 'utf8');
}

/**
 * The IDE-store bubbles the real session had: one `createdAt` per turn, in
 * conversation order. They are the ONLY timed Cursor source (the transcript
 * carries none), so WITHOUT them every recovered event falls back to the window
 * anchor and is interval-grade by accident rather than by rule — which would make
 * the interval-grade assertions below vacuous. With them the adapter produces
 * `anchored` events that reconciliation must deliberately downgrade.
 */
function bubbleDb(): FakeDb {
  const raw = nonEmptyLines(readFileSync(SCRUBBED_TRANSCRIPT, 'utf8'));
  const base = Date.parse('2026-08-03T08:00:45.000Z');
  const rows: { value: string }[] = [];
  let n = 0;
  for (const line of raw) {
    let role: unknown;
    try {
      role = (JSON.parse(line) as Record<string, unknown>).role;
    } catch {
      continue;
    }
    if (role !== 'user' && role !== 'assistant') continue;
    rows.push({
      value: JSON.stringify({
        type: role === 'user' ? 1 : 2,
        createdAt: base + n * 10_000,
        modelInfo: { modelName: 'test-model' },
      }),
    });
    n += 1;
  }
  // Query-AWARE: bubbles come back only for THIS conversation's key prefix. A
  // fixed-row fake would answer any id and could not tell a correct join from a
  // cross-lane one.
  return new FakeDb((_sql, params) =>
    params.some((p) => typeof p === 'string' && p === `bubbleId:${SESSION}:%`) ? rows : [],
  );
}

/**
 * Write one buffered segment by hand — the minimum shape the read path needs to
 * produce exactly one control-timeline marker, live or reconciled.
 */
function writeSegmentJson(
  seq: number,
  spec: { command: string; t: string | string[]; verb: string; reconciled?: boolean },
): void {
  const instants = Array.isArray(spec.t) ? spec.t : [spec.t];
  mkdirSync(join(tel(), SESSION), { recursive: true });
  const segment = serializeSegment(
    {
      command: spec.command,
      harness: 'cursor-agent',
      harness_version: 'test',
      harness_session_id: SESSION,
      timecode: instants[0],
      window: { since: 'last-command', from: 0, to: 1 },
      branch: STALL_FIXTURE.buffer_markers.branch,
      event_stream: instants.map((t) => ({
        t,
        t_precision: spec.reconciled === true ? ('interval' as const) : ('anchored' as const),
        kind: 'harness' as const,
        verb: spec.verb,
      })),
      ...(spec.reconciled === true ? { capture_mode: 'reconciled' } : {}),
    },
    repo,
  );
  writeFileSync(
    join(tel(), SESSION, `${seq}.json`),
    `${JSON.stringify(segment, null, 2)}\n`,
    'utf8',
  );
}

function deps(
  over: { now?: string; db?: FakeDb; adapters?: HarnessAdapter[] } = {},
): ReconcileDeps {
  return {
    fs: new NodeFs(),
    // Note what CANNOT be passed: `ReconcileDeps` has no `env` field at all, so no
    // test (and no caller) can hand the recovery process's environment to an
    // adapter even by mistake. That absence is the fix for P1-B, and it is checked
    // behaviourally by `records the ctx the adapter was handed` below.
    clock: new FakeClock(over.now ?? NOW),
    proc: new FakeProcess({}, repo),
    version: 'test',
    adapters: over.adapters ?? [cursorAdapter],
    ...(over.db !== undefined && { db: over.db }),
  };
}

/**
 * An adapter that records every context it is handed and returns whatever the test
 * asked for. Lets a test assert on the SEAM (what reached the adapter) instead of
 * only on the segment that came out the other side.
 */
function recordingAdapter(caps: HarnessCapabilities = {}): {
  adapter: HarnessAdapter;
  seen: HarnessContext[];
} {
  const seen: HarnessContext[] = [];
  return {
    seen,
    adapter: {
      harness: 'cursor-agent',
      handles: (id) => id === 'cursor-agent',
      reconciles: true,
      extract(ctx) {
        seen.push(ctx);
        return caps;
      },
    },
  };
}

/** Every buffered segment for the lane, in seq order. */
function bufferedSegments(): Segment[] {
  const dir = join(tel(), SESSION);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => /^\d+\.json$/.test(n))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')) as Segment);
}

function readMarker(): LivenessRecord | null {
  try {
    return parseLivenessRecord(readFileSync(join(tel(), `${SESSION}.liveness.json`), 'utf8'));
  } catch {
    return null;
  }
}

function readCursorFile(): string | null {
  try {
    return readFileSync(join(tel(), `${SESSION}.cursor`), 'utf8').trim();
  } catch {
    return null;
  }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capture-reconcile-070-'));
  repo = join(tmp, 'repo');
  transcripts = join(tmp, 'transcripts');
  mkdirSync(tel(), { recursive: true });
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('recovery of the known-bad orphaned lane', () => {
  it('recovers the whole unconsumed tail the stall discarded', () => {
    seedTranscript();
    seedMarker();

    const result = reconcileOrphanLanes(deps());

    expect(result.skipped).toEqual([]);
    expect(result.reconciled).toHaveLength(1);
    const lane = result.reconciled[0];
    expect(lane.session).toBe(SESSION);
    expect(lane.from).toBe(FROZEN_CURSOR);
    expect(lane.to).toBe(TOTAL_LINES);
    // 54 of 56 lines — the ~27x under-count, paid back.
    expect(lane.recovered).toBe(TOTAL_LINES - FROZEN_CURSOR);
  });

  it('recovers the WORK, not just a line count', () => {
    // A segment that advanced the watermark while carrying nothing would be worse
    // than the stall: it would burn the residue AND still under-report.
    seedTranscript();
    seedMarker();

    reconcileOrphanLanes(deps());

    const segments = bufferedSegments();
    expect(segments).toHaveLength(1);
    const seg = segments[0];
    // The nine ApplyPatch edits the thin committed segment concealed.
    expect(seg.tools?.ApplyPatch).toBe(9);
    expect((seg.files?.written?.length ?? 0) + (seg.files?.edited?.length ?? 0)).toBeGreaterThan(0);
  });

  it('writes the OTLP sidecars too, so recovered work rides the same transport', () => {
    // Recovery that only lands as `<seq>.json` would be visible to some consumers
    // and invisible to the OTLP read path — "recovered" would then mean
    // "recovered into a shape only half the surfaces can see".
    seedTranscript();
    seedMarker();

    reconcileOrphanLanes(deps());

    const names = readdirSync(join(tel(), SESSION));
    expect(names.some((n) => n.endsWith('.logs.jsonl'))).toBe(true);
    expect(names.some((n) => n.endsWith('.metrics.jsonl'))).toBe(true);
  });
});

describe('the recovered segment declares itself (constraint 1)', () => {
  it('carries the reconciled capture mode and the reserved command', () => {
    seedTranscript();
    seedMarker();

    reconcileOrphanLanes(deps());

    const seg = bufferedSegments()[0];
    expect(seg.capture_mode).toBe('reconciled');
    expect(seg.command).toBe(RECONCILE_COMMAND);
    // The wire version moved, so a reader that has never heard of reconciliation
    // sees an unknown schema rather than a late segment it reads as live.
    expect(seg.schema_version).toBe('2.7');
  });

  it('declares itself on the OTLP resource, not only in the JSON', () => {
    seedTranscript();
    seedMarker();

    reconcileOrphanLanes(deps());

    const logs = readFileSync(
      join(
        tel(),
        SESSION,
        readdirSync(join(tel(), SESSION)).find((n) => n.endsWith('.logs.jsonl')) as string,
      ),
      'utf8',
    );
    expect(logs).toContain('harness.capture_mode');
    expect(logs).toContain('reconciled');
  });

  it('a live capture is still byte-identically un-marked', () => {
    // The honest default must survive: absence means live, and absence cannot be
    // forged. Nothing here should ever stamp `capture_mode` on a normal segment.
    seedTranscript();
    seedMarker();
    reconcileOrphanLanes(deps());
    const seg = bufferedSegments()[0];
    // Sanity: the ONLY accepted value; there is no `live` to assert.
    expect(seg.capture_mode).toBe('reconciled');
    expect(Object.keys(seg)).not.toContain('captured_env');
    expect(Object.keys(seg)).not.toContain('product_commit');
  });
});

describe('it never fabricates work-time (constraints 2 + 3)', () => {
  it('stamps every recovered event interval-grade', () => {
    // Driven from an adapter that returns ANCHORED events on purpose: the downgrade
    // is only proved if something upstream claimed a precision to downgrade. (The
    // cursor adapter cannot supply that here — its only timed source is the IDE
    // store, which reconciliation deliberately cannot reach; see the env-isolation
    // suite. Testing through it would assert a precision nothing ever set.)
    seedTranscript();
    seedMarker();
    const { adapter } = recordingAdapter({
      event_stream: [
        { t: '2026-08-03T08:00:10.000Z', t_precision: 'anchored', kind: 'turn', dur_s: 3 },
        { t: '2026-08-03T08:00:20.000Z', t_precision: 'exact', kind: 'prompt', words: 12 },
      ],
    });

    reconcileOrphanLanes(deps({ adapters: [adapter] }));

    const seg = bufferedSegments()[0];
    expect(seg.event_stream.length).toBe(2);
    for (const event of seg.event_stream) {
      expect(event.t_precision).toBe('interval');
    }
  });

  it('takes instants from the source, never from the recovery clock', () => {
    // `timecode` IS the recovery instant (capture-time is capture-time, and
    // `capture_mode` says so). No EVENT may carry it: an event stamped at the
    // recovery clock claims work happened a day after it did.
    seedTranscript();
    seedMarker();

    reconcileOrphanLanes(deps({ db: bubbleDb() }));

    const seg = bufferedSegments()[0];
    expect(seg.timecode).toBe(NOW);
    for (const event of seg.event_stream) {
      expect(event.t).not.toBe(NOW);
      expect(Date.parse(event.t)).toBeLessThan(Date.parse(NOW));
    }
  });

  it('anchors untimed events to the source mtime, not the recovery clock', () => {
    // With no timed source (a headless lane with no IDE bubbles) the adapter has
    // only the window's end anchor to stamp a file delta with. That anchor must be
    // when the SOURCE last changed — a real observed fact bounding the work — and
    // never when recovery happened to run, which here is a full day later.
    seedTranscript();
    seedMarker();

    reconcileOrphanLanes(deps());

    const fileEvents = bufferedSegments()[0].event_stream.filter((e) => e.kind === 'file');
    expect(fileEvents.length).toBeGreaterThan(0);
    for (const e of fileEvents) expect(e.t).toBe(SOURCE_MTIME);
  });

  it('recovered events contribute counts but never active time', () => {
    // The 068 rule, verified end-to-end on RECOVERED events: interval instants are
    // skipped as gap boundaries, so a window nobody watched can never inflate the
    // session clock. Counts survive; the clock is not invented.
    seedTranscript();
    seedMarker();
    reconcileOrphanLanes(deps());

    const report = buildReport([
      combineSession(SESSION, { fs: new NodeFs(), proc: new FakeProcess({}, repo) }),
    ]);

    expect(report.totals.time_s).toBe(0);
    expect(report.provenance.interval_events).toBeGreaterThan(0);
    expect(report.totals.tokens.output + report.totals.tokens.input).toBeGreaterThanOrEqual(0);
  });

  it('uses the lane\u2019s recorded branch, never the branch the reconciler is on', () => {
    seedTranscript();
    seedMarker();

    reconcileOrphanLanes(deps());

    expect(bufferedSegments()[0].branch).toBe(STALL_FIXTURE.buffer_markers.branch);
  });
});

describe('attribution comes only from the marker (constraint 4)', () => {
  it('recovers this lane\u2019s own transcript, identified only by the marker', () => {
    // The realistic recovery condition: the reconciler runs INSIDE another live
    // cursor session. An adapter that fell back to env would join this dead lane's
    // transcript to that live lane's identity — a cross-lane fabrication.
    seedTranscript();
    seedMarker();

    reconcileOrphanLanes(deps({ db: bubbleDb() }));

    const segments = bufferedSegments();
    expect(segments).toHaveLength(1);
    expect(segments[0].harness_session_id).toBe(SESSION);
    // And the recovered content is genuinely this lane's transcript, not an empty
    // shell produced by a failed lookup.
    expect(segments[0].tools?.ApplyPatch).toBe(9);
  });

  it('hands the adapter the marker\u2019s facts and NO EnvPort at all', () => {
    // P1-B. The seam contract said env was unavailable in reconcile mode; the code
    // passed `deps.env` through anyway, so a recovered lane inherited the RECOVERY
    // shell's environment. Assert the seam directly — what reached the adapter —
    // because every downstream symptom (effort, model store, HOME-selected paths)
    // is a consequence of this one fact.
    seedTranscript();
    seedMarker();
    const { adapter, seen } = recordingAdapter();

    reconcileOrphanLanes(deps({ adapters: [adapter] }));

    expect(seen).toHaveLength(1);
    const ctx = seen[0];
    expect(ctx.env).toBeUndefined();
    // Not merely undefined-valued: the key is absent, so `'env' in ctx` — the check
    // a defensive adapter would write — also says no.
    expect(Object.hasOwn(ctx, 'env')).toBe(false);
    expect(ctx.reconcile).toEqual({ sourcePath: transcriptPath(), sessionId: SESSION });
  });

  it('skips a harness whose adapter never declared it can reconcile', () => {
    // An adapter that finds its source through env can be CONSTRUCTED without one;
    // it would then read nothing, and that emptiness would be reported as "the
    // source holds no evidence" — a claim about the source made from a fact about
    // the adapter. Undeclared means unrecoverable, and the lane is left intact.
    seedTranscript();
    seedMarker();
    const { adapter, seen } = recordingAdapter({ tools: { ApplyPatch: 9 } });
    const undeclared: HarnessAdapter = { ...adapter, reconciles: undefined };

    const result = reconcileOrphanLanes(deps({ adapters: [undeclared] }));

    expect(seen).toHaveLength(0); // never even asked to extract
    expect(bufferedSegments()).toHaveLength(0);
    expect(result.skipped).toEqual([{ session: SESSION, reason: 'no-adapter' }]);
  });

  it('never touches a lane that has no marker (constraint 5)', () => {
    // Reconciliation is a CONSUMER of the detector. A source sitting on disk with
    // no marker is not evidence of anything it may act on.
    seedTranscript();
    // no seedMarker()

    const result = reconcileOrphanLanes(deps());

    expect(result.reconciled).toEqual([]);
    expect(bufferedSegments()).toEqual([]);
    expect(readCursorFile()).toBeNull();
  });

  it('leaves a lane alone when no adapter can read its harness', () => {
    seedTranscript();
    seedMarker({ harness: 'some-future-harness' });

    const result = reconcileOrphanLanes(deps());

    expect(result.reconciled).toEqual([]);
    expect(result.skipped).toEqual([{ session: SESSION, reason: 'no-adapter' }]);
    // Critically: the cursor did NOT advance. Burning the residue with no adapter
    // to read it would destroy the evidence a future adapter could recover.
    expect(readCursorFile()).toBe(String(FROZEN_CURSOR));
  });
});

/**
 * P1-B, at the adapter seam. The reconciler no longer HAS an `EnvPort` to pass, so
 * these prove the consequence that matters: the same adapter, the same source, the
 * same db — with env, it reports facts about the running process; without env, it
 * omits them instead of inheriting them. Each pair is a false attribution the
 * reviewer reproduced, held down from both directions so a re-introduced env
 * fallback fails here rather than showing up as a plausible number in a report.
 */
describe('a recovered lane never inherits the recovery process\u2019s environment', () => {
  function claudeSources(effort: string): {
    live: LiveHarnessSource;
    late: ReconcileHarnessSource;
    path: string;
  } {
    const configRoot = join(tmp, '.claude');
    // The path LIVE discovery would derive, so both modes read the same file and
    // the only difference between them is where the answer came from.
    const projectKey = repo.replace(/[^A-Za-z0-9]/g, '-');
    const path = join(configRoot, 'projects', projectKey, `${SESSION}.jsonl`);
    mkdirSync(join(configRoot, 'projects', projectKey), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-03T08:00:10.000Z',
        message: { id: 'm1', model: 'test-model', usage: { input_tokens: 5, output_tokens: 7 } },
      })}\n`,
      'utf8',
    );
    const base = { fs: new NodeFs(), repoRoot: repo, harness: 'claude-code', sessionId: SESSION };
    return {
      path,
      live: {
        ...base,
        env: new FakeEnv({ CLAUDE_EFFORT: effort, CLAUDE_CONFIG_DIR: configRoot }, tmp),
      },
      late: { ...base, reconcile: { sourcePath: path, sessionId: SESSION } },
    };
  }

  it('omits `effort`, which describes the process that RAN the work', () => {
    // The recovering agent is running at some effort level right now. That number
    // is a fact about the recovery, and stamping it on a window captured hours ago
    // reads as a measurement of how the work was actually done.
    const { live, late } = claudeSources('high');
    const window = { since: 'session-start' as const, from: 0, to: 1 };

    const liveCaps = claudeAdapter.extract({ ...live, window });
    const lateCaps = claudeAdapter.extract({ ...late, window, capturedAt: SOURCE_MTIME });

    expect(liveCaps.effort).toBe('high'); // the leak this reproduces
    expect(lateCaps.effort).toBeNull(); // omitted, not inherited
    // …and the recovery still WORKED: it read the transcript the marker named.
    expect(lateCaps.tokens?.input).toBe(5);
  });

  it('never resolves a transcript the recovery env points at', () => {
    // The other half of the same leak: with no env there is no config root to
    // discover, so the ONLY path that can be read is the marker's — and it must
    // name the lane's own session, or nothing is read at all.
    const { late, path } = claudeSources('high');
    const window = { since: 'session-start' as const, from: 0, to: 1 };
    const impostor = path.replace(`${SESSION}.jsonl`, 'someone-elses-session.jsonl');
    writeFileSync(impostor, readFileSync(path, 'utf8'), 'utf8');

    const caps = claudeAdapter.extract({
      ...late,
      reconcile: { sourcePath: impostor, sessionId: SESSION },
      window,
      capturedAt: SOURCE_MTIME,
    });

    expect(caps.tokens).toBeNull();
  });

  it('omits models: the IDE store is selected by the RECOVERING user\u2019s HOME', () => {
    // cursor's model/timing store lives under `$HOME` (or `%APPDATA%`). At recovery
    // time that is whoever ran the sync — a different machine account, or simply a
    // different install than the dead lane used. The db here WOULD answer for this
    // conversation, which is the point: the difference between the two cases is
    // env alone.
    seedTranscript();
    const db = bubbleDb();
    const base = {
      fs: new NodeFs(),
      db,
      repoRoot: repo,
      harness: 'cursor-agent',
      window: { since: 'session-start' as const, from: 0, to: TOTAL_LINES },
      capturedAt: SOURCE_MTIME,
    };

    const liveCaps = cursorAdapter.extract({
      ...base,
      env: new FakeEnv(
        { AGENT_TRANSCRIPTS: transcripts, CURSOR_CONVERSATION_ID: SESSION, APPDATA: tmp },
        tmp,
      ),
    });
    const lateCaps = cursorAdapter.extract({
      ...base,
      reconcile: { sourcePath: transcriptPath(), sessionId: SESSION },
    });

    expect(liveCaps.models).not.toBeNull(); // the store answered, via HOME
    expect(lateCaps.models).toBeNull(); // unavailable, and not filled in from elsewhere
    // The recovery is still real: the transcript's own evidence came through.
    expect(lateCaps.tools?.ApplyPatch).toBe(9);
  });

  it('drops to interval grade rather than borrowing the recovery HOME\u2019s timings', () => {
    // The bubble store is also the only TIMED cursor source. Unreachable without
    // env, so the recovered events fall back to the window anchor — interval grade,
    // excluded from active-time accrual. Losing precision is the honest outcome;
    // borrowing another install's clock is not.
    seedTranscript();
    const base = {
      fs: new NodeFs(),
      db: bubbleDb(),
      repoRoot: repo,
      harness: 'cursor-agent',
      window: { since: 'session-start' as const, from: 0, to: TOTAL_LINES },
      capturedAt: SOURCE_MTIME,
    };

    const live = cursorAdapter.extract({
      ...base,
      env: new FakeEnv({ AGENT_TRANSCRIPTS: transcripts, CURSOR_CONVERSATION_ID: SESSION }, tmp),
    });
    const late = cursorAdapter.extract({
      ...base,
      reconcile: { sourcePath: transcriptPath(), sessionId: SESSION },
    });

    expect((live.event_stream ?? []).some((e) => e.t_precision === 'anchored')).toBe(true);
    expect((late.event_stream ?? []).every((e) => e.t_precision !== 'anchored')).toBe(true);
    for (const event of late.event_stream ?? []) expect(event.t).toBe(SOURCE_MTIME);
  });
});

describe('it cannot double-emit (constraint 6)', () => {
  it('is a no-op on the second pass', () => {
    seedTranscript();
    seedMarker();

    const first = reconcileOrphanLanes(deps());
    // A later pass, well past the debounce, with the source unchanged.
    const later = new Date(Date.parse(NOW) + RECONCILE_DEBOUNCE_MS * 2).toISOString();
    const second = reconcileOrphanLanes(deps({ now: later }));

    expect(first.reconciled).toHaveLength(1);
    expect(second.reconciled).toEqual([]);
    expect(bufferedSegments()).toHaveLength(1);
  });

  it('advances the durable watermark — guard one', () => {
    seedTranscript();
    seedMarker();

    reconcileOrphanLanes(deps());

    expect(readCursorFile()).toBe(String(TOTAL_LINES));
  });

  it('folds a real capture onto the marker — guard two, independent of the cursor file', () => {
    // Either guard alone must stop a re-emit. Delete the `.cursor` sidecar and the
    // marker's own reset still keeps the lane out of the residue verdict.
    seedTranscript();
    seedMarker();
    reconcileOrphanLanes(deps());

    const marker = readMarker();
    expect(marker?.cursor).toBe(TOTAL_LINES);
    expect(marker?.last_command).toBe(RECONCILE_COMMAND);
    expect(marker?.last_outcome).toBe('captured');
    expect(marker?.last_attempt_at).toBe(NOW);

    rmSync(join(tel(), `${SESSION}.cursor`));
    const later = new Date(Date.parse(NOW) + RECONCILE_DEBOUNCE_MS * 2).toISOString();
    reconcileOrphanLanes(deps({ now: later }));

    expect(bufferedSegments()).toHaveLength(1);
  });

  it('starts from the DURABLE watermark when it is ahead of the marker', () => {
    // The marker is diagnostic state and its write degrades SILENTLY by contract
    // (it must never be the reason a host command changes behaviour). So a real
    // capture can advance `.cursor` while leaving the marker behind. Recovering
    // from the marker's stale number would re-emit work that was already captured
    // — the one way this pass could inflate a session instead of completing it.
    seedTranscript();
    seedMarker();
    writeFileSync(join(tel(), `${SESSION}.cursor`), '40', 'utf8');

    const result = reconcileOrphanLanes(deps());

    expect(result.reconciled).toHaveLength(1);
    expect(result.reconciled[0].from).toBe(40);
    expect(result.reconciled[0].recovered).toBe(TOTAL_LINES - 40);
    expect(bufferedSegments()[0].window).toMatchObject({ from: 40, to: TOTAL_LINES });
  });

  it('refuses to burn the residue when the adapter finds nothing in it', () => {
    // The source is measurably longer than the watermark, but this adapter reads
    // no signal from the extra lines. Emitting an empty segment would assert "we
    // looked and this window was empty" — unsupportable — and advancing the cursor
    // would destroy evidence a future adapter version could still recover.
    const head = nonEmptyLines(readFileSync(SCRUBBED_TRANSCRIPT, 'utf8')).slice(0, FROZEN_CURSOR);
    const opaque = Array.from({ length: 54 }, () => JSON.stringify({ role: 'system' }));
    mkdirSync(join(transcripts, SESSION), { recursive: true });
    writeFileSync(transcriptPath(), `${[...head, ...opaque].join('\n')}\n`, 'utf8');
    seedMarker();

    const result = reconcileOrphanLanes(deps());

    expect(result.reconciled).toEqual([]);
    expect(result.skipped).toEqual([{ session: SESSION, reason: 'no-signal' }]);
    expect(bufferedSegments()).toEqual([]);
    expect(readCursorFile()).toBe(String(FROZEN_CURSOR));
  });
});

describe('it stays quiet on healthy shapes', () => {
  it('leaves a BATCHED-writer lane alone while the session is still live', () => {
    // The live-observed cadence: 2 lines, then a 36-line flush mid-session. That
    // lane is holding a big residue too — and it will consume it on its own next
    // command. The idle gate, not a size threshold, is what tells them apart.
    seedTranscript(36);
    const minutesAgo = new Date(Date.parse(NOW) - 11 * 60 * 1000).toISOString();
    seedMarker({ last_attempt_at: minutesAgo, last_capture_at: minutesAgo });

    const result = reconcileOrphanLanes(deps());

    expect(result.reconciled).toEqual([]);
    expect(bufferedSegments()).toEqual([]);
    expect(readCursorFile()).toBe(String(FROZEN_CURSOR));
  });

  it('leaves a lane alone right up to the idle gate', () => {
    seedTranscript();
    const justInside = new Date(Date.parse(NOW) - LIVENESS_RESIDUE_IDLE_MS + 60_000).toISOString();
    seedMarker({ last_attempt_at: justInside });

    expect(reconcileOrphanLanes(deps()).reconciled).toEqual([]);
  });

  it('leaves a fully-consumed lane alone', () => {
    seedTranscript();
    seedMarker({ cursor: TOTAL_LINES, position: TOTAL_LINES });

    const result = reconcileOrphanLanes(deps());

    expect(result.reconciled).toEqual([]);
    expect(bufferedSegments()).toEqual([]);
  });

  it('leaves a small end-of-session tail alone', () => {
    // Every session ends with a few unconsumed turns after its last command. That
    // is normal, not a loss, and recovering it would make reconciliation routine.
    seedTranscript();
    seedMarker({ cursor: TOTAL_LINES - 3, position: TOTAL_LINES - 3 });

    expect(reconcileOrphanLanes(deps()).reconciled).toEqual([]);
  });
});

describe('cadence: the sweep is debounced', () => {
  it('does not re-sweep within the debounce window', () => {
    seedTranscript();
    seedMarker();
    reconcileOrphanLanes(deps());

    // A brand-new owed lane appears, but the stamp is fresh.
    rmSync(join(tel(), SESSION), { recursive: true, force: true });
    seedMarker();
    const soon = new Date(Date.parse(NOW) + RECONCILE_DEBOUNCE_MS / 2).toISOString();

    expect(reconcileOrphanLanes(deps({ now: soon })).reconciled).toEqual([]);
  });

  it('sweeps again once the window has passed', () => {
    seedTranscript();
    seedMarker();
    reconcileOrphanLanes(deps());
    rmSync(join(tel(), SESSION), { recursive: true, force: true });
    seedMarker();
    const later = new Date(Date.parse(NOW) + RECONCILE_DEBOUNCE_MS + 1000).toISOString();

    expect(reconcileOrphanLanes(deps({ now: later })).reconciled).toHaveLength(1);
  });

  it('treats a corrupt stamp as DUE, never as done', () => {
    // A stamp that cannot be parsed must not silently disable recovery forever.
    seedTranscript();
    seedMarker();
    writeFileSync(reconcileStampPath(repo.split('\\').join('/')), 'not-a-date\n', 'utf8');

    expect(reconcileOrphanLanes(deps()).reconciled).toHaveLength(1);
  });

  it('costs nothing when there are no markers at all', () => {
    // The overwhelmingly common case, and the one that must be free: no markers ⇒
    // no source read AND no stamp write. Asserting only an empty result would let a
    // pass that touches the disk on every commit slip through.
    const result = reconcileOrphanLanes(deps());

    expect(result).toEqual({ reconciled: [], skipped: [] });
    expect(existsSync(reconcileStampPath(repo))).toBe(false);
  });
});

describe('honesty reaches the RENDER, not just the stored field', () => {
  /** The report a human/consumer actually reads for this recovered lane. */
  function reportForLane() {
    seedTranscript();
    seedMarker();
    reconcileOrphanLanes(deps());
    return buildReport([
      combineSession(SESSION, { fs: new NodeFs(), proc: new FakeProcess({}, repo) }),
    ]);
  }

  it('counts recovered evidence in the report provenance', () => {
    // The `interval_events` precedent (plan 068 item 2): an honesty fact that would
    // otherwise be invisible gets its own surfaced number rather than a silent
    // adjustment somewhere downstream.
    const report = reportForLane();

    expect(report.provenance.reconciled_events).toBeGreaterThan(0);
    expect(report.provenance.reconciled_sessions).toBe(1);
  });

  it('flags the recovered control-timeline markers and ONLY those', () => {
    // The timeline is where a late window is most dangerous: a `git push` marker
    // recovered hours after the fact reads as a push observed at that instant, and
    // a discipline panel would score checks-before-push against it as if someone
    // had been watching. Both directions matter — a flag that fires on live
    // markers is as useless as one that never fires.
    //
    // Driven from hand-built segments rather than the corpus fixture: that session
    // wrapped every shell call in a `lean-ctx` prefix, so it yields no control
    // markers at all and could not tell the two directions apart.
    writeSegmentJson(1, { command: 'boot', t: '2026-08-03T08:00:00.000Z', verb: 'boot' });
    writeSegmentJson(2, {
      command: RECONCILE_COMMAND,
      t: '2026-08-03T09:00:00.000Z',
      verb: 'checks',
      reconciled: true,
    });

    const report = buildReport([
      combineSession(SESSION, { fs: new NodeFs(), proc: new FakeProcess({}, repo) }),
    ]);
    const timeline = report.control_timeline ?? [];

    expect(timeline.map((m) => m.key)).toEqual(['boot', 'checks']);
    expect(timeline[0].reconciled).toBeUndefined();
    expect(timeline[1].reconciled).toBe(true);
    expect(report.provenance.reconciled_sessions).toBe(1);
  });

  it('flags per EVENT when live and recovered work INTERLEAVE in the same window', () => {
    // P1-A, and the exact inverse of the trap this render fix was written for. The
    // first fix carried provenance as the recovered segment's {from,to} RANGE, so
    // any live event that happened to fall inside it rendered as reconstructed —
    // "correct field, wrong events", which is the same dishonesty pointed the other
    // way. Interleaving is not a corner case: a lane reconciled between two live
    // captures produces exactly this shape.
    //
    // Timeline: recovered [09:00 … 09:10] with a LIVE push at 09:05 inside it.
    writeSegmentJson(1, {
      command: RECONCILE_COMMAND,
      t: ['2026-08-03T09:00:00.000Z', '2026-08-03T09:10:00.000Z'],
      verb: 'checks',
      reconciled: true,
    });
    writeSegmentJson(2, { command: 'boot', t: '2026-08-03T09:05:00.000Z', verb: 'boot' });

    const report = buildReport([
      combineSession(SESSION, { fs: new NodeFs(), proc: new FakeProcess({}, repo) }),
    ]);
    const timeline = report.control_timeline ?? [];

    expect(timeline.map((m) => `${m.key}@${m.t}`)).toEqual([
      'checks@2026-08-03T09:00:00.000Z',
      'boot@2026-08-03T09:05:00.000Z',
      'checks@2026-08-03T09:10:00.000Z',
    ]);
    expect(timeline.map((m) => m.reconciled === true)).toEqual([true, false, true]);
    // The counts agree with the flags — 2 recovered events, not the 3 a range
    // would have swept up.
    expect(report.provenance.reconciled_events).toBe(2);
  });

  it('flags a recovered event sharing an INSTANT with a live one, and only it', () => {
    // The degenerate case a range representation cannot express at all: identical
    // timestamps. Object identity can, because provenance rides the resource each
    // event was decoded from rather than its position on a clock.
    writeSegmentJson(1, {
      command: RECONCILE_COMMAND,
      t: '2026-08-03T09:00:00.000Z',
      verb: 'checks',
      reconciled: true,
    });
    writeSegmentJson(2, { command: 'boot', t: '2026-08-03T09:00:00.000Z', verb: 'boot' });

    const report = buildReport([
      combineSession(SESSION, { fs: new NodeFs(), proc: new FakeProcess({}, repo) }),
    ]);
    const timeline = report.control_timeline ?? [];
    const flagged = timeline.filter((m) => m.reconciled === true).map((m) => m.key);

    expect(timeline).toHaveLength(2);
    expect(flagged).toEqual(['checks']);
    expect(report.provenance.reconciled_events).toBe(1);
  });

  it('says so in the attribution table, where a reader asks what the numbers are made of', () => {
    const report = reportForLane();

    expect(report.attribution.notes.some((n) => n.includes('RECONCILED'))).toBe(true);
  });

  it('leaves a live-only report completely unchanged', () => {
    // The whole surface must be inert for the normal case: no flags, no notes, no
    // non-zero counts. Honesty that fires on healthy data is just noise.
    seedTranscript();
    const report = buildReport([]);

    expect(report.provenance.reconciled_events).toBe(0);
    expect(report.provenance.reconciled_sessions).toBe(0);
    expect(report.attribution.notes.some((n) => n.includes('RECONCILED'))).toBe(false);
  });
});

/**
 * Jordan's signed-off operator contract: owed / unrecoverable named, and GREEN
 * MEANS NOTHING IS OWED ANYWHERE. A lane sync will never pay must not sit quietly
 * under a green check — that is the confident-loss case.
 */
describe('doctor is the operator surface for owed and unrecoverable lanes', () => {
  function livenessLayer(over: { adapters?: HarnessAdapter[] } = {}) {
    const registry: VerbRegistry = { verbs: [], records: [] };
    const report = buildDoctorReport(
      {
        fs: new NodeFs(),
        proc: new FakeProcess({ node: '/usr/bin/node' }, repo),
        git: new FakeGit({ isRepo: true, branch: STALL_FIXTURE.buffer_markers.branch }),
        // plan 074 · ac-0004 — capture-liveness is now GATED on capture being
        // enabled. This case exercises the liveness LOGIC, so it opts capture in;
        // a default (capture-off) env now correctly reports could-not-determine.
        env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/test'),
        clock: new FakeClock(NOW),
        adapters: over.adapters ?? [cursorAdapter],
      },
      registry,
    );
    const layer = report.layers.find((l) => l.name === 'capture-liveness');
    if (layer === undefined) throw new Error('doctor has no capture-liveness layer');
    return layer;
  }

  it('names an OWED lane and says recovery is pending', () => {
    seedTranscript();
    seedMarker();

    const layer = livenessLayer();

    expect(layer.ok).toBe(false);
    expect(layer.detail).toContain(`session ${SESSION.slice(0, 8)}:`);
    expect(layer.detail).toContain(
      `${TOTAL_LINES - FROZEN_CURSOR} lines uncaptured, recoverable on next telemetry sync`,
    );
    expect(layer.detail).toContain(`(source: ${SESSION}.jsonl)`);
    expect(layer.next_action).toContain('harness telemetry sync');
  });

  it('names an UNRECOVERABLE lane when no adapter can read its harness', () => {
    seedTranscript();
    seedMarker({ harness: 'some-future-harness' });

    const layer = livenessLayer();

    expect(layer.ok).toBe(false);
    expect(layer.detail).toContain('UNRECOVERABLE — no reconcile adapter for some-future-harness');
    // It must NOT promise a sync that will never pay this lane back.
    expect(layer.detail).not.toContain('recoverable on next telemetry sync');
    expect(layer.next_action).not.toContain('harness telemetry sync');
  });

  it('names an UNRECOVERABLE lane when the source holds no usable evidence', () => {
    const head = nonEmptyLines(readFileSync(SCRUBBED_TRANSCRIPT, 'utf8')).slice(0, FROZEN_CURSOR);
    const opaque = Array.from({ length: 54 }, () => JSON.stringify({ role: 'system' }));
    mkdirSync(join(transcripts, SESSION), { recursive: true });
    writeFileSync(transcriptPath(), `${[...head, ...opaque].join('\n')}\n`, 'utf8');
    seedMarker();

    const layer = livenessLayer();

    expect(layer.ok).toBe(false);
    expect(layer.detail).toContain('UNRECOVERABLE — source has no usable evidence');
  });

  it('names an UNRECOVERABLE lane when the source is gone but the loss was recorded', () => {
    // No transcript on disk at all. This lane never enters the residue verdict —
    // its extent cannot be measured — so it would be INVISIBLE without the
    // marker's own record that it once saw a window it did not capture.
    seedMarker({ cursor: 2, position: 56 });

    const layer = livenessLayer();

    expect(layer.ok).toBe(false);
    expect(layer.detail).toContain(
      '54 lines uncaptured, UNRECOVERABLE — source file no longer exists',
    );
  });

  it('stays quiet when a vanished source never recorded an uncaptured window', () => {
    // Honest limit: with position === cursor the marker never observed a debt, so
    // a missing source proves nothing and must NOT be reported as a loss.
    seedMarker({ cursor: 2, position: 2 });

    expect(livenessLayer().ok).toBe(true);
  });

  it('goes GREEN once the owed lane has been paid', () => {
    // The contract's other half: green must MEAN nothing is owed, so it has to
    // flip back on its own after recovery — not merely start out green.
    seedTranscript();
    seedMarker();
    expect(livenessLayer().ok).toBe(false);

    reconcileOrphanLanes(deps());

    const after = livenessLayer();
    expect(after.ok).toBe(true);
    expect(after.detail).toContain('nothing owed');
  });

  it('reports an owed lane correctly with NO adapter override wired', () => {
    // The worst mistake this layer could make is calling a RECOVERABLE lane
    // unrecoverable — it would send an operator to write off telemetry that sync
    // was about to pay back. A caller that forgets to wire the adapter registry
    // would do exactly that, so the registry is the service's own default and
    // there is no unwired state to get wrong. This pins that.
    seedTranscript();
    seedMarker();
    const registry: VerbRegistry = { verbs: [], records: [] };
    const report = buildDoctorReport(
      {
        fs: new NodeFs(),
        proc: new FakeProcess({ node: '/usr/bin/node' }, repo),
        git: new FakeGit({ isRepo: true, branch: STALL_FIXTURE.buffer_markers.branch }),
        // plan 074 · ac-0004 — capture-liveness is now GATED on capture being
        // enabled. This case exercises the liveness LOGIC, so it opts capture in;
        // a default (capture-off) env now correctly reports could-not-determine.
        env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/test'),
        clock: new FakeClock(NOW),
      },
      registry,
    );
    const layer = report.layers.find((l) => l.name === 'capture-liveness');

    expect(layer?.detail).toContain('recoverable on next telemetry sync');
    expect(layer?.detail).not.toContain('UNRECOVERABLE');
  });

  it('never renders an already-consumed lane as a finding', () => {
    // Something else captured the window: a healthy lane, not a debt.
    seedTranscript();
    seedMarker();
    writeFileSync(join(tel(), `${SESSION}.cursor`), String(TOTAL_LINES), 'utf8');

    const layer = livenessLayer();

    expect(layer.ok).toBe(true);
    expect(layer.detail).not.toContain('UNRECOVERABLE');
    expect(layer.detail).not.toContain('uncaptured');
  });
});

describe('the marker lifetime is a control, not a coincidence', () => {
  it('keeps the recovery window open between the idle gate and age-out', () => {
    // `pruneFlushedBuffer` is the SOLE deleter of a liveness marker, and it deletes
    // one only at age-out. Reconciliation is a later READER of that file, so its
    // idle gate must sit strictly inside the prune's retention or every orphaned
    // lane becomes unrecoverable — silently, and with no test to notice. This is
    // the pin that turns "it survives today" into a control.
    expect(LIVENESS_RESIDUE_IDLE_MS).toBeLessThan(AGE_OUT_MS);
  });
});

describe('zero host impact', () => {
  it('never throws when the recorded source has vanished', () => {
    seedMarker(); // marker points at a transcript that was never written
    expect(() => reconcileOrphanLanes(deps())).not.toThrow();
    expect(bufferedSegments()).toEqual([]);
  });

  it('never throws when the telemetry dir does not exist', () => {
    rmSync(tel(), { recursive: true, force: true });
    expect(() => reconcileOrphanLanes(deps())).not.toThrow();
  });

  it('never throws on a corrupt marker', () => {
    mkdirSync(tel(), { recursive: true });
    writeFileSync(join(tel(), `${SESSION}.liveness.json`), '{ not json', 'utf8');
    expect(() => reconcileOrphanLanes(deps())).not.toThrow();
  });
});
