import type { Clock } from '../../../adapters/clock/clock-port.js';
import type { FsPort } from '../../../adapters/fs/fs-port.js';
import type { GitAttributionPort } from '../../../adapters/git/git-attribution-port.js';
import type { SocketRelayPort } from '../../../adapters/net/socket-probe-port.js';
import type { ProcessPort } from '../../../adapters/process/process-port.js';
import {
  knownTargetsPath,
  TRACE2_BUFFER_DIR,
  TRACE2_BUFFER_FILE,
  TRACE2_SHAS_SUFFIX,
} from '../../commit/commit-service.js';
import {
  IS_WIN32,
  isWithin,
  posixDirname,
  posixJoin,
  posixNormalize,
  resolveInRepo,
  toPosix,
} from '../../shared/posix-path.js';
import { HARNESS_DIR, TEMP_DIR } from '../../shared/temp.js';
import { type IngressReading, trace2Policy } from './ingress.js';

/**
 * `harness doctor telemetry-nudge` (plan 074 · ac-0006) — best-effort recovery
 * of buffered trace2 events.
 *
 * The mechanism is proven: `GIT_TRACE2_EVENT=<file>` buffers git's events, and
 * replaying that file's bytes into the collector's `af_unix` socket produces a
 * full, correct authorship note the daemon cannot distinguish from live traffic
 * (dossier F-07, and re-confirmed by this plan's own tk-000b spike against a
 * live daemon: 3/3 buffered commits recovered).
 *
 * ## The segment lifecycle, and why each step is shaped this way
 *
 * 1. **ROTATE FIRST.** The live buffer is `rename`d to a timestamped segment
 *    before a single byte is read. This is not tidiness — it is the only way an
 *    appender can never race a truncation. The prototype truncated after a
 *    successful flush, which loses any event a concurrent `git` wrote during the
 *    replay. A rename is atomic; a concurrent `git` holding the old handle keeps
 *    writing to the (now-detached) inode, and a new `git` creates a fresh buffer.
 * 2. **REPLAY THE WHOLE SEGMENT.** Not a filtered subset: the daemon reconstructs
 *    state from the event stream, so a partial replay is a corrupted story.
 * 3. **DELETE ONLY ON FULL CONFIRMATION — OF THIS REPOSITORY'S COMMITS.** The
 *    segment is removed only when every commit sha its SIDECAR names AND THIS
 *    REPOSITORY OWNS now carries a `refs/notes/ai` note. Identity comes from the
 *    sidecar and nowhere else — never from scanning the payload, which carries
 *    git's own argv and would let a `Revert <sha>` commit message enrol an
 *    unrelated historical commit in the confirmation set. A partially-confirmed
 *    segment is RETAINED INTACT — never rewritten to drop the confirmed part,
 *    because rewriting would destroy exactly the event context the unconfirmed
 *    commits need on a later retry.
 * 4. **FOREIGN COMMITS ARE HANDED OFF, NEVER ACCUSED.** A `file` trace2 target
 *    is MACHINE-GLOBAL, so one buffer collects commits from every repository on
 *    the box. Those shas are replayed (see step 2 — the daemon attributes each
 *    one in its own repo, which is correct, not a leak), but they are NOT
 *    confirmed here: `git notes` in this repo cannot resolve another repo's
 *    commit, so "still missing a note" would be a structural impossibility
 *    reported as a finding. They are reported as replayed-and-handed-off, they
 *    never appear as unattributed commits here, and they never block deletion.
 *    An entry whose origin was NEVER RECORDED is a third thing: not ours, not
 *    known-foreign, but UNPROVABLE. It takes the same arm as a segment with no
 *    sidecar at all — replayed whole, never confirmed, never accused, and the
 *    segment RETAINED and reported. Nothing about a file's LOCATION is allowed
 *    to promote it out of that arm (round 4's F009 — see `partitionByRepo`).
 * 5. **NO AUTOMATIC RE-REPLAY IN v1.** A retained segment is LISTED with an
 *    explicit retry instruction and left alone. The tk-000b spike did establish
 *    that duplicate replay is idempotent against a live daemon (notes came back
 *    byte-identical, the notes ref did not grow), but that is one observation on
 *    one daemon in one session — not enough to make an automatic, unattended
 *    re-replay loop safe across daemon restarts and multi-repo interleaving
 *    (U-3). v1 ships the conservative behaviour ac-0006 specifies; the spike
 *    result is what a future plan would build the automatic retry on.
 * 6. **EVERY RUN ENUMERATES.** Nothing carries state between invocations, so the
 *    buffer directory IS the state: each run lists `segment-*.jsonl` and reports
 *    every one still on disk with a retry pointer. A run that leaves any segment
 *    THIS REPOSITORY STILL OWES is `retained`, never `replayed` and never a
 *    healthy `skipped`.
 *
 * It NEVER fails the doctor run, and every no-op path (no buffer, no socket, a
 * non-`af_unix` target) is a graceful, honest report rather than an error.
 */

/** Timestamped segment name — sortable, and collision-safe within a second. */
export function segmentName(nowIso: string, salt: string): string {
  return `segment-${nowIso.replace(/[:.]/g, '-')}-${salt}.jsonl`;
}

/**
 * One sidecar line: a commit sha, and the repository that made it.
 *
 * `repo` is the git COMMON dir `harness commit` recorded (stable across linked
 * worktrees, and exactly the scope `refs/notes/ai` is shared over), or `null`
 * for an entry written before identity was recorded.
 */
export interface SidecarEntry {
  sha: string;
  repo: string | null;
}

/** `<sha>` or `<sha> <git-common-dir>`. Anything else is not an entry. */
const SIDECAR_LINE = /^([0-9a-f]{40})(?:[ \t]+(\S.*))?$/;

/**
 * Parse a sidecar. Deduplicated by sha — a sha named twice is one commit, and
 * the first recorded origin wins (a later untagged repeat never erases it).
 */
export function sidecarEntries(text: string | null | undefined): SidecarEntry[] {
  const found = new Map<string, SidecarEntry>();
  for (const line of (text ?? '').split('\n')) {
    const match = SIDECAR_LINE.exec(line.trim());
    const sha = match?.[1];
    if (sha === undefined) continue;
    const repo = match?.[2]?.trim();
    const existing = found.get(sha);
    if (existing === undefined) {
      found.set(sha, { sha, repo: repo === undefined || repo === '' ? null : repo });
    } else if (existing.repo === null && repo !== undefined && repo !== '') {
      found.set(sha, { sha, repo });
    }
  }
  return [...found.values()];
}

/**
 * Commit shas a buffered segment is expected to cover — read from the SIDECAR,
 * and from nothing else.
 *
 * git's trace2 stream contains **no commit sha** — verified against a live
 * daemon — because the events are emitted while the commit is still being made
 * and git-ai's daemon derives the sha itself. So `harness commit` writes the sha
 * down beside the buffer, and that file is the SOLE identity source.
 *
 * An earlier draft also scanned the payload for any 40-hex token "as a belt".
 * That was wrong, and the review caught it: the trace2 `start` event carries
 * git's own ARGV, so `git commit -m "Revert <sha>"` (or a cherry-pick, or a
 * message quoting a hash) injects the sha of an UNRELATED historical commit into
 * the confirmation set. If that older commit has no AI note — and pre-git-ai
 * commits never will — the segment can never fully confirm, so it is retained
 * forever and an innocent commit is reported as missing attribution. A scan over
 * attacker-or-author-controlled text cannot establish identity, so it does not
 * get a vote. A segment with no sidecar is `unconfirmable`, and that is an
 * honest, reportable state — never a guess.
 */
export function commitShasIn(sidecar: string | null | undefined): string[] {
  return sidecarEntries(sidecar).map((entry) => entry.sha);
}

/** Why a nudge did nothing. Each is a legitimate, reportable state — never an error. */
export type NudgeSkipReason =
  | 'no-buffer'
  | 'empty-buffer'
  | 'no-socket'
  | 'non-af-unix'
  /**
   * The transport this host's collector listens on is one the harness has no
   * replay path for — a Windows named pipe, or a win32 host generally (plan
   * 075 · ac-0004/ac-0006). Distinct from `non-af-unix`, which means "the
   * target is a FILE you can drain once you reconfigure": there is no
   * reconfiguration that makes this one work, so offering one would be the
   * misleading instruction this verb exists to stop issuing.
   */
  | 'unsupported-platform'
  | 'relay-failed'
  | 'unconfirmable'
  | 'buffer-refused'
  | 'fs-error';

export interface RetainedSegment {
  path: string;
  /** Shas from this segment that THIS REPOSITORY owns and that still carry no note. */
  stillMissing: string[];
  /** Shas from this segment that THIS REPOSITORY owns and that are now confirmed. */
  recovered: string[];
  /**
   * Shas belonging to OTHER repositories. Replayed (the daemon attributes each
   * in its own repo), never confirmed here, and never counted as missing.
   */
  handedOff: HandedOffSha[];
  /**
   * Shas whose sidecar line predates repo identity (ac-0005). Provenance is
   * UNPROVABLE, so they are never confirmed and never accused — but they do
   * keep the segment. Reported so the operator can see exactly what is stuck.
   */
  unknown: string[];
  /** Why it was kept: partly confirmed, unconfirmable, foreign, or the replay failed. */
  reason: 'partial' | 'unconfirmable' | 'relay-failed' | 'handed-off';
}

/** A commit this repository replayed but structurally cannot check. */
export interface HandedOffSha {
  sha: string;
  /**
   * The git common dir that owns it. NEVER null: an entry only reaches this arm
   * because its sidecar line NAMED another repository. An entry with no
   * recorded origin is `unknown`, not handed off (round 4's F009).
   */
  repo: string;
}

/** How one serialised `RetainedSegment` field reaches (or deliberately does not reach) the operator. */
export type RetainedFieldRendering =
  /** Legible from `detail`/`next_action`. `contract` states exactly what is guaranteed. */
  | { kind: 'text'; contract: string }
  /** Deliberately JSON-only. `because` must say why no operator has to see it. */
  | { kind: 'json-only'; because: string };

/**
 * What the JSON envelope owes the TEXT surface, field by field.
 *
 * Round 5 (F010) fixed a field that reached `retained[]` and never reached the
 * default output. Round 6 (F011) found the GUARD written for it was no better
 * than the bug: it asserted the fields that happened to exist that day, so a new
 * JSON-only field could be added and every parity test stayed green. A guard
 * that checks instances instead of the contract is the same false comfort one
 * layer up — an advertised guarantee its mechanism cannot deliver.
 *
 * So the contract is a TOTAL map over `keyof RetainedSegment`. Adding a field to
 * that interface — optional or not — fails `tsc` here until someone states its
 * disposition, and the parity test iterates THIS instead of a list of its own.
 * `harness doctor telemetry-nudge` prints only `detail` and `next_action` in its
 * default mode, so "text" always means "legible from those two strings alone".
 */
export const RETAINED_FIELD_RENDERING: Record<keyof RetainedSegment, RetainedFieldRendering> = {
  path: {
    kind: 'text',
    contract: 'Every retained path is named — the path IS the thing an operator acts on.',
  },
  stillMissing: {
    kind: 'text',
    contract:
      "While any segment still owes THIS repository a note, the text carries a `--buffer` retry instruction. The action is per-segment, never per-sha, so the shas themselves are `harness doctor`'s attribution-at-risk row to report, not this verb's.",
  },
  handedOff: {
    kind: 'text',
    contract:
      "When non-empty, the text names every owning repository — for EVERY retained segment, not just the one this run replayed. The individual foreign shas are not listed: they are another repository's to act on, and the repo name is what routes the operator there.",
  },
  unknown: {
    kind: 'text',
    contract:
      'When non-empty, the text states the UNKNOWN-provenance reason and names every sha. Nothing here can ever resolve them, so the operator needs the shas themselves to go and check the repository that made them.',
  },
  recovered: {
    kind: 'json-only',
    because:
      'A recovered sha is a RESOLVED state and owes the operator no action. This contract exists so that nothing OWED can hide; branches still count recoveries in prose where it helps, but no guarantee rides on it.',
  },
  reason: {
    kind: 'json-only',
    because:
      'The enum token is machine-facing. Every value renders its CONSEQUENCE through the fields above — the retry pointer, the legacy instruction, the hand-off, the relay failure — and the consequence is the part an operator can act on.',
  },
};

export interface NudgeOutcome {
  status: 'replayed' | 'retained' | 'skipped';
  reason?: NudgeSkipReason;
  /** The segment the live buffer was rotated into, when rotation happened. */
  segment: string | null;
  bytes: number;
  /** Shas that now carry a note and did not before. */
  recovered: string[];
  /** Shas this run's segment named that still carry no note. `retained[]` carries the rest. */
  stillMissing: string[];
  /**
   * Shas this run REPLAYED but that belong to another repository. Reported, so
   * the hand-off is visible; never confirmed here, and never accused.
   */
  handedOff: HandedOffSha[];
  /**
   * EVERY buffered segment still on disk when the run finished — this run's, plus
   * any left by an earlier one. Enumerated from the buffer directory rather than
   * remembered, because nothing carries state between invocations.
   */
  retained: RetainedSegment[];
  detail: string;
  next_action?: string;
}

export interface NudgeDeps {
  fs: Pick<
    FsPort,
    'exists' | 'readText' | 'writeText' | 'mkdirp' | 'rename' | 'deleteFile' | 'readdir'
  >;
  proc: Pick<ProcessPort, 'cwd'>;
  clock: Pick<Clock, 'nowIso'>;
  relay: SocketRelayPort;
  git: Pick<GitAttributionPort, 'hasAiNote' | 'gitCommonDir'>;
  ingress: IngressReading;
  /** Override the buffer path (the `file`-target branch of ac-0005 uses this). */
  bufferPath?: string;
  /** Disambiguates two segments rotated inside the same clock tick. */
  salt?: string;
  /** Bounded, injectable wait — a test drives the settle loop with no wall clock. */
  sleep?: (ms: number) => Promise<void>;
  /** How long to let git-ai's ASYNCHRONOUS note write settle before judging. */
  confirmTimeoutMs?: number;
  /**
   * The host platform, in `process.platform` spelling. The REAL platform guard
   * (plan 075 · ac-0006) — plan 074's non-goal claimed Windows was a
   * "platform-guarded no-op" and no such guard existed, which is the same
   * claiming-more-than-you-can-prove failure the feature exists to kill, this
   * time in the plan's own prose.
   *
   * Injected rather than read from the global inside the branch (Constitution
   * P3: pass the parameter, never patch `process.platform`), and defaulted from
   * {@link IS_WIN32} so the guard is consulted whether or not a caller supplies
   * it. The composition root passes `process.platform` explicitly.
   */
  platform?: string;
}

/**
 * git-ai writes its notes ASYNCHRONOUSLY: the daemon accepts the replayed
 * stream, then does the work. Judging confirmation the instant `send` resolves
 * therefore races it — observed live, where a commit reported `stillMissing`
 * and its note appeared about two seconds later, needlessly retaining a segment
 * that had in fact been fully recovered.
 *
 * So the nudge settles the same way `harness commit`'s verify does: poll, bounded,
 * and resolve the moment every sha confirms.
 */
export const CONFIRM_TIMEOUT_MS = 8_000;
export const CONFIRM_POLL_MS = 250;

/** Poll until every sha carries a note, or the budget runs out. Returns those still missing. */
async function settleNotes(deps: NudgeDeps, shas: readonly string[]): Promise<string[]> {
  const budget = deps.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let waited = 0;
  let missing = shas.filter((sha) => !deps.git.hasAiNote(sha));
  while (missing.length > 0 && waited < budget) {
    await sleep(CONFIRM_POLL_MS);
    waited += CONFIRM_POLL_MS;
    missing = missing.filter((sha) => !deps.git.hasAiNote(sha));
  }
  return missing;
}

function defaultBuffer(deps: NudgeDeps): string {
  const cwd = toPosix(deps.proc.cwd());
  return posixJoin(cwd, HARNESS_DIR, TEMP_DIR, TRACE2_BUFFER_DIR, TRACE2_BUFFER_FILE);
}

/** A rotated segment: `segment-<iso>-<salt>.jsonl`, beside the buffer it came from. */
export const SEGMENT_PREFIX = 'segment-';
export const SEGMENT_SUFFIX = '.jsonl';

function isSegmentName(name: string): boolean {
  return name.startsWith(SEGMENT_PREFIX) && name.endsWith(SEGMENT_SUFFIX);
}

/**
 * Resolve `--buffer` and CONTAIN it. Two jobs, both caught by the review:
 *
 * 1. **Resolve.** A relative `--buffer buffer.jsonl` used to be taken verbatim,
 *    and the segment path was then built by slicing at the last `/` — which for
 *    a bare filename is index `-1`, producing the nonsense sibling `buffer.json`
 *    and a `rename` that throws out of a verb whose whole contract is never to.
 * 2. **Contain.** This verb RENAMES and can DELETE the path it is handed, so an
 *    arbitrary absolute path is a real hazard. THREE roots are legitimate, and
 *    nothing else is:
 *
 *    - anywhere under the repo, where `harness commit` writes its own buffer;
 *    - the directory of the trace2 FILE target git is configured to write into
 *      right now;
 *    - the directory of a file target THE HARNESS ITSELF RECORDED when it
 *      buffered a commit there (`.harness/temp/trace2/known-targets`).
 *
 * The third root is round 2's F003 repair, and the shape matters. A `file`
 * target is machine-global, and the recovery `harness commit` prescribes is
 * "point `trace2.eventTarget` back at the socket FIRST, THEN drain the file" —
 * so by the time the drain runs, the live target is a socket and the old path is
 * no longer the configured one. Under the two-root rule the verb refused the
 * exact path it had just told the operator to drain. The fix is NOT "any
 * absolute path is fine now" — that would give the guard away. It is that the
 * path is authorized BECAUSE THE HARNESS WROTE IT DOWN, not because a caller
 * asked for it.
 *
 * **This is a SAFETY guard, not a provenance claim.** It answers "may this verb
 * rename/delete that path?", never "whose commits are in it?". Ownership is
 * read from the sidecar's recorded repo identity and from nothing else — a path
 * being authorized here says nothing about who wrote the events inside it (see
 * `partitionByRepo`, and round 4's F009).
 */
type BufferResolution = { ok: true; path: string } | { ok: false; detail: string };

/** Every FILE target this repository has recorded buffering into. */
function recordedTargets(deps: NudgeDeps, cwd: string): string[] {
  const text = deps.fs.readText(knownTargetsPath(cwd));
  if (text === null) return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function resolveBuffer(deps: NudgeDeps): BufferResolution {
  if (deps.bufferPath === undefined) return { ok: true, path: defaultBuffer(deps) };
  const cwd = toPosix(deps.proc.cwd());
  const resolved = posixNormalize(resolveInRepo(deps.bufferPath, cwd));
  if (isWithin(cwd, resolved)) return { ok: true, path: resolved };
  const live = deps.ingress.target;
  const authorized = [
    // DRAINABLE, not merely "has a path": a live named pipe has a path too, and
    // authorizing its directory would let this verb rename or delete beside a
    // collector ingress.
    ...(trace2Policy(live).drainable && live.kind !== 'unconfigured' ? [live.path] : []),
    ...recordedTargets(deps, cwd),
  ].map((target) => posixDirname(posixNormalize(toPosix(target))));
  if (authorized.some((dir) => isWithin(dir, resolved))) return { ok: true, path: resolved };
  return {
    ok: false,
    detail: `refusing to drain ${resolved}: it is neither inside this repository (${cwd}) nor beside a trace2 file target this repository configured or recorded buffering into. This verb RENAMES and can DELETE the file it is given, so it only ever touches paths the harness or your own git config named. Nothing was moved or sent.`,
  };
}

/**
 * Which sidecar entries THIS repository can actually confirm — THREE arms, all
 * provable, and no fourth.
 *
 * A `file` trace2 target is machine-global, so its sidecar accumulates commits
 * from every repository on the box. `git notes --ref=ai show <sha>` for another
 * repo's commit cannot resolve here — the object is not in this object store —
 * so treating those entries as "still missing a note" reports a structural
 * impossibility as a finding, retains the segment forever, and accuses unrelated
 * commits. That is round 2's cross-repo regression.
 *
 * | entry | arm |
 * |---|---|
 * | origin recorded, and it is this repo's git common dir | **own** — confirmed against `refs/notes/ai`; gates deletion |
 * | origin recorded, and it is another repo | **handed off** — replayed, delete-eligible, never accused |
 * | origin NOT recorded (or ours unreadable) | **unknown** — replayed, never confirmed, never accused, segment RETAINED |
 *
 * The third arm used to be decided by the sidecar's LOCATION, and that idea was
 * wrong twice. Round 3 (F008) killed "anywhere under the worktree is ours".
 * Round 4 (F009) killed its narrowing, "the harness's own default buffer
 * directory is ours", by simply configuring a global `trace2.eventTarget` to
 * that exact path — git accepts any absolute path, so a foreign pre-identity
 * sidecar can sit in the one directory the predicate trusted most, where it was
 * claimed, queried against a note that cannot exist here, and retained forever.
 *
 * The general lesson, and the reason this is a DELETION rather than a third
 * narrowing: **path location cannot prove provenance.** A location the harness
 * merely PREFERS is not one it can PROVE, and every rule of that shape has a
 * next counterexample. So an untagged entry is exactly as unknown as no sidecar
 * at all, and takes that same honest arm. Its segment is retained — acceptable
 * only because every run REPORTS it with the reason and an operator
 * instruction. Visible-and-stuck beats silently-wrong, and this is a
 * legacy-only path: every sidecar written since ac-0005 carries repo identity,
 * so it ages out on its own.
 */
function partitionByRepo(
  entries: readonly SidecarEntry[],
  ownRepo: string | null,
): { own: string[]; handedOff: HandedOffSha[]; unknown: string[] } {
  const own: string[] = [];
  const handedOff: HandedOffSha[] = [];
  const unknown: string[] = [];
  for (const entry of entries) {
    if (ownRepo === null || entry.repo === null) unknown.push(entry.sha);
    else if (posixNormalize(toPosix(entry.repo)) === ownRepo) own.push(entry.sha);
    else handedOff.push({ sha: entry.sha, repo: entry.repo });
  }
  return { own, handedOff, unknown };
}

/** This repository's identity, normalized once per run. Never throws. */
function ownRepoId(deps: NudgeDeps): string | null {
  try {
    const dir = deps.git.gitCommonDir();
    return dir === null ? null : posixNormalize(toPosix(dir));
  } catch {
    return null;
  }
}

/** Prose for a hand-off, naming the owning repository whenever one was recorded. */
function describeHandedOff(handedOff: readonly HandedOffSha[]): string {
  if (handedOff.length === 0) return '';
  const repos = [...new Set(handedOff.map((h) => h.repo))];
  return ` ${handedOff.length} commit(s) in it belong to ${repos.join(', ')} and were REPLAYED and handed off to the daemon — this repository cannot confirm them and does not claim them.`;
}

/**
 * The same fact for a segment this run did NOT replay — enumerated from disk, or
 * rotated and then failed to send. Deliberately makes no replay claim.
 *
 * Round 6's F011: `handedOff` is in the JSON envelope for every retained segment,
 * but only `describeHandedOff` rendered it, and only `runNudge`'s replayed
 * branches call that. An enumerated foreign segment, or one whose relay failed,
 * named its owning repositories in JSON and nowhere the operator would look.
 */
function describeForeignOwners(handedOff: readonly HandedOffSha[]): string {
  if (handedOff.length === 0) return '';
  const repos = [...new Set(handedOff.map((h) => h.repo))];
  return ` ${handedOff.length} commit(s) in it belong to ${repos.join(', ')} — this repository cannot confirm them and does not claim them.`;
}

/**
 * Prose for the legacy arm. Retaining a segment forever is only acceptable
 * while every run SAYS SO, in words that name the cause and do not accuse the
 * commits — so this string is load-bearing, not decoration.
 *
 * Round 5's F010 sharpened "every run": this prose reached `detail` only on the
 * run that did the replay. A LATER run enumerated the same segment, put its
 * `unknown` shas in the JSON envelope, and printed nothing about them — and the
 * default surface is text. So `withRemainingSegments` now renders this for every
 * unknown segment it reports, not just for the one this run rotated.
 */
function describeUnknown(unknown: readonly string[]): string {
  return `${unknown.length} commit(s) in it have UNKNOWN provenance — written before sidecars carried repo identity, so this repository can neither prove nor disprove it owns them. They were REPLAYED (the daemon attributes each in whichever repo made it), never checked against local notes, and are NOT counted as missing attribution: ${unknown.join(', ')}.`;
}

/** The operator instruction that makes an unprovable retention actionable rather than a dead end. */
function unknownNextAction(segments: readonly string[]): string {
  const sidecar =
    segments.length === 1
      ? `its \`${TRACE2_SHAS_SUFFIX}\` sidecar`
      : `each one's \`${TRACE2_SHAS_SUFFIX}\` sidecar`;
  return `Nothing here can confirm those commits automatically, and v1 adds no way to. Check \`harness doctor\`'s attribution-at-risk row in whichever repository made them, then delete ${segments.join(', ')} (and ${sidecar}) yourself. Commits made through \`harness commit\` since this release record their repository and confirm automatically, so this case ages out.`;
}

/** What a segment on disk still owes, read from its sidecar. Pure reads — never mutates. */
function inspectSegment(deps: NudgeDeps, path: string, ownRepo: string | null): RetainedSegment {
  const entries = sidecarEntries(deps.fs.readText(`${path}${TRACE2_SHAS_SUFFIX}`));
  const { own, handedOff, unknown } = partitionByRepo(entries, ownRepo);
  if (entries.length === 0) {
    return {
      path,
      stillMissing: [],
      recovered: [],
      handedOff: [],
      unknown: [],
      reason: 'unconfirmable',
    };
  }
  if (own.length === 0 && unknown.length === 0) {
    return { path, stillMissing: [], recovered: [], handedOff, unknown, reason: 'handed-off' };
  }
  // `unknown` shas are NEVER queried: there is nothing here that could prove
  // ownership, so asking `git notes` about them either fabricates a claim or
  // manufactures a finding. They keep the segment; they never accuse it.
  const stillMissing = own.filter((sha) => !deps.git.hasAiNote(sha));
  return {
    path,
    stillMissing,
    recovered: own.filter((sha) => !stillMissing.includes(sha)),
    handedOff,
    unknown,
    reason: stillMissing.length === 0 && unknown.length > 0 ? 'unconfirmable' : 'partial',
  };
}

/**
 * EVERY segment still beside the buffer, not just this run's.
 *
 * The review's F002: a segment retained by an earlier invocation was invisible
 * to every later one, because the only `retained` value was the segment the
 * current run had just rotated. A later nudge with no live buffer therefore
 * reported `no-buffer` and called that "the healthy shape" while unrecovered
 * commits sat in a file two directories away. Nothing carries state between
 * invocations, so the directory listing IS the state.
 */
function enumerateSegments(
  deps: NudgeDeps,
  buffer: string,
  ownRepo: string | null,
): RetainedSegment[] {
  const dir = posixDirname(buffer);
  return deps.fs
    .readdir(dir)
    .filter(isSegmentName)
    .sort()
    .map((name) => inspectSegment(deps, posixJoin(dir, name), ownRepo));
}

/**
 * The ONE sentence in this verb that calls a run healthy.
 *
 * Round 5's F010: it used to live inside the `no-buffer` skip's own detail, which
 * is written before anything has looked at the directory. A later enumeration-only
 * run therefore printed "this is the healthy shape" while an unconfirmable segment
 * sat two files away — the JSON knew, the text did not, and text is the default
 * surface. The claim now lives HERE, at the single site that has read the retained
 * set, and is emitted only when that set is empty. No-buffer-and-nothing-retained
 * is the only shape allowed to read healthy.
 */
const HEALTHY_NO_BUFFER =
  ' This is the healthy shape when every commit reached the collector directly.';

/**
 * Fold every remaining segment into the outcome. A run that leaves any segment
 * THIS REPOSITORY STILL OWES is `retained`, never `replayed` and never a healthy
 * `skipped` — the status is a claim about the machine's state, not about this
 * invocation's luck.
 *
 * A `handed-off` segment is listed but does NOT flip the status: it belongs to
 * another repository, this one structurally cannot confirm or clear it, and
 * reporting it as unrecovered here would be exactly the false alarm round 2
 * found. Naming it is honest; owning it is not.
 *
 * This is also the RENDERING-PARITY boundary (round 5's F010). Everything the
 * JSON envelope reports about a retained segment must reach `detail`/`next_action`
 * too, because `harness doctor telemetry-nudge` prints only those two fields in
 * its default text mode. A field that exists only in `retained[]` is invisible to
 * the operator who actually has to act on it. `RETAINED_FIELD_RENDERING` is that
 * obligation written down field by field, and it is what the parity test asserts.
 */
function withRemainingSegments(outcome: NudgeOutcome, remaining: RetainedSegment[]): NudgeOutcome {
  const known = new Map(remaining.map((r) => [r.path, r]));
  // This run's own findings are richer (they know the replay happened), so they win.
  for (const own of outcome.retained) known.set(own.path, own);
  const merged = [...known.values()].sort((a, b) => a.path.localeCompare(b.path));
  if (merged.length === 0) {
    return outcome.reason === 'no-buffer'
      ? { ...outcome, detail: `${outcome.detail}${HEALTHY_NO_BUFFER}` }
      : outcome;
  }
  const owed = merged.filter((r) => r.reason !== 'handed-off');
  const foreign = merged.filter((r) => r.reason === 'handed-off');
  const others = owed.filter((r) => r.path !== outcome.segment);
  const foreignNote =
    foreign.length === 0
      ? ''
      : ` ${foreign.length} further segment(s) on disk belong to other repositories (${foreign.map((r) => r.path).join(', ')}); they were not touched and are not this repository's to confirm.`;
  // Every unknown segment states its reason and its shas in TEXT. This run's own
  // segment already said so in `runNudge`'s detail, so it is not repeated here —
  // between the two sites, no unknown sha reaches `retained[]` unprinted.
  const unknownSegments = merged.filter((r) => r.unknown.length > 0);
  const unknownNote = unknownSegments
    .filter((r) => r.path !== outcome.segment)
    .map((r) => ` ${r.path} is RETAINED and cannot be resolved here: ${describeUnknown(r.unknown)}`)
    .join('');
  // Same rule for the hand-off (round 6's F011): the repositories a segment names
  // are in the JSON for EVERY retained segment, so they must be in the text for
  // every one too — not only for the segment this run happened to replay.
  const handoffNote = merged
    .filter((r) => r.handedOff.length > 0 && r.path !== outcome.segment)
    .map((r) => ` ${r.path}:${describeForeignOwners(r.handedOff)}`)
    .join('');
  if (owed.length === 0) {
    return {
      ...outcome,
      retained: merged,
      detail: `${outcome.detail}${foreignNote}${handoffNote}`,
    };
  }
  // Only a segment with shas THIS repository owns and cannot yet confirm is worth
  // re-running: re-nudging a purely-unknown segment replays it and retains it
  // again, forever. Pointing an operator at that loop is the same false comfort
  // F010 was about, one layer down.
  const retry = owed.find((r) => r.stillMissing.length > 0)?.path;
  const nextParts = [
    ...(retry === undefined
      ? []
      : [
          `Re-run \`harness doctor telemetry-nudge --buffer ${retry}\` (repeat for each remaining segment) from a shell that can reach the collector socket. Commits made before git-ai was installed will never gain a note and will stay listed here.`,
        ]),
    ...(unknownSegments.length === 0
      ? []
      : [unknownNextAction(unknownSegments.map((r) => r.path))]),
    ...(retry === undefined && unknownSegments.length === 0
      ? [
          `Segments with no \`harness commit\` sidecar can never be confirmed automatically; delete them yourself once \`harness doctor\`'s attribution-at-risk row is clean.`,
        ]
      : []),
  ];
  return {
    ...outcome,
    status: 'retained',
    retained: merged,
    detail:
      others.length === 0
        ? `${outcome.detail}${foreignNote}${handoffNote}${unknownNote}`
        : `${outcome.detail} ${others.length} earlier segment(s) are ALSO still on disk and unrecovered: ${others.map((r) => r.path).join(', ')}.${foreignNote}${handoffNote}${unknownNote}`,
    next_action: nextParts.join(' '),
  };
}

function skip(reason: NudgeSkipReason, detail: string, next_action?: string): NudgeOutcome {
  return {
    status: 'skipped',
    reason,
    segment: null,
    bytes: 0,
    recovered: [],
    stillMissing: [],
    handedOff: [],
    retained: [],
    detail,
    ...(next_action !== undefined && { next_action }),
  };
}

/** Never let a filesystem surprise escape a verb whose contract is to always report. */
function fsMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The platform guard's one reading of the host (plan 075 · ac-0006).
 *
 * Explicit `deps.platform` wins; otherwise the module-level {@link IS_WIN32}
 * constant, which is `process.platform === 'win32'`. Read through one function
 * so the drain path has exactly ONE place that consults the platform, and tests
 * drive it by passing a value rather than by patching a global.
 */
function isWin32(deps: NudgeDeps): boolean {
  return deps.platform === undefined ? IS_WIN32 : deps.platform === 'win32';
}

/** The host named the way an operator would say it, for the refusal text. */
function platformName(deps: NudgeDeps): string {
  return isWin32(deps) ? 'Windows (win32)' : (deps.platform ?? 'non-win32');
}

/**
 * Rotate, replay, confirm — then report every segment still on disk.
 *
 * Never throws, never fails the host command: a filesystem error is one more
 * honest reading, not an exception out of a recovery verb.
 */
export async function telemetryNudge(deps: NudgeDeps): Promise<NudgeOutcome> {
  const resolution = resolveBuffer(deps);
  if (!resolution.ok) {
    return skip(
      'buffer-refused',
      resolution.detail,
      'Pass a `--buffer` path inside this repository, or beside a trace2 file target this repository buffered into (`harness commit` records those in `.harness/temp/trace2/known-targets`).',
    );
  }
  const buffer = resolution.path;
  const ownRepo = ownRepoId(deps);
  let outcome: NudgeOutcome;
  try {
    outcome = await runNudge(deps, buffer, ownRepo);
  } catch (err) {
    outcome = skip(
      'fs-error',
      `the nudge could not complete: ${fsMessage(err)}. Any rotated segment is still on disk — nothing is deleted except on a full confirmation.`,
      'Check the permissions on the harness trace2 buffer directory, then re-run this verb.',
    );
  }
  try {
    return withRemainingSegments(outcome, enumerateSegments(deps, buffer, ownRepo));
  } catch {
    // The enumeration is a REPORT enhancement; it must never cost the outcome.
    return outcome;
  }
}

async function runNudge(
  deps: NudgeDeps,
  buffer: string,
  ownRepo: string | null,
): Promise<NudgeOutcome> {
  // ---- the graceful no-ops, checked BEFORE anything is moved ---------------
  //
  // ORDER: transport first, then platform. Both are honest on a win32 host with
  // a pipe target, and the transport statement is the MORE specific of the two
  // — it names what the collector is actually listening on, which is the fact
  // an operator can go and check.
  if (deps.ingress.target.kind === 'unconfigured') {
    return skip(
      'non-af-unix',
      'no trace2 target is configured, so there is no collector ingress to replay into — nothing was moved or sent.',
      'Install the collector with `harness doctor --install-collector`, then re-run this verb.',
    );
  }
  if (deps.ingress.target.kind === 'named_pipe') {
    // ac-0004. NOT `no-buffer` and NOT "nothing to do": there may well be a
    // buffer sitting right there. What is missing is a replay path INTO a named
    // pipe, and saying so is the whole point — an honest refusal beats a
    // misleading instruction. Nothing is renamed, nothing is deleted, nothing
    // is sent, and no reconfiguration is offered, because none would help.
    const pipe = deps.ingress.target.path;
    return skip(
      'unsupported-platform',
      `the configured trace2 target is a Windows NAMED PIPE (${pipe}) on a ${platformName(deps)} host — a LIVE collector ingress, not a drainable buffer. This verb replays into an af_unix socket, git on Windows has no af_unix trace2 target, and no replay path for the named-pipe transport has been established. NOTHING was moved, deleted or sent, and any buffered events are exactly where they were.`,
      'Nothing here is recoverable by this verb. Commit from a host where the collector ingress is an af_unix socket, or treat this host as unproven for attribution recovery — do not re-run expecting a different answer.',
    );
  }
  if (isWin32(deps)) {
    // The guard plan 074 CLAIMED. Replay needs an af_unix socket; git on
    // Windows cannot produce one, so every path past here is unreachable by
    // construction. Refusing early and by name makes the no-op deliberate
    // rather than accidental — and keeps a mutating verb from touching a
    // filesystem on a platform whose transport nobody has measured.
    return skip(
      'unsupported-platform',
      `this is a ${platformName(deps)} host: git on Windows has no af_unix trace2 target, so there is no ingress this verb can replay into, and the transport git-ai listens on here has not been established. NOTHING was moved, deleted or sent.`,
      'Run this verb from a POSIX host (macOS or Linux) where the collector ingress is an af_unix socket. Buffered events on this host stay on disk, untouched.',
    );
  }
  if (!trace2Policy(deps.ingress.target).replayInto) {
    // The FILE target today, and — by construction — any future kind the
    // compiler forces to declare `replayInto: false`. The description comes
    // from the kind table rather than being re-asserted here, so a new
    // transport cannot inherit the word "file" by accident.
    const path = deps.ingress.target.path;
    return skip(
      'non-af-unix',
      `the configured trace2 target ${trace2Policy(deps.ingress.target).describe(path)}, not an af_unix socket — there is no ingress to replay into, and this verb cannot invent one. Nothing was moved or sent.`,
      `FIRST point \`trace2.eventTarget\` back at the git-ai socket (\`harness doctor --install-collector\`) — until then there is nowhere to replay to — THEN re-run \`harness doctor telemetry-nudge --buffer ${path}\` to drain the file.`,
    );
  }
  const socket = deps.ingress.target.path;
  if (deps.ingress.outcome !== 'connected') {
    return skip(
      'no-socket',
      `the collector ingress at ${socket} is not reachable from here (probe: ${deps.ingress.outcome ?? 'not probed'}) — replaying now would lose the buffer for nothing, so NOTHING was moved or sent.`,
      'Re-run this verb from an UNSANDBOXED shell (and check the git-ai daemon is running with `harness doctor`). The buffer is intact and waiting.',
    );
  }

  if (!deps.fs.exists(buffer)) {
    return skip('no-buffer', `no buffered trace2 events at ${buffer} — nothing to replay.`);
  }
  const payload = deps.fs.readText(buffer);
  if (payload === null || payload.trim() === '') {
    return skip('empty-buffer', `the buffer at ${buffer} is empty — nothing to replay.`);
  }

  // ---- ROTATE FIRST: appenders can never race a truncation ----------------
  const segment = posixJoin(
    posixDirname(buffer),
    segmentName(deps.clock.nowIso(), deps.salt ?? 'a'),
  );
  const bufferSidecar = `${buffer}${TRACE2_SHAS_SUFFIX}`;
  const sidecarText = deps.fs.exists(bufferSidecar) ? deps.fs.readText(bufferSidecar) : null;
  try {
    deps.fs.rename(buffer, segment);
  } catch (err) {
    return skip(
      'fs-error',
      `could not rotate ${buffer} to ${segment} (${fsMessage(err)}) — NOTHING was moved or sent, and the buffer is intact.`,
      'Check the permissions on that directory, then re-run this verb.',
    );
  }
  // The sidecar travels WITH its segment. Leaving it on the live buffer would
  // attribute this segment's commits to the next one. A failure here is not
  // fatal — the shas are already in memory for this run's confirmation — but the
  // segment then has no sidecar of its own, so a LATER run reads it as
  // unconfirmable rather than silently mis-attributing it.
  const segmentSidecar = `${segment}${TRACE2_SHAS_SUFFIX}`;
  let sidecarMoved = false;
  if (sidecarText !== null) {
    try {
      deps.fs.rename(bufferSidecar, segmentSidecar);
      sidecarMoved = true;
    } catch {
      sidecarMoved = false;
    }
  }

  const entries = sidecarEntries(sidecarText);
  const { own, handedOff, unknown } = partitionByRepo(entries, ownRepo);
  // Only shas that were MISSING before the replay can be "recovered" by it.
  // `unknown` shas are never queried at all — see `partitionByRepo`.
  const before = own.filter((sha) => !deps.git.hasAiNote(sha));

  const sent = await deps.relay.send(socket, payload);
  if (!sent.ok) {
    // The segment stays exactly where it is. A failed send must never cost the
    // buffer — that is the whole reason rotation precedes deletion.
    return {
      status: 'retained',
      reason: 'relay-failed',
      segment,
      bytes: 0,
      recovered: [],
      stillMissing: before,
      handedOff,
      retained: [
        {
          path: segment,
          stillMissing: before,
          recovered: [],
          handedOff,
          unknown,
          reason: 'relay-failed',
        },
      ],
      detail: `the replay into ${socket} failed (${sent.outcome}). The rotated segment is RETAINED INTACT at ${segment} — nothing was lost.${describeForeignOwners(handedOff)}${unknown.length === 0 ? '' : ` ${describeUnknown(unknown)}`}`,
      next_action: `Fix the ingress (see \`harness doctor\`), then re-run \`harness doctor telemetry-nudge --buffer ${segment}\` to retry this segment.`,
    };
  }

  if (entries.length === 0) {
    // The replay was ACCEPTED, but nothing about it can be confirmed: no commit
    // was recorded for this buffer (it was not produced by `harness commit`, so
    // no sidecar exists, and git's own events name no sha). Deleting here would
    // be a delete on a vacuous confirmation — "every named sha has a note" is
    // trivially true of an empty set, which is exactly the confident wrong
    // answer this plan exists to kill. So it is kept, and said plainly.
    return {
      status: 'retained',
      reason: 'unconfirmable',
      segment,
      bytes: sent.bytes,
      recovered: [],
      stillMissing: [],
      handedOff: [],
      retained: [
        {
          path: segment,
          stillMissing: [],
          recovered: [],
          handedOff: [],
          unknown: [],
          reason: 'unconfirmable',
        },
      ],
      detail: `replayed ${sent.bytes} bytes into ${socket}, but delivery could NOT be confirmed: this buffer records no commit sha (git's trace2 events never name one, and no \`harness commit\` sidecar was found beside it). The segment is RETAINED INTACT at ${segment} rather than deleted on an unprovable claim.`,
      next_action: `Check \`harness doctor\`'s attribution-at-risk row to see whether the commits gained notes; delete ${segment} yourself once you are satisfied. Commits made through \`harness commit\` record their sha and confirm automatically.`,
    };
  }

  const deleteSegment = (): void => {
    // A delete that fails is not an error — the enumeration pass will find the
    // survivor and report it, which is strictly more honest than throwing.
    try {
      deps.fs.deleteFile(segment);
      if (sidecarMoved) deps.fs.deleteFile(segmentSidecar);
    } catch {
      /* reported by the enumeration pass */
    }
  };

  if (own.length === 0 && unknown.length === 0) {
    // Every commit this segment names belongs to ANOTHER repository, and every
    // one of them SAID SO — the shape a machine-global `file` target produces.
    // The replay was accepted, and the daemon attributes each of those commits
    // in its own repo, so the hand-off is complete from here. Deleting is NOT
    // the vacuous confirmation the no-sidecar branch above refuses: there,
    // identity was unknown; here it is known precisely, and known not to be
    // ours. Retaining instead would let foreign entries block deletion forever
    // and make every later run in this repo report an unrecoverable segment it
    // structurally cannot clear. An UNKNOWN entry is excluded from this branch
    // on purpose (round 4's F009): "not provably mine" is not "provably not
    // mine", and only the second one may delete.
    deleteSegment();
    return {
      status: 'replayed',
      segment,
      bytes: sent.bytes,
      recovered: [],
      stillMissing: [],
      handedOff,
      retained: [],
      detail: `replayed ${sent.bytes} bytes into ${socket}. No commit in this segment belongs to this repository, so there is nothing for it to confirm.${describeHandedOff(handedOff)} The segment was deleted.`,
    };
  }

  const stillMissing = await settleNotes(deps, before);
  const recovered = before.filter((sha) => !stillMissing.includes(sha));

  if (stillMissing.length === 0 && unknown.length === 0) {
    // FULLY confirmed: every commit this segment named AND THIS REPOSITORY OWNS
    // now carries a note, and nothing in it is of unknown provenance. Foreign
    // entries never gate this — they cannot be checked here at all, so waiting
    // on them would be waiting forever.
    deleteSegment();
    return {
      status: 'replayed',
      segment,
      bytes: sent.bytes,
      recovered,
      stillMissing: [],
      handedOff,
      retained: [],
      detail:
        (before.length === 0
          ? `replayed ${sent.bytes} bytes into ${socket}. All ${own.length} commit(s) this segment names for this repository already carried a refs/notes/ai entry, so it was deleted.`
          : `replayed ${sent.bytes} bytes into ${socket} and CONFIRMED all ${recovered.length} commit(s) it named for this repository now carry a refs/notes/ai entry — the segment was deleted.`) +
        describeHandedOff(handedOff),
    };
  }

  if (stillMissing.length === 0) {
    // LEGACY: nothing here is unconfirmed except entries whose sidecar lines
    // predate repo identity, so this repository cannot prove it owns them and
    // will not query, claim, or accuse them. The segment is kept rather than
    // deleted on a location guess (round 4's F009), and the operator is told
    // exactly why and what to do — visible-and-stuck beats silently-wrong.
    return {
      status: 'retained',
      reason: 'unconfirmable',
      segment,
      bytes: sent.bytes,
      recovered,
      stillMissing: [],
      handedOff,
      retained: [
        { path: segment, stillMissing: [], recovered, handedOff, unknown, reason: 'unconfirmable' },
      ],
      detail: `replayed ${sent.bytes} bytes into ${socket}. The segment is RETAINED INTACT at ${segment}: ${describeUnknown(unknown)}${describeHandedOff(handedOff)}`,
      next_action: unknownNextAction([segment]),
    };
  }

  // PARTIAL: keep the segment whole. Never rewrite it to drop the confirmed
  // part — the unconfirmed commits need that event context on a retry.
  return {
    status: 'retained',
    segment,
    bytes: sent.bytes,
    recovered,
    stillMissing,
    handedOff,
    retained: [{ path: segment, stillMissing, recovered, handedOff, unknown, reason: 'partial' }],
    detail: `replayed ${sent.bytes} bytes into ${socket}: ${recovered.length} commit(s) recovered, ${stillMissing.length} still missing a note. The segment is RETAINED INTACT at ${segment} (it is never partially rewritten), and v1 does NOT automatically re-replay it.${describeHandedOff(handedOff)}${unknown.length === 0 ? '' : ` ${describeUnknown(unknown)}`}`,
    next_action: `Re-run \`harness doctor telemetry-nudge --buffer ${segment}\` to retry this segment explicitly. Commits made before git-ai was installed will never gain a note and will stay listed here.${unknown.length === 0 ? '' : ` ${unknownNextAction([segment])}`}`,
  };
}
