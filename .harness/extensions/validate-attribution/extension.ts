import type { HarnessVerb, VerbContext, VerbResult } from '@ai-substrate/engineering-harness/contract';
import {
  type Channel,
  type Evidence,
  type GroundTruth,
  type JournalEntry,
  type NoteClaim,
  type NoteEvidence,
  type RelayEntry,
  type SandboxProbe,
  commitSignalRelays,
  scoreRun,
} from './scoring.js';

/**
 * `harness validate-attribution --begin | --end` (plan 082 phase 4).
 *
 * THE EXECUTABLE FORM of the manual procedure in
 * `docs/how/telemetry/validating-telemetry-capture-in-sandboxed-agents.md`. It is
 * not a new explanation — the reasoning lives in those docs and this file links
 * them rather than restating them.
 *
 * WHAT IT VALIDATES: that **git-ai's attribution capture survives a sandboxed
 * agent**. Our hook relay is one component alongside git-ai's checkpoint channel
 * and the agent's own hook config. A run where our relay emits perfectly and no
 * note appears is a FAILURE of the thing under test.
 *
 * TWO PHASES, BECAUSE ONE STEP CANNOT BE AUTOMATED — the agent has to actually run,
 * and the connectivity probe has to execute INSIDE its sandbox:
 *
 *   --begin   baseline, relay census, binary identity, emit the probe, print the prompt
 *              … the human pastes the prompt into their agent …
 *   --end     journal delta, probe result, note identity, verdict
 *
 * IT NEVER ACTS. It reads, it reports, and it refuses. It will not remove a relay
 * from anyone's agent config, will not change a sandbox setting, and will not
 * "fix" a machine to make a run scoreable. A second relay invalidates a result; it
 * is not a thing to delete on the operator's behalf. Who removes what is their call.
 *
 * ARCHITECTURE: all scoring is in `scoring.ts`, which is pure and has no imports.
 * This file is the I/O shell. That split is what lets the two real control runs be
 * replayed from recorded evidence in `scoring.test.ts`.
 */

/** Where the run record lives, inside the repo under test. */
const RECORD = '.harness-attribution-run.json';
/** Where the in-sandbox probe is written, and where its output is expected. */
const PROBE = '.harness-attribution-probe.py';
const PROBE_OUT = '.harness-attribution-probe.out';
/** What the agent writes to declare which lines it personally authored. */
const GROUND_TRUTH = '.harness-attribution-truth.json';

/**
 * ALWAYS this ref. `--ref=git-ai` prints nothing, and "no note" is the total-loss
 * signature — so reading the wrong ref manufactures a false negative that is
 * indistinguishable from the failure the whole exercise hunts for.
 */
const NOTES_REF = 'refs/notes/ai';

/** Our hook's marker token — the one thing that identifies an entry as ours. */
const OUR_MARKER = 'ai-substrate-harness-hook-v1';

/**
 * Agent hook-config locations, relative to home.
 *
 * DUPLICATED FROM THE CORE'S AGENT MATRIX, AND THE DUPLICATION IS CHECKED. Reading
 * these through `harness hooks status --json` would be the single-source answer,
 * except that `status` calls `journal.compact()` and so can rewrite the very
 * journal this verb is about to baseline. A diagnostic that truncates the evidence
 * it is collecting is not usable here.
 *
 * So the map is restated, and `extension.test.ts` asserts it against what the core
 * itself reports in a fenced HOME. Duplication that is MEASURED to agree is a
 * different thing from duplication that is assumed to.
 */
const AGENT_CONFIGS: Readonly<Record<string, readonly string[]>> = {
  cursor: ['.cursor/hooks.json'],
  'claude-code': ['.claude/settings.json'],
  gemini: ['.gemini/settings.json'],
  droid: ['.factory/settings.json'],
  firebender: ['.firebender/hooks.json'],
  'github-copilot': ['.copilot/hooks/harness.json'],
  windsurf: ['.codeium/hooks.json', '.codeium/windsurf/hooks.json'],
};

/**
 * The probe that must run INSIDE the agent's sandboxed shell.
 *
 * IT MEASURES THE SHELL, NOT THE HOOK. The hook runner is not sandboxed, and a
 * hook-side "connected" is the PREMISE of the design rather than a finding. This
 * distinction has already inverted one careful reader's conclusion, so the probe
 * prints its own context on every line.
 */
const PROBE_SOURCE = `#!/usr/bin/env python3
"""Shell-side connectivity probe for \`harness validate-attribution\`.

MUST be run by the AGENT, inside its own shell, during the run. It answers one
question: can this shell reach the git-ai daemon?

REFUSED on both sockets is the condition the feature exists for. CONNECTED means
git-ai reached the daemon unaided and the run proves nothing about the relay.

This is NOT the hook-side probe. The hook runner is not sandboxed and is expected
to connect; that is where we emit from.
"""
import json, os, socket, sys
from pathlib import Path

BASE = Path(os.path.expanduser("~")) / ".git-ai" / "internal" / "daemon"


def probe(path):
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(2)
        s.connect(str(path))
        s.close()
        return "connected"
    except PermissionError:
        return "refused"
    except Exception as e:  # noqa: BLE001 — the errno IS the result
        return "refused" if getattr(e, "errno", None) in (1, 13) else "unknown:%s" % type(e).__name__


out = {
    "context": "shell",
    "control": probe(BASE / "control.sock"),
    "trace2": probe(BASE / "trace2.sock"),
    "sandboxEnv": os.environ.get("CURSOR_SANDBOX", os.environ.get("SANDBOX", "unset")),
}
print(json.dumps(out, indent=2))
sys.exit(0)
`;

/**
 * Classify ONE command string.
 *
 * PER SEGMENT, AND THE WORST SEGMENT WINS. A hook entry is not one tool's command —
 * the shape measured on a real machine is a compound chain in which a third party
 * wrapped somebody else's invocation. Classifying the whole string by its most
 * recognisable part is how `hook-probe.py; tee | git-ai checkpoint` gets filed as
 * "just a checkpoint" and its unknown first segment disappears.
 */
export function classifyCommand(command: string): Channel {
  const segments = command
    .split(/(?:&&|\|\||[;|\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return 'inert';

  let worst: Channel = 'inert';
  const rank: Record<Channel, number> = {
    inert: 0,
    checkpoint: 1,
    'commit-signal': 2,
    unknown: 3,
  };
  for (const segment of segments) {
    const channel = classifySegment(segment);
    if (rank[channel] > rank[worst]) worst = channel;
  }
  return worst;
}

function classifySegment(segment: string): Channel {
  const tokens = segment.split(/\s+/).map((t) => t.replace(/^['"]+|['"]+$/g, ''));
  // Ours: exact-token marker match, never `includes` on the whole string.
  if (tokens.includes(OUR_MARKER)) return 'commit-signal';
  // git-ai's own checkpoint channel: records what the agent wrote, sends no commit
  // signal, and is REQUIRED for attribution. Its presence never confounds a run.
  if (/git-ai$|git-ai\.exe$/.test(tokens[0] ?? '') && tokens.includes('checkpoint')) {
    return 'checkpoint';
  }
  // Recognised no-ops. `tee` and a bare redirect move bytes and talk to nothing.
  if (['tee', 'cat', 'true', ':'].includes((tokens[0] ?? '').split('/').pop() ?? '')) {
    return 'inert';
  }
  return 'unknown';
}

/**
 * A stable key for the RELAY behind an entry — the program, not the invocation.
 *
 * Our entry is keyed by the marker (its path moves between installs and phases; the
 * marker does not). Everything else is keyed by the script or binary each of its
 * non-inert segments names, so `hook-probe.py; tee | git-ai checkpoint` keys the
 * same on PRE and POST.
 */
export function relayIdentity(command: string): string {
  const segments = command
    .split(/(?:&&|\|\||[;|\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const parts: string[] = [];
  for (const segment of segments) {
    const tokens = segment.split(/\s+/).map((t) => t.replace(/^['"]+|['"]+$/g, ''));
    if (tokens.includes(OUR_MARKER)) {
      parts.push(OUR_MARKER);
      continue;
    }
    if (classifySegment(segment) === 'inert') continue;
    // The first token that is not an interpreter names the actual program.
    const meaningful =
      tokens.find(
        (t, i) => i > 0 && /\.(py|mjs|cjs|js|sh|rb)$/.test(t),
      ) ?? tokens[0] ?? '';
    parts.push(meaningful.split('/').pop() ?? meaningful);
  }
  return parts.join('+');
}

/** Every hook entry in an agent's config, classified and located. */
export function censusFrom(
  configPath: string,
  contents: string,
  acknowledgements: readonly string[],
): RelayEntry[] {
  let parsed: { hooks?: Record<string, { command?: string }[]> };
  try {
    parsed = JSON.parse(contents) as typeof parsed;
  } catch {
    return [];
  }
  const out: RelayEntry[] = [];
  for (const [event, entries] of Object.entries(parsed.hooks ?? {})) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      const command = entry?.command;
      if (typeof command !== 'string' || command.trim() === '') return;
      const channel = classifyCommand(command);
      out.push({
        source: `${configPath} ${event}[${index}]`,
        command,
        channel,
        identity: relayIdentity(command),
        ours: command.split(/\s+/).some((t) => t.replace(/^['"]+|['"]+$/g, '') === OUR_MARKER),
        acknowledged: acknowledgements.some((ack) => ack !== '' && command.includes(ack)),
      });
    });
  }
  return out;
}

/** Parse our hook journal, keeping only entries strictly after `since`. */
export function journalSince(contents: string | null, since: string): JournalEntry[] {
  if (contents === null) return [];
  const out: JournalEntry[] = [];
  for (const line of contents.split('\n')) {
    if (line.trim() === '') continue;
    let row: {
      at?: string;
      phase?: string;
      outcome?: { kind?: string; head?: string; reason?: string; cause?: string };
    };
    try {
      row = JSON.parse(line) as typeof row;
    } catch {
      continue;
    }
    const at = row.at ?? '';
    if (at <= since) continue;
    const kind = row.outcome?.kind;
    if (kind !== 'recorded' && kind !== 'emitted' && kind !== 'silent' && kind !== 'failed') {
      continue;
    }
    out.push({
      at,
      phase: row.phase === 'pre' ? 'pre' : 'post',
      kind,
      head: row.outcome?.head,
      reason: row.outcome?.reason ?? row.outcome?.cause,
    });
  }
  return out;
}

/**
 * Parse a `git notes --ref=ai show <sha>` body into per-path claims.
 *
 * The body is indented `path` / `actor lines` pairs above a `---` JSON footer:
 *
 *   AI7.md
 *     s_1b36c35afd9ad7::t_a277ffed9b3787 1-3
 *   jordan7.md
 *     h_9e71e8b09f7cf2 1-8
 */
export function parseNoteBody(body: string): NoteClaim[] {
  const claims: NoteClaim[] = [];
  let path: string | null = null;
  for (const raw of body.split('\n')) {
    if (raw.trim() === '---') break;
    if (raw.trim() === '') continue;
    if (!/^\s/.test(raw)) {
      path = raw.trim();
      continue;
    }
    const claim = /^\s+(s_[0-9a-f]+::t_[0-9a-f]+|h_[0-9a-f]+)\s+(\S+)/.exec(raw);
    if (claim === null || path === null) continue;
    claims.push({
      path,
      actor: claim[1].startsWith('s_') ? 'session' : 'human',
      lines: claim[2],
    });
  }
  return claims;
}

interface RunRecord {
  agent: string;
  repo: string;
  home: string;
  startedAt: string;
  journalCursor: string;
  headBefore: string;
  binary?: { path: string; mtimeBefore: string };
  acknowledgements: string[];
}

const extension: HarnessVerb = {
  name: 'validate-attribution',
  summary: 'Validate that git-ai attribution capture survives a sandboxed agent (two phases).',
  description: [
    'Turns the manual validation procedure into two commands with a human in the middle.',
    '',
    '  --begin   baseline, relay census, binary identity, writes the in-sandbox probe,',
    '            prints the prompt to paste into your agent',
    '  --end     journal delta, probe result, note identity, verdict',
    '',
    'Verdicts are PASS, FAIL and INCONCLUSIVE. INCONCLUSIVE is first-class: it means',
    'the run was fine and the EXPERIMENT was not — a competing relay, an unmeasured',
    'sandbox, or a rebuilt binary. It is the normal outcome of a careful first attempt.',
    '',
    'It never acts: no config is edited, no relay removed, no sandbox setting changed.',
    '',
    'Background reading (this verb implements them, it does not replace them):',
    '  docs/how/telemetry/validating-telemetry-capture-in-sandboxed-agents.md  — the WHY',
    '  docs/how/telemetry/cursor-validation-kit/README.md                      — the RUNBOOK',
    '  docs/how/telemetry/gitai-06-two-channel-model.md                        — the MECHANISM',
    '  .harness/extensions/validate-attribution/README.md                      — how to run THIS',
  ].join('\n'),
  options: [
    { flags: '--begin', description: 'start a run: baseline + census + emit the probe' },
    { flags: '--end', description: 'finish a run: gather evidence and score it' },
    { flags: '--agent <name>', description: 'agent under test', defaultValue: 'cursor' },
    { flags: '--repo <path>', description: 'repository the agent will commit in (default: cwd)' },
    {
      flags: '--acknowledge <substring>',
      description:
        'declare a hook entry containing <substring> to be NOT a commit-signal relay. Repeatable. Recorded in the evidence — the tool never infers this.',
    },
  ],
  async run(ctx: VerbContext): Promise<VerbResult> {
    const begin = ctx.options.begin === true;
    const end = ctx.options.end === true;
    if (begin === end) {
      return {
        status: 'error',
        error: {
          code: 'E_PHASE',
          message: 'exactly one of --begin or --end is required',
        },
        next_action:
          'Run `harness validate-attribution --begin`, paste the prompt into your agent, then run `--end`.',
      };
    }
    try {
      return begin ? await runBegin(ctx) : await runEnd(ctx);
    } catch (error) {
      return {
        status: 'error',
        error: { code: 'E_UNEXPECTED', message: (error as Error).message },
        next_action: 'Re-run; if it persists, capture this message with the run record.',
      };
    }
  },
};

function acknowledgementsOf(ctx: VerbContext): string[] {
  const raw = ctx.options.acknowledge;
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  return [];
}

async function homeOf(ctx: VerbContext): Promise<string> {
  const result = await ctx.exec('node', ['-e', 'process.stdout.write(require("os").homedir())']);
  return result.stdout.trim();
}

async function headOf(ctx: VerbContext, repo: string): Promise<string> {
  const result = await ctx.exec('git', ['rev-parse', 'HEAD'], { cwd: repo });
  return result.code === 0 ? result.stdout.trim() : '';
}

/**
 * A stamp for the binary that CHANGES WHEN A REBUILD CHANGES BEHAVIOUR.
 *
 * MEASURED. `bin/harness.js` is a thin launcher whose mtime sat at 2026-08-07 while
 * the program it loads was rebuilt four times in one evening — so stat-ing the named
 * binary alone would have watched the one file a rebuild does not touch, and the
 * mid-run-rebuild gate would never have fired. The stamp therefore folds in the
 * package's `dist/` entry when the launcher has one beside it.
 *
 * Returns the newest mtime of everything it could find, or null when the path is gone.
 */
async function mtimeOf(ctx: VerbContext, path: string): Promise<string | null> {
  const candidates = [path, path.replace(/\/bin\/[^/]+$/, '/dist/index.js')];
  const stamps: string[] = [];
  for (const candidate of new Set(candidates)) {
    if (!ctx.fs.exists(candidate)) continue;
    const result = await ctx.exec('node', [
      '-e',
      'process.stdout.write(require("fs").statSync(process.argv[1]).mtime.toISOString())',
      candidate,
    ]);
    if (result.code === 0 && result.stdout.trim() !== '') stamps.push(result.stdout.trim());
  }
  return stamps.length === 0 ? null : stamps.sort().at(-1) ?? null;
}

function collectCensus(
  ctx: VerbContext,
  home: string,
  agent: string,
  acknowledgements: readonly string[],
): RelayEntry[] {
  const relative = AGENT_CONFIGS[agent];
  if (relative === undefined) return [];
  return relative.flatMap((rel) => {
    const path = `${home}/${rel}`;
    const contents = ctx.fs.readText(path);
    return contents === null ? [] : censusFrom(path, contents, acknowledgements);
  });
}

/** The binary our installed entry names, extracted from the command it composed. */
function ourBinary(relays: readonly RelayEntry[]): string | null {
  const ours = relays.find((r) => r.ours);
  if (ours === undefined) return null;
  const quoted = /^"((?:[^"\\]|\\.)*)"/.exec(ours.command.trim());
  if (quoted !== null) return quoted[1].replace(/\\"/g, '"');
  return ours.command.trim().split(/\s+/)[0] ?? null;
}

async function runBegin(ctx: VerbContext): Promise<VerbResult> {
  if (ctx.fsWrite === undefined) {
    return {
      status: 'error',
      error: { code: 'E_NO_FS_WRITE', message: 'this core does not provide write capability' },
      next_action: 'Update the harness CLI (`harness update`) and re-run.',
    };
  }
  const agent = String(ctx.options.agent ?? 'cursor');
  const repo = String(ctx.options.repo ?? ctx.cwd);
  const home = await homeOf(ctx);
  const acknowledgements = acknowledgementsOf(ctx);

  const relays = collectCensus(ctx, home, agent, acknowledgements);
  const journalPath = `${home}/.harness/hooks/fires.jsonl`;
  const journal = ctx.fs.readText(journalPath);
  const lastAt = journalSince(journal, '').at(-1)?.at ?? '';
  const binaryPath = ourBinary(relays);
  const binaryMtime = binaryPath === null ? null : await mtimeOf(ctx, binaryPath);

  const record: RunRecord = {
    agent,
    repo,
    home,
    startedAt: new Date().toISOString(),
    journalCursor: lastAt,
    headBefore: await headOf(ctx, repo),
    ...(binaryPath !== null && binaryMtime !== null
      ? { binary: { path: binaryPath, mtimeBefore: binaryMtime } }
      : {}),
    acknowledgements,
  };

  ctx.fsWrite.writeText(`${repo}/${RECORD}`, `${JSON.stringify(record, null, 2)}\n`);
  ctx.fsWrite.writeText(`${repo}/${PROBE}`, PROBE_SOURCE);

  // THE CENSUS IS REPORTED, NEVER ACTED ON. A run that cannot be certified is told
  // so HERE, before the human spends their time on it — that is the entire value of
  // splitting --begin out.
  //
  // THROUGH `commitSignalRelays`, NEVER A LOCAL COPY OF THE PREDICATE. This line was
  // an inline `relays.filter(...)` for one build, and it kept reporting four relays
  // where there were two AFTER the de-duplication had been written and unit-tested —
  // because --begin was answering the question with its own private copy of the rule.
  // Two answers to one question, in the verb whose entire job is to count relays.
  const senders = commitSignalRelays(relays);
  const blocked = senders.length !== 1;

  return {
    status: blocked ? 'degraded' : 'ok',
    data: {
      phase: 'begin',
      agent,
      repo,
      record: `${repo}/${RECORD}`,
      relays,
      possibleCommitSignalRelays: senders.length,
      binary: record.binary ?? null,
      journalCursor: lastAt === '' ? '(empty journal)' : lastAt,
      prompt: promptFor(repo),
      certifiable: !blocked,
    },
    next_action: blocked
      ? `NOT CERTIFIABLE AS CONFIGURED: ${senders.length} relay(s) could send the commit signal; exactly one is required. They are named in data.relays. Decide which to disable — this tool will never edit your config — then RESTART the agent, because a config file is not the running configuration, and re-run --begin.`
      : `Paste data.prompt into ${agent}. It tells the agent to run ${PROBE} inside its own shell and leave the output in ${PROBE_OUT}. Then run \`harness validate-attribution --end --repo ${repo}\`. Do NOT rebuild the harness binary during the run.`,
  };
}

function promptFor(repo: string): string {
  return [
    'You are participating in a measurement. Follow these steps exactly and report verbatim.',
    '',
    `1. Run this FIRST, in your own shell, and paste its complete output into ${PROBE_OUT}:`,
    `     python3 ${PROBE} > ${PROBE_OUT}`,
    '   Report the output verbatim in your reply as well.',
    '',
    '2. Make a small, clearly identifiable code change and COMMIT it.',
    '   Report the shell command you used VERBATIM, including any && chaining.',
    '',
    `3. Write ${GROUND_TRUTH} listing the lines YOU personally wrote, as:`,
    '     [{"path": "some-file.md", "lines": "1-3"}]',
    '   This is the ground truth the note is scored against. Write it from what you',
    '   actually did, not from anything you read afterwards.',
    '',
    'DO NOT, under any circumstances:',
    '  - run or configure git-ai, harness, telemetry or notes commands',
    '  - set or unset any environment variable',
    '  - "fix" anything that looks broken — a refusal IS the measurement, report it verbatim',
    '',
    'A collector is being observed. Touching it invalidates the run.',
    '',
    `Working directory: ${repo}`,
  ].join('\n');
}

async function runEnd(ctx: VerbContext): Promise<VerbResult> {
  const repo = String(ctx.options.repo ?? ctx.cwd);
  const recordText = ctx.fs.readText(`${repo}/${RECORD}`);
  if (recordText === null) {
    return {
      status: 'error',
      error: { code: 'E_NO_RUN', message: `no run record at ${repo}/${RECORD}` },
      next_action: 'Run `harness validate-attribution --begin` first.',
    };
  }
  const record = JSON.parse(recordText) as RunRecord;

  const relays = collectCensus(ctx, record.home, record.agent, record.acknowledgements);
  const journal = journalSince(
    ctx.fs.readText(`${record.home}/.harness/hooks/fires.jsonl`),
    record.journalCursor,
  ).filter((entry) => entry.at > record.startedAt || record.journalCursor !== '');

  const sandbox = readProbe(ctx, repo);
  const groundTruth = readGroundTruth(ctx, repo);

  const headAfter = await headOf(ctx, repo);
  const note = await readNote(ctx, repo, headAfter);

  const binary =
    record.binary === undefined
      ? undefined
      : {
          path: record.binary.path,
          mtimeBefore: record.binary.mtimeBefore,
          mtimeAfter: (await mtimeOf(ctx, record.binary.path)) ?? record.binary.mtimeBefore,
        };

  const evidence: Evidence = {
    agent: record.agent,
    repo,
    ...(binary === undefined ? {} : { binary }),
    relays,
    ...(sandbox === undefined ? {} : { sandbox }),
    journal,
    ...(note === undefined ? {} : { note }),
    ...(groundTruth === undefined ? {} : { groundTruth }),
  };

  const score = scoreRun(evidence);
  return {
    // A FAIL is a real result and exits non-zero; INCONCLUSIVE is not a failure of
    // the machine, so it degrades rather than errors. Neither is silent.
    status: score.verdict === 'PASS' ? 'ok' : score.verdict === 'FAIL' ? 'error' : 'degraded',
    data: {
      phase: 'end',
      verdict: score.verdict,
      because: score.because,
      findings: score.findings,
      headBefore: record.headBefore,
      headAfter,
      evidence,
    },
    ...(score.verdict === 'FAIL'
      ? { error: { code: 'E_ATTRIBUTION_LOST', message: score.because } }
      : {}),
    next_action: score.next_action,
  };
}

function readProbe(ctx: VerbContext, repo: string): SandboxProbe | undefined {
  const text = ctx.fs.readText(`${repo}/${PROBE_OUT}`);
  if (text === null) return undefined;
  try {
    const parsed = JSON.parse(text) as Partial<SandboxProbe>;
    const state = (value: unknown): 'refused' | 'connected' | 'unknown' =>
      value === 'refused' || value === 'connected' ? value : 'unknown';
    return {
      context: 'shell',
      control: state(parsed.control),
      trace2: state(parsed.trace2),
      ...(parsed.sandboxEnv === undefined ? {} : { sandboxEnv: String(parsed.sandboxEnv) }),
    };
  } catch {
    return undefined;
  }
}

function readGroundTruth(ctx: VerbContext, repo: string): GroundTruth[] | undefined {
  const text = ctx.fs.readText(`${repo}/${GROUND_TRUTH}`);
  if (text === null) return undefined;
  try {
    const parsed = JSON.parse(text) as GroundTruth[];
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function readNote(
  ctx: VerbContext,
  repo: string,
  sha: string,
): Promise<NoteEvidence | undefined> {
  if (sha === '') return undefined;
  // `git-ai await` first: reading before the daemon has finished reports a total
  // loss that is really a race, and a total loss is the signature we are hunting.
  await ctx.exec('git-ai', ['await'], { cwd: repo, timeoutMs: 30_000 });
  const result = await ctx.exec('git', ['notes', `--ref=${NOTES_REF}`, 'show', sha], { cwd: repo });
  if (result.code !== 0) return { ref: NOTES_REF, sha, present: false, claims: [] };
  return { ref: NOTES_REF, sha, present: true, claims: parseNoteBody(result.stdout) };
}

export default extension;
