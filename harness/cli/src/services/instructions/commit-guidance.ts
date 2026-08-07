import type { FsPort } from '../../adapters/fs/fs-port.js';
import { posixJoin, toPosix } from '../shared/posix-path.js';

/**
 * COMMIT GUIDANCE (plan 074 · ac-0008) — the durable answer to "how do I commit
 * without silently losing attribution?", shipped INSIDE the CLI at two seams so
 * it reaches an agent whether it reads briefings or reads `AGENTS.md`.
 *
 * The guidance is careful about what it promises, because overclaiming here
 * would recreate the exact failure the plan exists to kill. A `harness commit`
 * is **verified or named**: either a note landed and it says so, or the events
 * were buffered and it names both the buffer and the command that drains it. It
 * is NOT a guarantee of delivery — nothing can promise that, since a blocked
 * ingress is blocked. What it guarantees is that the outcome is never SILENT.
 *
 * A chained or compound `git commit` gets no such guarantee: it is precisely the
 * command shape that falls into an agent sandbox (dossier F-04), and when it
 * does, the commit lands unattributed and git-ai's recovery ladder may later
 * attest those lines as known-human (F-03).
 */

/** The instructions page `harness instructions commit` resolves (ac-0008 seam 1). */
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

  VERIFIED OR NAMED. It probes the ingress first, then takes one of two paths:

  - ingress reachable -> commits with no trace2 override, then waits (bounded)
    for the refs/notes/ai note and TELLS YOU whether it landed.
  - ingress blocked / absent / unconfigured -> commits with trace2 buffered to a
    file under the gitignored .harness/temp/, and names both that buffer and the
    command that drains it.

  It never rolls back, never blocks your commit, and never swallows git's exit
  code. Staging is EXPLICIT pathspecs only — nothing is swept in for you.

    harness doctor telemetry-nudge

  RECOVERY. Run it from an UNSANDBOXED shell. It rotates the buffer to a
  segment, replays that segment into the collector, and deletes the segment only
  when every commit it named carries a note. A partly-confirmed segment is kept
  intact and listed for an explicit retry.

## The shape to avoid

    git add … && git commit -m "…"        # compound -> sandboxed -> attribution lost
    bash -c "git commit -m \\"$(…)\\""        # ditto

Chained and compound git commits can silently lose attribution. Nothing warns
you; the commit looks completely healthy.

## What is and is not guaranteed

- **Guaranteed**: a \`harness commit\` is never SILENT about attribution. It
  either verifies the note landed, or names the buffer and the recovery command.
- **NOT guaranteed**: delivery. A blocked ingress is blocked. Buffered events
  reach the collector only when the nudge is run from somewhere that can reach
  the socket, and commits made before git-ai was installed will never gain a
  note.

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

/** The managed block's body — the same guarantee the instructions page states. */
export function commitGuidanceBlock(): string {
  return `${AGENTS_BLOCK_BEGIN}
## Committing in this repo

Use \`harness commit "<message>" -- <paths>\` rather than a chained
\`git add … && git commit …\`.

A \`harness commit\` is **verified or named**: it probes the collector ingress,
commits, and then either confirms a \`refs/notes/ai\` note landed or names the
buffer holding the events plus the command that drains it
(\`harness doctor telemetry-nudge\`). It never blocks and never rolls back.

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
