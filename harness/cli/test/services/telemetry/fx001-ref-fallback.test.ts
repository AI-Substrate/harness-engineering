import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTelemetryAct } from '../../../src/acts/telemetry.js';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeGitWrite } from '../../../src/adapters/git/fake-git-write.js';
import type { GitReadPort } from '../../../src/adapters/git/git-read-port.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { CliIo, Writers } from '../../../src/output/output-port.js';
import { unwrapFailedBashResult } from '../../../src/services/telemetry/adapters/claude-adapter.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import {
  reconstructSegmentFromOtlpLogs,
  segmentToOtlpLogs,
} from '../../../src/services/telemetry/otlp/logs.js';
import { outcomeEvents } from '../../../src/services/telemetry/outcome-events.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  getSessionEvidence,
  resolveSessionEvidence,
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
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }),
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
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/u'),
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

  it('a ref namespace that is absent locally is REPORTED as such, never fatal', async () => {
    const { fs } = flushed([{ session: SESSION, pij: PIJ }]);
    // The refs live on a remote this clone never fetched: nothing local to read.
    const outcome = await resolveSessionEvidence(PIJ, deps(fs, new FakeGitRead()));
    expect(outcome.evidence).toBeNull(); // honest miss…
    // …and the miss says WHICH miss. "Checked and empty" would be a lie here.
    expect(outcome.ref_checked).toBe(false);
    expect(outcome.resolution).toBe('ref_unavailable');
  });

  it('a miss with the ref surface really consulted says both_empty', async () => {
    // The distinguishing pair: same null, opposite provenance. A ref namespace IS
    // present (a bystander's), it simply holds nothing for this session.
    const { fs, git } = flushed([{ session: OTHER_SESSION, pij: OTHER_PIJ }]);
    const outcome = await resolveSessionEvidence(PIJ, deps(fs, gitReadFor(git, [OTHER_REF])));
    expect(outcome.evidence).toBeNull();
    expect(outcome.ref_checked).toBe(true);
    expect(outcome.resolution).toBe('both_empty');
  });

  it('a read that THROWS resolves to resolution_failed, claiming nothing', async () => {
    // Fail-safe stays fail-safe — but failing safe is not licence to report a
    // conclusion never reached. Nothing was established, so nothing is claimed.
    const throwingFs = {
      readText: () => {
        throw new Error('fs exploded');
      },
      readdir: (): string[] => {
        throw new Error('fs exploded');
      },
    };
    const outcome = await resolveSessionEvidence(PIJ, {
      fs: throwingFs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/u'),
      proc: new FakeProcess({}, REPO),
      gitRead: new FakeGitRead(),
    });
    expect(outcome.evidence).toBeNull();
    expect(outcome.ref_checked).toBe(false);
    expect(outcome.resolution).toBe('resolution_failed');
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

describe('FX001 D4 — a FAILING harness command must still yield its outcome events', () => {
  // The refusal that never reached the wire. Claude Code wraps a failing Bash
  // tool_result with its own `Exit code N` line; `outcomeEvents` guards on the
  // trimmed text starting with `{`, so every non-zero harness command — which is
  // every refusal — produced NO command_exit at all. D2 kept the code through the
  // roll; D4 is why there was never a code to keep.
  const ENVELOPE = JSON.stringify({
    command: 'flow',
    status: 'error',
    error: { code: 'E440', message: 'node "boot" gates on "docs/tasks.dd.json#tasks"' },
  });

  it('the real Claude Code failure shape yields command_exit with its E-code', () => {
    const events = outcomeEvents(
      unwrapFailedBashResult(`Exit code 1\n${ENVELOPE}`, true),
      '2026-08-05T10:00:00.000Z',
      true,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'command_exit', verb: 'flow', exit: 1, code: 'E440' });
  });

  it('a CRLF transcript works too — the wrapper line ends either way', () => {
    const events = outcomeEvents(
      unwrapFailedBashResult(`Exit code 1\r\n${ENVELOPE}`, true),
      '2026-08-05T10:00:00.000Z',
      true,
    );
    expect(events[0]).toMatchObject({ kind: 'command_exit', code: 'E440' });
  });

  it('regression guard: a bare envelope under isError is untouched', () => {
    // The strip must never eat real content — a failing result with no wrapper
    // line has to parse exactly as it did before.
    const events = outcomeEvents(
      unwrapFailedBashResult(ENVELOPE, true),
      '2026-08-05T10:00:00.000Z',
      true,
    );
    expect(events[0]).toMatchObject({ kind: 'command_exit', verb: 'flow', exit: 1, code: 'E440' });
  });

  it('planted bad: prose behind the wrapper line is still not an envelope', () => {
    expect(
      outcomeEvents(
        unwrapFailedBashResult('Exit code 1\nbash: harness: command not found', true),
        '2026-08-05T10:00:00.000Z',
        true,
      ),
    ).toEqual([]);
    // …and a SUCCESSFUL result is never stripped: no isError, no unwrap.
    expect(unwrapFailedBashResult(`Exit code 1\n${ENVELOPE}`, false)).toBe(
      `Exit code 1\n${ENVELOPE}`,
    );
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
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/u'),
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
    // A ref namespace IS present (a bystander's) — so "checked and empty" is TRUE here.
    const { fs, git } = flushed([{ session: OTHER_SESSION, pij: OTHER_PIJ }]);
    const { io, out, err } = actIo();
    const code = await runGet(['pij-nobody'], io, fs, gitReadFor(git, [OTHER_REF]));
    const envelope = JSON.parse(out() || err());

    expect(code).toBe(1);
    expect(envelope.error.code).toBe('E100');
    expect(envelope.error.details).toEqual({
      ref_checked: true,
      resolution: 'both_empty',
      ref_namespace: 'present',
    });
    expect(envelope.next_action).toContain('BOTH surfaces were checked');
  });

  it('E100 with NO local ref namespace says so — it must not claim a checked ref', async () => {
    // R1: the error path owes the same provenance the success path does. The old
    // envelope hardcoded "both surfaces were empty" here, which was a false
    // diagnostic — the ref surface had never been reachable to be empty.
    const { io, out, err } = actIo();
    const code = await runGet(['pij-nobody'], io, new FakeFs({}, {}), new FakeGitRead());
    const envelope = JSON.parse(out() || err());

    expect(code).toBe(1);
    expect(envelope.error.code).toBe('E100');
    expect(envelope.error.details).toEqual({
      ref_checked: false,
      resolution: 'ref_unavailable',
      ref_namespace: 'absent',
    });
    expect(envelope.next_action).toContain('NO local refs/harness-telemetry/* namespace');
    expect(envelope.next_action).not.toContain('BOTH surfaces were checked');
  });

  it('E100 after a FAILED read claims nothing about either surface', async () => {
    // The third state the two-state reading misses: an exception is swallowed by the
    // fail-safe contract, and the envelope must not turn that into "checked and empty".
    const throwingFs = new FakeFs({}, {});
    throwingFs.readdir = () => {
      throw new Error('fs exploded');
    };
    const { io, out, err } = actIo();
    const code = await runGet(['pij-nobody'], io, throwingFs, new FakeGitRead());
    const envelope = JSON.parse(out() || err());

    expect(code).toBe(1);
    expect(envelope.error.details).toEqual({
      ref_checked: false,
      resolution: 'resolution_failed',
      ref_namespace: 'absent',
    });
    expect(envelope.next_action).toContain('absence of evidence, not evidence of absence');
  });
});

/**
 * FX001 · R2 — an UNREAD surface is not an EMPTY one.
 *
 * The R1 fix separated three resolutions and then reproduced the very defect it was
 * fixing one layer down: the ref reads swallowed a thrown git port into `[]`/an empty
 * map, so a read that never happened arrived as `absent`/`both_empty` — an ESTABLISHED
 * miss over a surface nobody looked at. The R1 exception control only ever threw from
 * `fs.readdir`, so the git-port paths were DEMONSTRATED by one throw source, never
 * tested across them.
 *
 * The distinction these controls pin, and that no future refactor may flatten:
 *   · a MALFORMED RECORD inside a readable surface → skip it, keep reading (by design)
 *   · a PORT READ FAILURE → `resolution_failed`; nothing about the surface is known
 */
describe('FX001 R2 — a failed read never poses as an empty one', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A port whose ref ENUMERATION fails (`git for-each-ref` non-zero / git absent). */
  function refListingFails(): FakeGitRead {
    const read = new FakeGitRead();
    const boom = (): never => {
      throw new Error('git for-each-ref failed (status 128)');
    };
    read.listTelemetryRefs = boom;
    read.listTelemetryRefsStrict = boom;
    return read;
  }

  /** A port that LISTS refs fine but fails to read a tree (`cat-file` failure). */
  function treeReadFails(git: FakeGitWrite, refs: readonly string[]): FakeGitRead {
    const read = gitReadFor(git, refs);
    const boom = (): never => {
      throw new Error('git cat-file failed: batch blob read exited non-zero');
    };
    read.readShardTree = boom;
    read.readShardTreeStrict = boom;
    return read;
  }

  it('a FAILED ref enumeration is resolution_failed, never "no namespace"', async () => {
    // Pass 1 of this defect: `telemetryRefsPresent` caught the throw and returned
    // false, which the act rendered as "there was NO local refs/harness-telemetry/*
    // namespace to check" — a statement about a surface the read never reached.
    const outcome = await resolveSessionEvidence(PIJ, deps(new FakeFs({}, {}), refListingFails()));

    expect(outcome.evidence).toBeNull();
    expect(outcome.resolution).toBe('resolution_failed');
    expect(outcome.ref_checked).toBe(false);
  });

  it('a FAILED tree read is resolution_failed, never both_empty', async () => {
    // Pass 2: the refs enumerate (so the namespace IS present), the tree read fails,
    // and the old reader swallowed it into an empty map — reported as "BOTH surfaces
    // were checked and both were empty". Nothing was read at all.
    const { fs, git } = flushed([{ session: SESSION, pij: PIJ }]);
    const outcome = await resolveSessionEvidence(PIJ, deps(fs, treeReadFails(git, [REF])));

    expect(outcome.evidence).toBeNull();
    expect(outcome.resolution).toBe('resolution_failed');
    expect(outcome.ref_checked).toBe(false);
  });

  it('a failing git port must NOT destroy a good buffer answer', async () => {
    // The ordering trap in the fix itself: the namespace probe runs FIRST, so making
    // it throw would sink a perfectly readable buffer read with it. A ref failure
    // costs the ref surface and nothing else.
    const files: Record<string, string> = {};
    const names: string[] = [];
    capture(files, names, SESSION, PIJ, 1);
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });

    const outcome = await resolveSessionEvidence(PIJ, deps(fs, refListingFails()));

    expect(outcome.resolution).toBe('resolved');
    expect(outcome.evidence?.segments).toBe(1);
    expect(outcome.evidence?.refusals).toEqual({ E440: 1 });
    expect(outcome.ref_checked).toBe(false); // the ref could not contribute — and says so
  });

  it('a MALFORMED record inside a readable ref is skipped, not fatal', async () => {
    // The half that must SURVIVE: one corrupt rolled record cannot blind a session.
    // It is skipped, the good record still answers, and the rejection is COUNTED so a
    // caller can tell "read nothing" from "rejected everything".
    const { fs, git } = flushed([{ session: SESSION, pij: PIJ }]);
    const corrupted = (git.readRefTree(REF) ?? []).map((b) => ({
      name: b.name,
      content: b.name.endsWith('.logs.jsonl') ? `${b.content}{ not json\n` : b.content,
    }));
    const read = new FakeGitRead().seedShard(REF, corrupted);

    const outcome = await resolveSessionEvidence(PIJ, deps(fs, read));

    expect(outcome.resolution).toBe('resolved');
    expect(outcome.evidence?.source).toBe('ref');
    expect(outcome.evidence?.segments).toBe(1);
    expect(outcome.records_skipped).toBe(1);
  });

  it('a MALFORMED buffer record is skipped; its readable sibling still answers', async () => {
    const files: Record<string, string> = {};
    const names: string[] = [];
    capture(files, names, SESSION, PIJ, 1);
    files[`${TEL}/${SESSION}/2.json`] = '{ truncated mid-write';
    names.push('2.json');
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });

    const outcome = await resolveSessionEvidence(PIJ, deps(fs, new FakeGitRead()));

    expect(outcome.resolution).toBe('resolved');
    expect(outcome.evidence?.segments).toBe(1);
    expect(outcome.records_skipped).toBe(1);
  });

  it('a miss over records it could not READ says how many it rejected', async () => {
    // Every record corrupt is not an empty buffer, and the two must not read alike.
    const fs = new FakeFs(
      { [`${TEL}/${SESSION}/1.json`]: '{ truncated', [`${TEL}/${SESSION}/2.json`]: 'nope' },
      { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: ['1.json', '2.json'] },
    );
    const outcome = await resolveSessionEvidence(PIJ, deps(fs, new FakeGitRead()));

    expect(outcome.evidence).toBeNull();
    expect(outcome.records_skipped).toBe(2);
  });

  it('a durable union that folds to NOTHING is a miss, never a hollow answer', async () => {
    // The buffer matches, every matched seq is at/below the flush watermark, and the
    // ref's copy does not carry the join key — so the union folds to zero segments.
    // `fold` still returns an OBJECT, and returning it would report `resolved` with
    // segments: 0: the hollow evidence this whole fix exists to abolish.
    const { fs, git, names } = flushed([{ session: SESSION, pij: OTHER_PIJ }]);
    const seg = serializeSegment(window(SESSION, PIJ, 1, richEvents), REPO);
    fs.writeText(`${TEL}/${SESSION}/1.json`, `${JSON.stringify(seg, null, 2)}\n`);
    names[SESSION]?.push('1.json');
    expect(fs.readText(`${TEL}/${SESSION}.flushed`)).not.toBeNull(); // seq 1 IS flushed

    const outcome = await resolveSessionEvidence(PIJ, deps(fs, gitReadFor(git, [REF])));

    expect(outcome.evidence).toBeNull();
    expect(outcome.resolution).toBe('both_empty');
  });

  it('a port WITHOUT the strict reads still works — degraded, never broken', async () => {
    // The strict variants are optional: an implementation that cannot separate a
    // failed read from an empty one falls back to the fail-safe form.
    const { fs, git } = flushed([{ session: SESSION, pij: PIJ }]);
    const seeded = gitReadFor(git, [REF]);
    const legacy: GitReadPort = {
      listTelemetryRefs: (glob) => seeded.listTelemetryRefs(glob),
      readShardTree: (ref) => seeded.readShardTree(ref),
      refsWithBlob: (refs, name) => seeded.refsWithBlob(refs, name),
      listRefHistory: (ref) => seeded.listRefHistory(ref),
      readTreeAtCommit: (commit) => seeded.readTreeAtCommit(commit),
    };
    expect(legacy.readShardTreeStrict).toBeUndefined();

    const outcome = await resolveSessionEvidence(PIJ, { ...deps(fs), gitRead: legacy });

    expect(outcome.resolution).toBe('resolved');
    expect(outcome.evidence?.source).toBe('ref');
  });

  it('the act envelope reports a FAILED tree read as such (E100, resolution_failed)', async () => {
    const { fs, git } = flushed([{ session: SESSION, pij: PIJ }]);
    const { io, out, err } = actIo();
    const code = await runGet([PIJ], io, fs, treeReadFails(git, [REF]));
    const envelope = JSON.parse(out() || err());

    expect(code).toBe(1);
    expect(envelope.error.code).toBe('E100');
    expect(envelope.error.details).toEqual({
      ref_checked: false,
      resolution: 'resolution_failed',
      ref_namespace: 'present',
    });
    // The exact false claims this control exists to keep out of the envelope.
    expect(envelope.next_action).not.toContain('BOTH surfaces were checked');
    expect(envelope.next_action).not.toContain('NO local refs/harness-telemetry/* namespace');
  });

  it('the act envelope reports records it could not read', async () => {
    const fs = new FakeFs(
      { [`${TEL}/${SESSION}/1.json`]: '{ truncated' },
      { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: ['1.json'] },
    );
    const { io, out, err } = actIo();
    const code = await runGet([PIJ], io, fs, new FakeGitRead());
    const envelope = JSON.parse(out() || err());

    expect(code).toBe(1);
    expect(envelope.error.details).toEqual({
      ref_checked: false,
      resolution: 'ref_unavailable',
      ref_namespace: 'absent',
      records_skipped: 1,
    });
    expect(envelope.next_action).toContain('UNREADABLE');
  });
});

/**
 * FX001 · R3 — "not checked" is not "not there", and a miss covers only the roots it
 * could reach.
 *
 * Two survivors of the R2 enumeration, both of which make the envelope ASSERT SOMETHING
 * IT DID NOT ESTABLISH — the line that decides what still gets fixed:
 *
 *  · a caller with NO git read port was mapped to namespace `absent`. The three-valued
 *    type was still one value short of the truth: it had no way to say "I had nothing to
 *    look WITH". The same too-small-type defect as the boolean it replaced, one layer out.
 *  · the LOCATOR silently drops the pij-folder candidate when `~/.pij/<id>.json` is
 *    corrupt, so "the buffer held nothing" quietly covers fewer roots than it sounds like.
 */
describe('FX001 R3 — an unchecked surface names itself', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('NO git read port resolves ref_namespace: not_checked, never absent', async () => {
    // The extension facade's exact shape. `absent` claimed the namespace was not there;
    // nothing looked. The resolution stays `ref_unavailable` — the ref could not
    // contribute either way — but the REASON is now a different one.
    const outcome = await resolveSessionEvidence(PIJ, deps(new FakeFs({}, {})));

    expect(outcome.evidence).toBeNull();
    expect(outcome.resolution).toBe('ref_unavailable');
    expect(outcome.ref_namespace).toBe('not_checked');
  });

  it('an EMPTY namespace still says absent — the two must not collapse the other way', async () => {
    // The control that keeps the fix honest in both directions: a real, readable,
    // empty ref namespace is an established `absent`, and must not drift to
    // `not_checked` just because both produce the same resolution.
    const outcome = await resolveSessionEvidence(PIJ, deps(new FakeFs({}, {}), new FakeGitRead()));

    expect(outcome.resolution).toBe('ref_unavailable');
    expect(outcome.ref_namespace).toBe('absent');
  });

  it('the act envelope tells a portless read from an absent namespace', async () => {
    // Driven through the REAL act with no gitRead injected — the same path any caller
    // without a git port takes.
    const { io, out, err } = actIo();
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerTelemetryAct(program, io, {
      fs: new FakeFs({}, {}),
      proc: new FakeProcess({}, REPO),
      clock: new FakeClock('2026-08-05T10:06:00.000Z'),
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1' }, '/home/u'),
      gitWrite: new FakeGitWrite(),
    });
    await expect(
      program.parseAsync(['node', 'harness', 'telemetry', 'get', 'pij-nobody']),
    ).rejects.toThrow(/^exit:/);
    const envelope = JSON.parse(out() || err());

    expect(code).toBe(1);
    expect(envelope.error.details).toEqual({
      ref_checked: false,
      resolution: 'ref_unavailable',
      ref_namespace: 'not_checked',
    });
    expect(envelope.next_action).toContain('NEVER CONSULTED');
    // The false diagnostic this control exists to keep out: a `git fetch` cannot fix a
    // missing port, and there was no finding of an absent namespace to report.
    expect(envelope.next_action).not.toContain('NO local refs/harness-telemetry/* namespace');
  });

  it('a CORRUPT ~/.pij/<id>.json is disclosed, not silently dropped', async () => {
    // The locator drops the worktree candidate and reads on. That is still the right
    // behaviour — but the miss must say it covered fewer roots than it could have.
    const fs = new FakeFs({ [`/home/u/.pij/${PIJ}.json`]: '{ "folder": ' }, {});
    const outcome = await resolveSessionEvidence(PIJ, deps(fs, new FakeGitRead()));

    expect(outcome.evidence).toBeNull();
    expect(outcome.locator_degraded).toBe(true);
  });

  it('a state file with no usable folder degrades too; a good one does NOT', async () => {
    const unusable = new FakeFs({ [`/home/u/.pij/${PIJ}.json`]: '{"folder":""}' }, {});
    expect((await resolveSessionEvidence(PIJ, deps(unusable))).locator_degraded).toBe(true);

    // The negative half: a state file that resolves is not a degradation, and neither
    // is an ABSENT one — `FsPort.readText` returns null for missing AND unreadable
    // alike, so flagging that would fire on every session without a pij state file.
    const good = new FakeFs({ [`/home/u/.pij/${PIJ}.json`]: '{"folder":"/repo"}' }, {});
    expect((await resolveSessionEvidence(PIJ, deps(good))).locator_degraded).toBe(false);
    expect((await resolveSessionEvidence(PIJ, deps(new FakeFs({}, {})))).locator_degraded).toBe(
      false,
    );
  });

  it('the act envelope discloses a dropped root', async () => {
    const fs = new FakeFs({ [`/home/u/.pij/pij-nobody.json`]: 'not json at all' }, {});
    const { io, out, err } = actIo();
    const code = await runGet(['pij-nobody'], io, fs, new FakeGitRead());
    const envelope = JSON.parse(out() || err());

    expect(code).toBe(1);
    expect(envelope.error.details).toEqual({
      ref_checked: false,
      resolution: 'ref_unavailable',
      ref_namespace: 'absent',
      locator_degraded: true,
    });
    expect(envelope.next_action).toContain('candidate buffer root was DROPPED');
  });

  it('a locator degradation NEVER stops the read from answering', async () => {
    // Fail-safe intact: the corrupt state file is disclosed AND the cwd candidate still
    // resolves the session. Disclosure must not become a refusal.
    const files: Record<string, string> = { [`/home/u/.pij/${PIJ}.json`]: '{ broken' };
    const names: string[] = [];
    capture(files, names, SESSION, PIJ, 1);
    const fs = new FakeFs(files, { [TEL]: [SESSION], [`${TEL}/${SESSION}`]: names });

    const outcome = await resolveSessionEvidence(PIJ, deps(fs, new FakeGitRead()));

    expect(outcome.resolution).toBe('resolved');
    expect(outcome.evidence?.segments).toBe(1);
    expect(outcome.locator_degraded).toBe(true);
  });
});
