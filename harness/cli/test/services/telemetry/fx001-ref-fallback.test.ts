import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetryAct } from '../../../src/acts/telemetry.js';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { CliIo, Writers } from '../../../src/output/output-port.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import {
  reconstructSegmentFromOtlpLogs,
  segmentToOtlpLogs,
} from '../../../src/services/telemetry/otlp/logs.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  getSessionEvidence,
  type SessionEvidenceDeps,
} from '../../../src/services/telemetry/session-evidence.js';
import { type SyncDeps, syncTelemetry } from '../../../src/services/telemetry/sync-service.js';

/**
 * FX001 — `telemetry get` must read the REF when the buffer is flushed.
 *
 * The post-commit hook flushes on every commit, so any subject that commits blinds
 * its own telemetry lane: the segments move to `refs/harness-telemetry/*` and the
 * buffer keeps only markers. Before this fix the read path answered from a partial
 * ref LANE (token totals only) or, with no join key / no git read port, `null` →
 * `E100` — and either way every derived view the conformance scorer asserts on
 * (`skills`, `tools`, `flow_seams`, `refusals`) came back EMPTY. A10 `gate-refused`
 * is the assertion the scenario exists for, so an empty `refusals` is the whole
 * lane failing quietly.
 *
 * Every control here is built from the REAL pipeline — `serializeSegment` →
 * `syncTelemetry` (which writes the rolled ref and prunes the buffer) → the ref read
 * back through the READ port — so the fixture is the production rollup shape, not a
 * bespoke one. The wrong-session control proves the join can still say NO.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';
const SESSION = 'hs-fx001';
const PIJ = 'pij-subject';
const REF = `refs/harness-telemetry/2026/08/05/${SESSION}`;
const OTHER_SESSION = 'hs-other';
const OTHER_PIJ = 'pij-bystander';
const OTHER_REF = `refs/harness-telemetry/2026/08/05/${OTHER_SESSION}`;

/** The events a scored run is asserted on: a skill, a tool, a flow seam, a REFUSAL. */
function richEvents(t: string): Event[] {
  return [
    { t, kind: 'turn', dur_s: 1, in: 100, out: 20 },
    { t, kind: 'skill', name: 'the-flow', status: 'completed' },
    { t, kind: 'tools', name: 'Bash', count: 3, span_s: 1 },
    { t, kind: 'flow', flow: 'sdd', stage: '6', status: 'done' },
    { t, kind: 'harness', verb: 'flow nav set' },
    // The gate refusal: exit 1 carrying the E-code. Nothing else in the record
    // distinguishes "the gate stopped me" from any other non-zero exit.
    { t, kind: 'command_exit', verb: 'flow nav set', exit: 1, status: 'error', code: 'E440' },
  ] as Event[];
}

function window(
  session: string,
  pij: string,
  seq: number,
  events: (t: string) => Event[],
): SegmentInput {
  const t = `2026-08-05T10:0${seq}:00.000Z`;
  return {
    command: 'flow',
    harness: 'claude-code',
    harness_session_id: session,
    timecode: t,
    window: { since: 'session-start', from: 0, to: 1 },
    branch: null,
    tokens: null,
    event_stream: events(t),
    captured_env: { PIJ_SESSION_ID: pij, PIJ_HARNESS: 'claude' },
  };
}

/** Write one seq's spool triple into the buffer, exactly as a live capture does. */
function capture(
  files: Record<string, string>,
  names: string[],
  session: string,
  pij: string,
  seq: number,
  events: (t: string) => Event[] = richEvents,
): void {
  const seg = serializeSegment(window(session, pij, seq, events), REPO);
  files[`${TEL}/${session}/${seq}.json`] = `${JSON.stringify(seg, null, 2)}\n`;
  files[`${TEL}/${session}/${seq}.logs.jsonl`] = `${JSON.stringify(segmentToOtlpLogs(seg))}\n`;
  files[`${TEL}/${session}/${seq}.metrics.jsonl`] = `${JSON.stringify({ resourceMetrics: [] })}\n`;
  names.push(`${seq}.json`, `${seq}.logs.jsonl`, `${seq}.metrics.jsonl`);
}

function syncDeps(fs: FakeFs, git: FakeGitWrite): SyncDeps {
  return {
    fs,
    env: new FakeEnv({}),
    proc: new FakeProcess({}, REPO),
    git,
    clock: new FakeClock('2026-08-05T10:05:00.000Z'),
  };
}

/** Bridge the pushed ref tree back through the READ port — same bytes, read-only. */
function gitReadFor(git: FakeGitWrite, refs: readonly string[]): FakeGitRead {
  const read = new FakeGitRead();
  for (const ref of refs) {
    read.seedShard(
      ref,
      (git.readRefTree(ref) ?? []).map((b) => ({ name: b.name, content: b.content })),
    );
  }
  return read;
}

function deps(fs: FakeFs, gitRead?: FakeGitRead): SessionEvidenceDeps {
  return {
    fs,
    env: new FakeEnv({}, '/home/u'),
    proc: new FakeProcess({}, REPO),
    ...(gitRead ? { gitRead } : {}),
  };
}

/**
 * Capture → sync → prune: the exact state the post-commit hook leaves behind.
 * Returns the post-flush fs plus a READ port over the ref the sync actually wrote.
 */
function flushed(sessions: Array<{ session: string; pij: string }>): {
  fs: FakeFs;
  git: FakeGitWrite;
  /** The live `readdir` listing per session — push a name to make a later write visible. */
  names: Record<string, string[]>;
} {
  const files: Record<string, string> = {};
  const dirs: Record<string, string[]> = { [TEL]: sessions.map((s) => s.session) };
  const names: Record<string, string[]> = {};
  for (const s of sessions) {
    const own: string[] = [];
    capture(files, own, s.session, s.pij, 1);
    dirs[`${TEL}/${s.session}`] = own;
    names[s.session] = own;
  }
  const fs = new FakeFs(files, dirs);
  const git = new FakeGitWrite();
  expect(syncTelemetry(syncDeps(fs, git)).ok).toBe(true);
  return { fs, git, names };
}

describe('FX001 T3 — the ref fallback, controls both ways', () => {
  it('(a) a FLUSHED buffer + a present ref returns the whole session from the ref', async () => {
    const { fs, git } = flushed([{ session: SESSION, pij: PIJ }]);
    // The buffer really is markers-only — the segment bytes are gone.
    expect(fs.readText(`${TEL}/${SESSION}/1.json`)).toBeNull();
    expect(fs.readText(`${TEL}/${SESSION}.flushed`)?.trim()).toBe('1');

    const evidence = await getSessionEvidence(PIJ, deps(fs, gitReadFor(git, [REF])));

    expect(evidence).not.toBeNull();
    expect(evidence?.segments).toBe(1);
    expect(evidence?.harness_session_id).toBe(SESSION);
    // The derived views the scorer asserts on — empty before the fix, real now.
    expect(evidence?.skills).toEqual({ 'the-flow': 1 });
    expect(evidence?.tools).toEqual({ Bash: 3 });
    expect(evidence?.flow_seams).toEqual(['sdd:6']);
    expect(evidence?.harness_verbs).toEqual({ 'flow nav set': 1 });
    // A10 `gate-refused` — the assertion the scenario exists for.
    expect(evidence?.refusals).toEqual({ E440: 1 });
    // …and the envelope SAYS where the evidence came from.
    expect(evidence?.source).toBe('ref');
    expect(evidence?.ref_checked).toBe(true);
  });

  it('(b) both surfaces empty still resolves to null — E100 keeps its meaning', async () => {
    const fs = new FakeFs({}, {});
    expect(await getSessionEvidence(PIJ, deps(fs, new FakeGitRead()))).toBeNull();
    // …and with no git read port at all (the extension facade's shape).
    expect(await getSessionEvidence(PIJ, deps(fs))).toBeNull();
  });

  it('(c) a populated buffer is answered from the buffer, byte-identical to today', async () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    capture(files, names, SESSION, PIJ, 1);
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });

    const withRef = await getSessionEvidence(PIJ, deps(fs, new FakeGitRead()));
    const withoutRef = await getSessionEvidence(PIJ, deps(fs));

    expect(withRef?.source).toBe('buffer');
    expect(withRef?.ref_checked).toBe(false); // no ref namespace to check
    expect(withRef?.skills).toEqual({ 'the-flow': 1 });
    expect(withRef?.refusals).toEqual({ E440: 1 });
    // The provenance fields are the ONLY difference a git read port can make here.
    expect({ ...withRef, source: null, ref_checked: null }).toEqual({
      ...withoutRef,
      source: null,
      ref_checked: null,
    });
  });

  it('(d) wrong-session control: another session’s ref must NOT satisfy the join', async () => {
    const { fs, git } = flushed([{ session: OTHER_SESSION, pij: OTHER_PIJ }]);
    const gitRead = gitReadFor(git, [OTHER_REF]);

    // The bystander's ref is real and readable…
    expect(await getSessionEvidence(OTHER_PIJ, deps(fs, gitRead))).not.toBeNull();
    // …and it still answers NO for the session that has no telemetry.
    expect(await getSessionEvidence(PIJ, deps(fs, gitRead))).toBeNull();
  });

  it('a flushed half + an unflushed delta says buffer+ref, and counts both', async () => {
    const { fs, git, names } = flushed([{ session: SESSION, pij: PIJ }]);
    // One more capture AFTER the prune — the delta the ref cannot know about.
    const seg2 = serializeSegment(window(SESSION, PIJ, 2, richEvents), REPO);
    fs.writeText(`${TEL}/${SESSION}/2.json`, `${JSON.stringify(seg2, null, 2)}\n`);
    names[SESSION]?.push('2.json');

    const evidence = await getSessionEvidence(PIJ, deps(fs, gitReadFor(git, [REF])));

    expect(evidence?.segments).toBe(2);
    expect(evidence?.source).toBe('buffer+ref');
    expect(evidence?.ref_checked).toBe(true);
    expect(evidence?.refusals).toEqual({ E440: 2 });
  });

  it('a ref namespace that is absent locally is reported, never fatal', async () => {
    const { fs } = flushed([{ session: SESSION, pij: PIJ }]);
    // The refs live on a remote this clone never fetched: nothing local to read.
    const evidence = await getSessionEvidence(PIJ, deps(fs, new FakeGitRead()));
    expect(evidence).toBeNull(); // honest E100 — but the act still says ref_checked
  });
});

describe('FX001 D2 — a refusal code must survive the OTLP round trip', () => {
  it('command_exit.code round-trips through the rolled logs record', () => {
    const seg = serializeSegment(window(SESSION, PIJ, 1, richEvents), REPO);
    const back = reconstructSegmentFromOtlpLogs(segmentToOtlpLogs(seg));

    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const exits = back.segment.event_stream.filter((e) => e.kind === 'command_exit');
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ verb: 'flow nav set', exit: 1, code: 'E440' });
  });

  it('a non-E-code value is REFUSED by the wire contract, not quietly accepted', () => {
    // The planted bad: message text where the fixed vocabulary belongs. `code` is a
    // producer-owned enum, so a record carrying anything else was not written by this
    // producer — the strict reader rejects it exactly as it does for every other
    // contract attribute, rather than admitting prose into a counts-only field.
    const seg = serializeSegment(window(SESSION, PIJ, 1, richEvents), REPO);
    const logs = segmentToOtlpLogs(seg);
    const attr = logs.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords
      ?.flatMap((r) => r.attributes ?? [])
      .find((a) => a.value.stringValue === 'E440');
    expect(attr).toBeDefined(); // the code IS on the wire post-fix
    if (attr) attr.value = { stringValue: 'refused: gate said no' };

    expect(reconstructSegmentFromOtlpLogs(logs).ok).toBe(false);
  });
});

/** Capture the act's JSON envelope without touching stdout. */
function actIo(): { io: CliIo; out: () => string; err: () => string } {
  let o = '';
  let e = '';
  const writers: Writers = {
    out: (t) => {
      o += t;
    },
    err: (t) => {
      e += t;
    },
  };
  return { io: { mode: 'json', writers }, out: () => o, err: () => e };
}

/** Drive the REAL registered `telemetry get` act; only `process.exit` is stubbed. */
async function runGet(
  args: string[],
  io: CliIo,
  fs: FakeFs,
  gitRead: FakeGitRead,
): Promise<number> {
  let code = -1;
  vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    code = c ?? 0;
    throw new Error(`exit:${code}`);
  }) as never);
  const program = new Command().name('harness');
  registerTelemetryAct(program, io, {
    fs,
    proc: new FakeProcess({}, REPO),
    clock: new FakeClock('2026-08-05T10:06:00.000Z'),
    env: new FakeEnv({}, '/home/u'),
    gitWrite: new FakeGitWrite(),
    gitRead,
  });
  // The `get` action is async — commander only surfaces the exit through parseAsync.
  await expect(
    program.parseAsync(['node', 'harness', 'telemetry', 'get', ...args]),
  ).rejects.toThrow(/^exit:/);
  return code;
}

describe('FX001 T2 — the act envelope names its evidence source', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('`telemetry get` on a flushed session exits 0 and reports source: ref', async () => {
    const { fs, git } = flushed([{ session: SESSION, pij: PIJ }]);
    const { io, out } = actIo();

    const code = await runGet([PIJ], io, fs, gitReadFor(git, [REF]));
    const envelope = JSON.parse(out());

    expect(code).toBe(0);
    expect(envelope.data.source).toBe('ref');
    expect(envelope.data.ref_checked).toBe(true);
    expect(envelope.data.refusals).toEqual({ E440: 1 });
  });

  it('`telemetry get` still errors E100 when BOTH surfaces are empty', async () => {
    const { io, out, err } = actIo();
    const code = await runGet(['pij-nobody'], io, new FakeFs({}, {}), new FakeGitRead());
    expect(code).toBe(1);
    expect(JSON.parse(out() || err()).error.code).toBe('E100');
  });
});
