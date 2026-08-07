import type { FsPort } from '../../adapters/fs/fs-port.js';
import type { CommitMode } from '../commit/commit-service.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';

/**
 * COMMIT GUIDANCE (plan 074 · ac-0008) — the durable answer to "how do I commit
 * without silently losing attribution?", shipped INSIDE the CLI at two seams so
 * it reaches an agent whether it reads briefings or reads `AGENTS.md`.
 *
 * The guidance is careful about what it promises, because overclaiming here
 * would recreate the exact failure the plan exists to kill. A `harness commit`
 * is **verified or named**: either a note landed and it says so, or the events
 * were buffered and it names both the buffer and the command that drains it, or
 * it states plainly that attribution could not be verified on this platform. It
 * is NOT a guarantee of delivery — nothing can promise that, since a blocked
 * ingress is blocked. What it guarantees is that the outcome is never SILENT.
 *
 * A chained or compound `git commit` gets no such guarantee: it is precisely the
 * command shape that falls into an agent sandbox (dossier F-04), and when it
 * does, the commit lands unattributed and git-ai's recovery ladder may later
 * attest those lines as known-human (F-03).
 */

/**
 * What a reader does about an outcome — a DISCRIMINATED disposition, not prose.
 *
 * The nudge disposition is data because getting it wrong *is* the plan-076
 * defect: the pre-075 block sent every reader to `harness doctor telemetry-nudge`,
 * and that verb refuses on a Windows named pipe. Review F002 then found the
 * disposition was declared but never rendered — a guard-shaped datum free to
 * disagree with the prose beside it, which is the same false comfort one layer
 * up. So the renderer OWNS every mention of the verb and derives the instruction
 * from this union; no authored string here may name it (pinned by test).
 */
export type CommitRecovery =
  | {
      readonly nudge: 'drains-this';
      /** What the reader must know before draining. Never names the verb. */
      readonly before: string;
    }
  | {
      readonly nudge: 'not-the-remedy';
      /** What to do instead. */
      readonly instead: string;
      /** Why the nudge is not it — rendered after "Do NOT run … —". */
      readonly because: string;
    }
  | {
      /**
       * The nudge is neither the remedy nor a hazard worth warning against.
       *
       * A real distinction, not a hedge: `direct-verified` buffers nothing, so
       * there is nothing to drain — but on a verify MISS `harness commit`'s own
       * `next_action` names the nudge (commit-service.ts). Rendering a blanket
       * "Do NOT run" here would contradict the shipped command, which is the
       * exact defect class this plan exists to remove. So this arm says what to
       * do and stays silent about the verb.
       */
      readonly nudge: 'not-applicable';
      readonly instead: string;
    };

/** What one reader-facing commit outcome promises, and what to do about it. */
export interface CommitOutcome {
  /** The outcome's name in the guidance's own vocabulary. */
  readonly label: string;
  /** What `harness commit` actually did and actually claims. Never more. */
  readonly promise: string;
  /** How the reader recovers — rendered by {@link renderRecovery}, never by hand. */
  readonly recovery: CommitRecovery;
}

/**
 * The recovery verb. Named ONCE, here, so every mention in the guidance —
 * the outcome list, the standalone recovery block, both surfaces — is
 * interpolated from this constant rather than typed out again. Review R2-F001
 * caught the one place that had not been: a hand-written paragraph is exactly
 * how a "sole writer" claim becomes aspirational.
 */
const NUDGE_VERB = 'harness doctor telemetry-nudge';

/**
 * The prerequisite every drainable outcome carries — stated UNCONDITIONALLY,
 * on every platform, for a reason that is easy to get wrong (review F001).
 *
 * `runNudge()` refuses on any win32 host (`nudge.ts`, the `isWin32` guard) before
 * it reaches a single replay path, so a Windows reader of a `file-buffered` or
 * `harness-buffered` commit was being handed a recovery command that drains
 * nothing. The fix is NOT platform detection: this text is committed into an
 * `AGENTS.md` that any OS may check out, so the machine that RENDERS it is not
 * the machine that READS it. A renderer that branched on `process.platform`
 * would bake one host's answer into a file read on another. Stating the
 * prerequisite is correct on every host, including the one it was written on.
 */
export const NUDGE_PREREQUISITE = `Recovery is POSIX-ONLY: the drain replays into an af_unix socket, so on a Windows host \`${NUDGE_VERB}\` refuses on platform grounds and drains nothing — the buffered events stay on disk, untouched, until they are drained from a host whose collector ingress is an af_unix socket.`;

/**
 * Turn a disposition into the reader's instruction — the only writer of the
 * outcome list's recovery text. (The standalone {@link RECOVERY_SECTION} is the
 * other place the verb appears; it interpolates {@link NUDGE_VERB} and carries
 * {@link NUDGE_PREREQUISITE} too, so neither can state the verb's behaviour
 * without its precondition.)
 */
export function renderRecovery(recovery: CommitRecovery): string {
  switch (recovery.nudge) {
    case 'drains-this':
      return `${recovery.before} Drain it with \`${NUDGE_VERB}\` from an UNSANDBOXED shell. ${NUDGE_PREREQUISITE}`;
    case 'not-the-remedy':
      return `${recovery.instead} Do NOT run \`${NUDGE_VERB}\` — ${recovery.because}.`;
    case 'not-applicable':
      return recovery.instead;
  }
}

/**
 * The outcomes an agent can actually receive, in the order the guidance tells
 * them. Modes collapse ONTO these — see {@link COMMIT_OUTCOME_GUIDANCE}.
 *
 * Separating outcome from mode is what makes the collapse honest: two modes that
 * share a prose outcome share the SAME promise and recovery object, so the
 * collapse cannot hide a difference in what is promised. A mode whose promise
 * genuinely differs cannot be folded in — it needs an outcome of its own.
 */
export const COMMIT_OUTCOMES = {
  verified: {
    label: 'confirmed',
    promise:
      'harness commits with no trace2 override, waits (bounded) for the `refs/notes/ai` note, and tells you whether it landed.',
    recovery: {
      nudge: 'not-applicable',
      instead:
        "A landed note is the healthy shape, and a miss is reported to you rather than hidden — with the next step named in the command's own output. Nothing was buffered on this path, so there is nothing to drain.",
    },
  },
  buffered: {
    label: 'buffered and named',
    promise:
      "the commit is made with its trace2 events going to a buffer file instead of the collector, so attribution is DEFERRED, not lost — and it isn't proven yet either.",
    recovery: {
      nudge: 'drains-this',
      before:
        '`harness commit` names the buffer it used; when the configured target is a plain FILE it must be pointed back at the socket first, because while it names a file there is no ingress to replay into.',
    },
  },
  unverified: {
    label: 'NOT VERIFIED on this platform',
    promise:
      'the commit is made with no trace2 override (git talks to the pipe as usual), nothing was buffered, nothing was written beside the pipe — and nothing is claimed about attribution, because nothing was measured.',
    recovery: {
      nudge: 'not-the-remedy',
      instead: 'Check for yourself with `git notes --ref=ai show HEAD`.',
      because:
        'there is no buffer to drain and no replay path for the named-pipe transport, and it will refuse',
    },
  },
} as const satisfies Record<string, CommitOutcome>;

export type CommitOutcomeId = keyof typeof COMMIT_OUTCOMES;

/** How one `CommitMode` reaches the reader: which outcome, and what selected it. */
export interface CommitOutcomeGuidance {
  /**
   * The outcome this mode produces. Two modes MAY name the same outcome — the
   * collapse is DECLARED here and never inferred from prose similarity (ac-0004).
   */
  readonly outcome: CommitOutcomeId;
  /** The condition that selects this mode, in the reader's terms. */
  readonly when: string;
}

/**
 * The EXHAUSTIVE mode table (plan 076 · ac-0002) — the ONLY declaration of what
 * each commit outcome promises, and the third application of the house pattern
 * already proven by `TRACE2_TARGET_POLICY` (ingress.ts) and
 * `RETAINED_FIELD_RENDERING` (nudge.ts).
 *
 * `satisfies Record<CommitMode, …>` is the guard. Add an arm to {@link CommitMode}
 * and `tsc` refuses this object until the new mode declares which outcome it
 * gives the reader and what selects it — which is exactly the question that went
 * unanswered when plan 075 added `ingress-unverified` and the managed block kept
 * promising two outcomes. This is DL-007: a guarantee about FUTURE code needs the
 * type system, not a test. It lives in `src` because the typecheck `include` is
 * `["src"]` — the same contract in a test file compiles nowhere CI looks (F011).
 *
 * Both guidance surfaces render their outcome list from here, so there is no
 * second hand-maintained copy left to drift.
 */
export const COMMIT_OUTCOME_GUIDANCE = {
  'direct-verified': {
    outcome: 'verified',
    when: 'the collector ingress socket is reachable',
  },
  'file-buffered': {
    outcome: 'buffered',
    when: "git's configured trace2 target is a plain FILE",
  },
  'harness-buffered': {
    outcome: 'buffered',
    when: 'the ingress is blocked, absent or unconfigured',
  },
  'ingress-unverified': {
    outcome: 'unverified',
    when: 'trace2 points at a Windows NAMED PIPE (\\\\.\\pipe\\…)',
  },
} as const satisfies Record<CommitMode, CommitOutcomeGuidance>;

/**
 * Render the outcome list ONCE, for both surfaces.
 *
 * Modes are walked in table order and grouped by the outcome they declare, so a
 * collapsed outcome states every condition that reaches it rather than silently
 * describing one mode and implying the other. One renderer, one output, used
 * verbatim in both places — the strongest available anti-drift shape, and the
 * reason neither surface can be updated without the other.
 */
export function commitOutcomeLines(): string {
  const order: CommitOutcomeId[] = [];
  const whens = new Map<CommitOutcomeId, string[]>();
  for (const mode of Object.keys(COMMIT_OUTCOME_GUIDANCE) as CommitMode[]) {
    const { outcome, when } = COMMIT_OUTCOME_GUIDANCE[mode];
    if (!whens.has(outcome)) {
      order.push(outcome);
      whens.set(outcome, []);
    }
    whens.get(outcome)?.push(when);
  }
  return order
    .map((id) => {
      const { label, promise, recovery } = COMMIT_OUTCOMES[id];
      const condition = (whens.get(id) ?? []).join(', or when ');
      return `- **${label}** — when ${condition}: ${promise} ${renderRecovery(recovery)}`;
    })
    .join('\n');
}

/**
 * The STANDALONE recovery instruction — derived, never re-typed (review R2-F001).
 *
 * Round 2 made `renderRecovery()` the sole writer of the verb's instruction *in
 * the outcome list*, and this paragraph quietly falsified that claim: it named
 * the verb by hand and asserted that it "rotates the buffer" and "replays that
 * segment", both of which a win32 host returns before ever doing. Proximity to a
 * correct outcome list does not make an independent command recipe truthful — a
 * reader can act on this block alone, so the prerequisite has to travel WITH it.
 */
const RECOVERY_SECTION = `    ${NUDGE_VERB}

RECOVERY, on a POSIX host. Run it from an UNSANDBOXED shell: it rotates the
buffer to a segment, replays that segment into the collector, and deletes the
segment only when every commit it named carries a note. A partly-confirmed
segment is kept intact and listed for an explicit retry.

${NUDGE_PREREQUISITE}`;
export const COMMIT_INSTRUCTIONS = `# harness commit — the safe commit path

You are an agent committing work in a repository where git-ai collects AI
attribution. Read this before you commit.

## Why this verb exists

git-ai has exactly ONE ingress: git's trace2 events over a unix socket. Agent
command sandboxes block that socket. When they do, git SILENTLY disables trace2,
your commit lands with no authorship note, and git-ai's recovery ladder can
later attest those lines as **known-human** — a confident wrong number, not a
gap, and invisible to every other health signal.

Which commands get sandboxed is command-SHAPE dependent and varies between
sessions, so no editor configuration fixes it reliably. The commit path has to
be the thing that tells the truth.

## The two safe shapes

    harness commit "<message>" -- <path> [<path>…]

VERIFIED OR NAMED. It probes the ingress first, then takes exactly one of these
paths and TELLS YOU which one it took:

${commitOutcomeLines()}

It never rolls back, never blocks your commit, and never swallows git's exit
code. Staging is EXPLICIT pathspecs only — nothing is swept in for you.

${RECOVERY_SECTION}

## The shape to avoid

    git add … && git commit -m "…"        # compound -> sandboxed -> attribution lost
    bash -c "git commit -m \\"$(…)\\""        # ditto

Chained and compound git commits can silently lose attribution. Nothing warns
you; the commit looks completely healthy.

## What is and is not guaranteed

- **Guaranteed**: a \`harness commit\` is never SILENT about attribution. It
  reports which of the outcomes above it took, and never claims a delivery it
  has not measured.
- **NOT guaranteed**: delivery. A blocked ingress is blocked. Buffered events
  reach the collector only when the nudge is run from somewhere that can reach
  the socket, and commits made before git-ai was installed will never gain a
  note.
- **NOT supported on Windows**: replay. git's \`af_unix\` trace2 target is
  Unix-only, so \`telemetry-nudge\` has no ingress to replay into and refuses on
  a win32 host without touching a single file. Attribution there is unproven,
  not recoverable — see docs/how/gitai-collector.md § Windows.

Check the current state any time with \`harness doctor\` — the
\`gitai-collector\` and \`attribution-at-risk\` rows report the ingress verdict
and any commits with no authorship record. Both are READ-ONLY: they name the
recovery command, they never run it.
`;

/**
 * Core instruction pages — verbs whose briefing ships in the CLI rather than
 * beside an extension (ac-0008 seam 1).
 *
 * The instructions surface previously resolved ONLY extension-registry verbs, so
 * a core verb had no way to carry a briefing at all. This registry is the
 * additive fix: the resolver checks core pages first, and everything else about
 * the surface is untouched.
 */
export const CORE_INSTRUCTION_PAGES: Readonly<Record<string, string>> = Object.freeze({
  commit: COMMIT_INSTRUCTIONS,
});

/** The fenced markers that delimit the managed block. Idempotency hangs off these. */
export const AGENTS_BLOCK_BEGIN = '<!-- BEGIN harness:commit-guidance -->';
export const AGENTS_BLOCK_END = '<!-- END harness:commit-guidance -->';

/**
 * The managed block's body — the same outcome contract the instructions page
 * states, rendered from the SAME table (plan 076 · ac-0003). There is no second
 * hand-maintained enumeration here to drift out of step with the code.
 */
export function commitGuidanceBlock(): string {
  return `${AGENTS_BLOCK_BEGIN}
## Committing in this repo

Use \`harness commit "<message>" -- <paths>\` rather than a chained
\`git add … && git commit …\`.

A \`harness commit\` is **verified or named**: it probes the collector ingress,
commits, and then tells you WHICH outcome you got. It never blocks and never
rolls back. The outcomes are:

${commitOutcomeLines()}

A chained or compound \`git commit\` can **silently lose attribution** — agent
command sandboxes block git-ai's socket, git quietly disables trace2, and the
commit's authorship may later be recorded as human.

Neither shape guarantees delivery. What \`harness commit\` guarantees is that the
outcome is never silent. Read \`harness instructions commit\` for the detail.
${AGENTS_BLOCK_END}`;
}

/** The agent-context file the block is managed in. */
export const AGENTS_FILE = 'AGENTS.md';

export type AgentsBlockState = 'absent' | 'current' | 'stale' | 'no-file';

export interface AgentsBlockDeps {
  fs: Pick<FsPort, 'exists' | 'readText' | 'writeText'>;
  cwd: string;
}

function agentsPath(deps: AgentsBlockDeps): string {
  return posixJoin(toPosix(deps.cwd), AGENTS_FILE);
}

/**
 * Read-only inspection of the managed block. Used by doctor, which WARNS when
 * the block is absent and NEVER edits the file (ac-0008) — the guidance is the
 * user's own agent-context surface, and silently rewriting it would be exactly
 * the kind of unasked-for mutation a diagnostic must not perform.
 */
export function readAgentsBlock(deps: AgentsBlockDeps): AgentsBlockState {
  const path = agentsPath(deps);
  if (!deps.fs.exists(path)) return 'no-file';
  const text = deps.fs.readText(path);
  if (text === null) return 'no-file';
  const start = text.indexOf(AGENTS_BLOCK_BEGIN);
  const end = text.indexOf(AGENTS_BLOCK_END);
  if (start === -1 || end === -1 || end < start) return 'absent';
  const existing = text.slice(start, end + AGENTS_BLOCK_END.length);
  return existing === commitGuidanceBlock() ? 'current' : 'stale';
}

export type InjectOutcome =
  | { ok: true; path: string; action: 'created' | 'inserted' | 'refreshed' | 'unchanged' }
  | { ok: false; path: string; reason: 'unreadable' };

/**
 * Inject or refresh the managed block — IDEMPOTENT, and only ever run when
 * explicitly invoked (`harness instructions commit --inject`, which the adopt
 * flow's guidance step calls with the user's consent).
 *
 * Idempotency is structural, not best-effort: the markers delimit exactly the
 * region this function owns, so a refresh replaces that region byte-for-byte and
 * touches nothing else in the file. Running it twice changes nothing the second
 * time, and a user's own edits outside the markers are never at risk.
 */
export function injectAgentsBlock(deps: AgentsBlockDeps): InjectOutcome {
  const path = agentsPath(deps);
  const block = commitGuidanceBlock();
  if (!deps.fs.exists(path)) {
    deps.fs.writeText(path, `${block}\n`);
    return { ok: true, path, action: 'created' };
  }
  const text = deps.fs.readText(path);
  if (text === null) return { ok: false, path, reason: 'unreadable' };
  const start = text.indexOf(AGENTS_BLOCK_BEGIN);
  const end = text.indexOf(AGENTS_BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    const separator = text.endsWith('\n') ? '\n' : '\n\n';
    deps.fs.writeText(path, `${text}${separator}${block}\n`);
    return { ok: true, path, action: 'inserted' };
  }
  const head = text.slice(0, start);
  const tail = text.slice(end + AGENTS_BLOCK_END.length);
  const next = `${head}${block}${tail}`;
  if (next === text) return { ok: true, path, action: 'unchanged' };
  deps.fs.writeText(path, next);
  return { ok: true, path, action: 'refreshed' };
}
