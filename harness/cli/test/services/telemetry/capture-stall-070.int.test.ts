import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { NodeFs } from '../../../src/adapters/fs/node-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import { buildDoctorReport } from '../../../src/services/doctor/doctor-service.js';
import type { VerbRegistry } from '../../../src/services/extensions/registry.js';
import { cursorAdapter } from '../../../src/services/telemetry/adapters/cursor-adapter.js';
import type { HarnessAdapter } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  LIVENESS_RESIDUE_IDLE_MS,
  type LivenessRecord,
  parseLivenessRecord,
} from '../../../src/services/telemetry/capture-liveness.js';
import {
  type CaptureDeps,
  captureTelemetry,
} from '../../../src/services/telemetry/capture-service.js';

/**
 * Plan 070 · AC-2 / AC-3 — the DETECTOR proved against the known-bad session
 * shape, end to end through the real capture path on a real filesystem.
 *
 * Why this suite exists at all, in one sentence: **the controlled repro of this
 * session PASSES before any fix**, so "the repro passes after the fix" proves
 * nothing — only an instrument demonstrably fired by the known-bad shape can
 * later mean anything by going quiet.
 *
 * The known-bad shape (cursor-agent session `1a501a09`, 2026-08-03): capture
 * fired once at transcript line 2, then never again while the transcript grew to
 * 56 lines. The buffer markers froze at `.cursor = 2` / `.flushed = 1` and ONE
 * thin segment was committed — plausible, internally consistent, non-zero, and
 * under-representing the session ~27×. **A confident wrong number, not a gap.**
 *
 * Fixture hygiene (the hard rule): nothing from the preserved raw session is
 * committed. The transcript replayed here is the ALREADY-SCRUBBED corpus copy,
 * and the first test asserts the stall's property SURVIVED that scrub — a scrub
 * that flattened the transcript would leave a fixture that tests nothing.
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
const NOW = '2026-08-03T12:00:00.000Z';

function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim() !== '');
}

let tmp = '';
let repo = '';
let transcripts = '';

/** Lay down a sandbox repo + a cursor transcripts tree holding the scrubbed session. */
function seedSandbox(lines?: number): void {
  mkdirSync(join(repo, '.harness', 'temp', 'telemetry'), { recursive: true });
  const convDir = join(transcripts, SESSION);
  mkdirSync(convDir, { recursive: true });
  if (lines === undefined) {
    cpSync(SCRUBBED_TRANSCRIPT, join(convDir, `${SESSION}.jsonl`));
  } else {
    const all = nonEmptyLines(readFileSync(SCRUBBED_TRANSCRIPT, 'utf8'));
    writeFileSync(join(convDir, `${SESSION}.jsonl`), `${all.slice(0, lines).join('\n')}\n`, 'utf8');
  }
}

/** Reconstruct the frozen buffer markers the real session left behind. */
function seedFrozenMarkers(): void {
  const tel = join(repo, '.harness', 'temp', 'telemetry');
  writeFileSync(join(tel, `${SESSION}.cursor`), String(FROZEN_CURSOR), 'utf8');
  writeFileSync(
    join(tel, `${SESSION}.flushed`),
    String(STALL_FIXTURE.buffer_markers.flushed),
    'utf8',
  );
  writeFileSync(join(tel, `${SESSION}.branch`), STALL_FIXTURE.buffer_markers.branch, 'utf8');
}

function deps(
  over: { adapter?: HarnessAdapter; env?: Record<string, string>; clock?: FakeClock } = {},
): CaptureDeps {
  return {
    fs: new NodeFs(),
    env: new FakeEnv(
      over.env ?? { CURSOR_CONVERSATION_ID: SESSION, AGENT_TRANSCRIPTS: transcripts },
    ),
    clock: over.clock ?? new FakeClock(NOW),
    proc: new FakeProcess({}, repo),
    git: new FakeGit({ isRepo: true, branch: STALL_FIXTURE.buffer_markers.branch }),
    command: 'doctor',
    version: 'test',
    adapters: [over.adapter ?? cursorAdapter],
  };
}

function readCursorFile(): string | null {
  try {
    return readFileSync(
      join(repo, '.harness', 'temp', 'telemetry', `${SESSION}.cursor`),
      'utf8',
    ).trim();
  } catch {
    return null;
  }
}

function readMarker(): LivenessRecord | null {
  try {
    return parseLivenessRecord(
      readFileSync(join(repo, '.harness', 'temp', 'telemetry', `${SESSION}.liveness.json`), 'utf8'),
    );
  } catch {
    return null;
  }
}

/** The doctor layer as a product surface would report it (AC-1: readable by doctor). */
function livenessLayer(nowIso = NOW): { ok: boolean; detail: string; next_action?: string } {
  const registry: VerbRegistry = { verbs: [], records: [] };
  const report = buildDoctorReport(
    {
      fs: new NodeFs(),
      proc: new FakeProcess({ node: '/usr/bin/node' }, repo),
      git: new FakeGit({ isRepo: true, branch: STALL_FIXTURE.buffer_markers.branch }),
      env: new FakeEnv(),
      clock: new FakeClock(nowIso),
    },
    registry,
  );
  const layer = report.layers.find((l) => l.name === 'capture-liveness');
  if (layer === undefined) throw new Error('doctor has no capture-liveness layer');
  return layer;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'capture-stall-070-'));
  repo = join(tmp, 'repo');
  transcripts = join(tmp, 'transcripts');
});

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('the scrubbed fixture still exhibits the stall pattern (AC-2)', () => {
  const raw = readFileSync(SCRUBBED_TRANSCRIPT, 'utf8');
  const lines = nonEmptyLines(raw);

  it('kept the runaway source extent the frozen watermark is measured against', () => {
    // The pattern IS the two numbers: a watermark of 2 and a source of 56. If the
    // scrub had collapsed, truncated, or normalised the transcript, the fixture
    // would still "work" while proving something else entirely.
    expect(lines).toHaveLength(STALL_FIXTURE.transcript_nonempty_lines);
    expect(FROZEN_CURSOR).toBeLessThan(lines.length);
    expect(lines.length / FROZEN_CURSOR).toBeGreaterThan(20); // the ~27x under-count
  });

  it('kept the work that the stall silently discarded', () => {
    // The un-consumed window is not filler: it is the session's actual output.
    // Nine ApplyPatch edits were never captured — the loss the committed thin
    // segment concealed behind a plausible non-zero number.
    const unconsumed = lines.slice(FROZEN_CURSOR).join('\n');
    const applyPatches = unconsumed.match(/"name"\s*:\s*"ApplyPatch"/g) ?? [];
    expect(applyPatches).toHaveLength(9);
    expect(unconsumed).toContain('harness.js');
  });

  it('is publication-safe — the scrub did run', () => {
    // The same generic markers the corpus byte-scan enforces, asserted here so
    // this fixture's own privacy claim is not taken on trust.
    expect(raw).not.toMatch(/\/Users\//);
    expect(raw).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });
});

describe('the detector FIRES on the known-bad shape (AC-2)', () => {
  it('fires when capture dies in a swallowed throw', () => {
    // Mechanism shape 1: something inside the capture body throws. The contract
    // says the host command never sees it — so before this plan, the ONLY trace
    // was a watermark that quietly stopped moving.
    seedSandbox();
    seedFrozenMarkers();
    const exploding: HarnessAdapter = {
      ...cursorAdapter,
      extract: () => {
        throw new TypeError('capture body died');
      },
    };
    captureTelemetry(deps({ adapter: exploding }));
    captureTelemetry(deps({ adapter: exploding }));

    // The stall itself, reproduced: the watermark never moved off 2.
    expect(readCursorFile()).toBe(String(FROZEN_CURSOR));

    const marker = readMarker();
    expect(marker?.last_outcome).toBe('error');
    expect(marker?.last_error_kind).toBe('TypeError');
    expect(marker?.consecutive_uncaptured).toBe(2);
    expect(marker?.cursor).toBe(FROZEN_CURSOR);
    expect(marker?.position).toBe(STALL_FIXTURE.transcript_nonempty_lines);

    const layer = livenessLayer();
    expect(layer.ok).toBe(false);
    expect(layer.detail).toContain(SESSION);
    expect(layer.detail).toContain('CAPTURE STALLED');
    expect(layer.next_action).toBeDefined();
  });

  it('fires when the session source cannot be read while it is still growing', () => {
    // Mechanism shape 2: no throw at all. The adapter cannot reach its transcript,
    // so the window looks empty and capture returns having done nothing — the
    // silent-skip path, which is indistinguishable from health without a marker.
    seedSandbox();
    seedFrozenMarkers();
    const blind = { CURSOR_CONVERSATION_ID: SESSION }; // AGENT_TRANSCRIPTS gone
    captureTelemetry(deps({ env: blind }));
    captureTelemetry(deps({ env: blind }));

    expect(readCursorFile()).toBe(String(FROZEN_CURSOR));
    const marker = readMarker();
    expect(marker?.last_outcome).toBe('source-unreadable');
    expect(marker?.consecutive_uncaptured).toBe(2);
    expect(livenessLayer().ok).toBe(false);
  });

  it('fires on a finished lane that captured 2 of 56 lines and stopped', () => {
    // Mechanism shape 3 — the one every in-flight signal is blind to: the source
    // LAGS. Each attempt honestly saw "nothing new" and captured nothing, and the
    // transcript only reached its full length after the last harness command of
    // the session had already run. Individually healthy attempts, catastrophic
    // total: this is the 1a501a09 arithmetic exactly (2 of 56 captured).
    seedSandbox(FROZEN_CURSOR); // the source as capture saw it: 2 lines
    captureTelemetry(deps());
    expect(readCursorFile()).toBe(String(FROZEN_CURSOR));
    expect(readMarker()?.last_outcome).toBe('captured');

    seedSandbox(); // the writer finally flushes all 56 lines — nobody captures again

    const later = new Date(Date.parse(NOW) + LIVENESS_RESIDUE_IDLE_MS + 60_000).toISOString();
    const layer = livenessLayer(later);
    expect(layer.ok).toBe(false);
    expect(layer.detail).toContain('never captured');
    expect(layer.detail).toContain(
      `captured ${FROZEN_CURSOR} of ${STALL_FIXTURE.transcript_nonempty_lines}`,
    );
  });
});

describe('the detector stays QUIET on the healthy path (AC-3)', () => {
  it('is quiet when capture consumes the window it was given', () => {
    // The same fixture, the same frozen starting watermark, nothing injected:
    // capture consumes lines 2→56 in one segment and the cursor advances. This is
    // the controlled repro that passes BEFORE any fix — which is precisely why
    // its passing is worthless on its own, and why the firing tests above exist.
    seedSandbox();
    seedFrozenMarkers();
    captureTelemetry(deps());

    expect(readCursorFile()).toBe(String(STALL_FIXTURE.transcript_nonempty_lines));
    const marker = readMarker();
    expect(marker?.last_outcome).toBe('captured');
    expect(marker?.consecutive_uncaptured).toBe(0);
    expect(livenessLayer().ok).toBe(true);
  });

  it('is quiet for an idle poll that had nothing new to capture', () => {
    seedSandbox();
    seedFrozenMarkers();
    captureTelemetry(deps()); // consumes 2 → 56
    const afterCapture = readMarker();
    captureTelemetry(deps()); // nothing grew — a genuine no-window

    expect(readCursorFile()).toBe(String(STALL_FIXTURE.transcript_nonempty_lines));
    // Neutral outcomes are not persisted at all: the write-free idle path stays
    // write-free, and an idle poll can never be mistaken for a lost window.
    expect(readMarker()).toEqual(afterCapture);
    expect(livenessLayer().ok).toBe(true);
  });

  it('is quiet — and writes nothing — when telemetry is switched off', () => {
    seedSandbox();
    seedFrozenMarkers();
    captureTelemetry(
      deps({
        env: {
          CURSOR_CONVERSATION_ID: SESSION,
          AGENT_TRANSCRIPTS: transcripts,
          HARNESS_NO_TELEMETRY: '1',
        },
      }),
    );
    // The kill-switch keeps its zero-side-effect contract: no marker is written,
    // so a disabled run can never be reported as a stalled lane.
    expect(readMarker()).toBeNull();
    expect(readCursorFile()).toBe(String(FROZEN_CURSOR));
    expect(livenessLayer().ok).toBe(true);
  });

  it('is quiet for a zero-harness run', () => {
    seedSandbox();
    seedFrozenMarkers();
    captureTelemetry(deps({ env: {} }));
    expect(readMarker()).toBeNull();
    expect(livenessLayer().ok).toBe(true);
  });

  it('is quiet for a nested harness invocation that must not re-capture', () => {
    seedSandbox();
    seedFrozenMarkers();
    captureTelemetry(
      deps({
        env: {
          CURSOR_CONVERSATION_ID: SESSION,
          AGENT_TRANSCRIPTS: transcripts,
          HARNESS_TELEMETRY_DEPTH: '1',
        },
      }),
    );
    // A `checks` sub-verb is SUPPOSED not to capture; counting that as a missed
    // window would fire the detector on every healthy `checks` run.
    expect(readMarker()).toBeNull();
    expect(livenessLayer().ok).toBe(true);
  });
});

describe('the detector cannot hurt the host command (AC-5)', () => {
  it('swallows a marker-write failure without disturbing the capture', () => {
    seedSandbox();
    seedFrozenMarkers();
    const d = deps();
    const fs = d.fs as NodeFs;
    const realRename = fs.rename.bind(fs);
    // Fail ONLY the marker's rename — the capture's own writes must still land.
    (fs as unknown as { rename: (from: string, to: string) => void }).rename = (from, to) => {
      if (to.endsWith('.liveness.json')) throw new Error('EACCES');
      realRename(from, to);
    };
    expect(() => captureTelemetry(d)).not.toThrow();
    // The host command's telemetry is unaffected: the window was still consumed.
    expect(readCursorFile()).toBe(String(STALL_FIXTURE.transcript_nonempty_lines));
    expect(readMarker()).toBeNull();
  });
});
