import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  type CombineSessionDeps,
  combineSession,
} from '../../../src/services/telemetry/session-export.js';

/**
 * FX009 — the read-side unhandled-write-tool counter.
 *
 * THE TRIGGER IS EMPTY EXTRACTION, NOT AN UNKNOWN NAME, and that distinction is
 * the whole deliverable. The external report asked for a counter on a tool whose
 * NAME matches no known strategy. That would have reinstalled the defect: we add a
 * `Write` branch, guess its payload keys wrong, and the tool is now KNOWN — the
 * branch runs, extracts nothing, and a name-triggered counter stays silent. The
 * silent zero moves one level deeper and gets harder to find.
 *
 * So the condition is per segment: write-capable calls > 0 AND `file` events == 0.
 * It fires for a tool we believe we handle (guarding OUR OWN GUESS about the
 * `Write`/`StrReplace` payload shape) and for a tool we have never seen (guarding
 * the next Cursor rename). Both arms are tested here; neither may be dropped
 * because the other is green.
 *
 * The marker rides the EXISTING `degraded: string[]` under the EXISTING
 * `event_skipped:` prefix — no segment field, no `schema_version` bump, and the
 * envelope downgrade in `acts/telemetry.ts` happens by construction rather than by
 * a gate change.
 */

const GOLDEN = (rel: string): Segment =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as Segment;

const META = (rel: string): { harness: string } =>
  JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')) as {
    harness: string;
  };

const CURSOR_JUNE = './fixtures/real/cursor/2026-06-25-checks-walkthrough';
const CURSOR_AUGUST = './fixtures/real/cursor/2026-08-03-applypatch-textstat';

const MARKER_PREFIX = 'event_skipped:unhandled_write_tools:';
const T = '2026-08-06T02:00:00Z';

const tel = (root: string): string => `${root}/.harness/temp/telemetry`;

function layout(root: string, sub: string, segments: object[]) {
  const files: Record<string, string> = {};
  const names: string[] = [];
  segments.forEach((seg, i) => {
    files[`${tel(root)}/${sub}/${i}.json`] = JSON.stringify(seg);
    names.push(`${i}.json`);
  });
  return { files, dirs: { [`${tel(root)}/${sub}`]: names } };
}

function makeDeps(files: Record<string, string>, dirs: Record<string, string[]>) {
  const deps: CombineSessionDeps = {
    fs: new FakeFs(files, dirs),
    proc: new FakeProcess({}, '/nowhere'),
    env: new FakeEnv({}, '/home/dev'),
  };
  return deps;
}

/** Combine one or more already-serialized segments and return the `degraded` list. */
function degradedFor(segments: Segment[]): string[] {
  const { files, dirs } = layout('/work', 'sessFX009', segments);
  return combineSession('sessFX009', makeDeps(files, dirs), { root: '/work' }).summary.degraded;
}

/** The FX009 markers only, with the prefix stripped down to the offending tool name. */
function flaggedTools(segments: Segment[]): string[] {
  return degradedFor(segments)
    .filter((entry) => entry.startsWith(MARKER_PREFIX))
    .map((entry) => entry.slice(MARKER_PREFIX.length));
}

/** A real serialized segment: a tools histogram, and whatever file events are given. */
function seg(
  tools: Record<string, number>,
  fileEvents: Event[] = [],
  over: Partial<SegmentInput> = {},
): Segment {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'cursor-agent',
      harness_session_id: 'convFX009',
      timecode: T,
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      tools,
      event_stream: [{ t: T, kind: 'turn', dur_s: 1 }, ...fileEvents],
      ...over,
    },
    '/repo',
  );
}

const fileEvent = (path: string): Event => ({
  t: T,
  kind: 'file',
  path,
  change: 'written',
  delta: { lines_added: 1, lines_removed: 0, bytes_added: 1, bytes_removed: 0 },
});

describe('FX009 — the counter fires on EMPTY EXTRACTION', () => {
  it('fires for a KNOWN write tool that yielded no file events — our own guess is guarded', () => {
    // `Write` IS in the registry and the adapter HAS a branch for it. If the
    // payload keys in that branch are wrong (they are INHERITED — UNVERIFIED), the
    // branch runs and produces nothing. A name-triggered counter would say nothing
    // at all here; that is the case this assertion exists for.
    expect(flaggedTools([seg({ Write: 1, ReadFile: 3 })])).toEqual(['Write']);
  });

  it('fires for an UNKNOWN tool name — the rename guard, not taken on faith', () => {
    // Cursor has renamed its whole toolset once already on this machine. A name the
    // registry does not carry is treated as write-CAPABLE: the one thing we know
    // about a name we do not recognise is that we cannot rule out that it writes.
    expect(flaggedTools([seg({ EditFileV3: 2 })])).toEqual(['EditFileV3']);
  });

  it('names EVERY offending tool once, sorted and deduplicated across segments', () => {
    expect(flaggedTools([seg({ Write: 1, StrReplace: 1 }), seg({ Write: 4 })])).toEqual([
      'StrReplace',
      'Write',
    ]);
  });

  it('classifies a tool name carried ONLY by a `tools` EVENT (a logs-only shard has no histogram)', () => {
    const toolsEvent: Event = { t: T, kind: 'tools', name: 'StrReplace', count: 2, span_s: 0 };
    expect(flaggedTools([seg({}, [toolsEvent])])).toEqual(['StrReplace']);
  });

  it('degrades an ill-shaped tool name to the literal `unknown` rather than echoing it', () => {
    // Tool names are already on the wire in `segment.tools`, so naming them is no
    // new exposure — but `degraded[]` is a REPORT surface, so the marker carries a
    // bounded token instead of whatever string arrived.
    const wild = `Write${'!'.repeat(4)} rm -rf / #`;
    expect(flaggedTools([seg({ [wild]: 1 })])).toEqual(['unknown']);
  });
});

describe('FX009 — the counter stays silent when extraction WORKED', () => {
  it('does not fire when the same segment carries file events', () => {
    expect(flaggedTools([seg({ Write: 1 }, [fileEvent('src/a.ts')])])).toEqual([]);
  });

  it('does not fire for a write-FREE toolset (read/shell only) with no file events', () => {
    // A window that only read and ran shell commands measured zero writes. That is
    // a measured zero, and it must stay one — a marker that fires everywhere is
    // ignored, and an ignored marker is the silent zero again.
    expect(
      flaggedTools([seg({ Shell: 8, Read: 1, Glob: 1, ReadLints: 2, GetMcpTools: 1 })]),
    ).toEqual([]);
  });

  it('is scoped to Cursor — another harness is not judged by Cursor’s registry', () => {
    // Claude's `TodoWrite`/`Task` are unknown to the CURSOR table and would fire on
    // every Claude window. The cost is stated, not hidden: a Claude or Copilot
    // write-tool rename is NOT covered by this counter (recorded in
    // `docs/how/measuring-ai-contribution.md`'s Known blind spots).
    const claude = seg({ TodoWrite: 3, Task: 1 }, [], { harness: 'claude-code' });
    expect(flaggedTools([claude])).toEqual([]);
  });
});

describe('FX009 — the scope predicate is pinned to the CORPUS, not to a literal', () => {
  it('matches the harness id both real cursor fixtures actually carry', () => {
    // A scope gate that silently matches nothing makes the counter QUIET —
    // indistinguishable from finding nothing, i.e. FX009 inside the mechanism built
    // to detect FX009. If Cursor's harness id ever changes, this fails LOUDLY.
    const ids = [
      GOLDEN(`${CURSOR_JUNE}/expected-segment.json`).harness,
      GOLDEN(`${CURSOR_AUGUST}/expected-segment.json`).harness,
      META(`${CURSOR_JUNE}/meta.json`).harness,
      META(`${CURSOR_AUGUST}/meta.json`).harness,
    ];
    expect(new Set(ids).size).toBe(1); // one identifier in circulation, not several

    // …and the predicate fires for exactly that id: proof the gate matches the
    // corpus rather than a literal that only exists in the counter's head.
    const observed = ids[0];
    expect(flaggedTools([seg({ Write: 1 }, [], { harness: observed })])).toEqual(['Write']);
  });
});

describe('FX009 — the two REAL cursor fixtures must NOT fire', () => {
  it('2026-06-25 checks-walkthrough (Shell/Read/Glob, zero file events) — table completeness', () => {
    // A real producer session with a write-free toolset. It also guards the
    // REGISTRY: were `Read` or `Glob` missing from the table they would classify as
    // unknown and fire here immediately.
    const june = GOLDEN(`${CURSOR_JUNE}/expected-segment.json`);
    expect(june.tools).toEqual({ Shell: 8, Glob: 1, Read: 1 });
    expect(june.event_stream.some((e) => e.kind === 'file')).toBe(false);
    expect(flaggedTools([june])).toEqual([]);
  });

  it('2026-08-03 applypatch-textstat (ApplyPatch WITH file events) — the other direction', () => {
    const august = GOLDEN(`${CURSOR_AUGUST}/expected-segment.json`);
    expect(august.tools?.ApplyPatch).toBe(9);
    expect(august.event_stream.filter((e) => e.kind === 'file')).not.toHaveLength(0);
    expect(flaggedTools([august])).toEqual([]);
  });
});

describe('FX009 — the marker reaches the surface consumers read', () => {
  it('rides the `event_skipped:` prefix `acts/telemetry` already downgrades on', () => {
    // The prefix is load-bearing, not cosmetic: `acts/telemetry.ts` selects
    // `metric_skipped:`/`event_skipped:` entries out of `degraded[]` and declines to
    // report ok when any match. A marker with no effect on the status is a signal
    // that never reaches the surface anyone reads — FX009, one level up.
    const marker = degradedFor([seg({ Write: 1 })]).filter((entry) =>
      entry.startsWith(MARKER_PREFIX),
    );
    expect(marker).toEqual(['event_skipped:unhandled_write_tools:Write']);
    expect(
      marker.filter(
        (entry) => entry.startsWith('metric_skipped:') || entry.startsWith('event_skipped:'),
      ),
    ).toHaveLength(1);
  });

  it('adds nothing to `degraded` when nothing is unhandled (no new noise on a clean session)', () => {
    expect(
      degradedFor([seg({ ApplyPatch: 1 }, [fileEvent('src/a.ts')])]).filter((entry) =>
        entry.startsWith('event_skipped:unhandled_write_tools'),
      ),
    ).toEqual([]);
  });
});
