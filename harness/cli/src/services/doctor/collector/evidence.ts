import { AGENT_MARKERS, detectAgents, MEASURED_AGAINST_PIN } from './agents.js';
import { GITAI_PIN } from './pin.js';
import type { CollectorDeps } from './types.js';

/**
 * WHICH AGENTS DID `install-hooks` ACTUALLY HOOK? (plan 077, from the Windows run
 * of 2026-08-09.)
 *
 * THE DEFECT THIS REPLACES. We reported six hooked agents on a machine where
 * three were verifiable, one (`pi`) was present with no git-ai content anywhere
 * in its tree, and two (`droid`, `windsurf`) had no directory at all. The
 * sentence carrying that list said "verified by re-reading the global trace2
 * config" — and that verification is REAL, but it establishes ONE GLOBAL BINARY
 * FACT: a trace2 key exists. It has no power to discriminate agents. A
 * six-element list was riding on a check that cannot tell one agent from another,
 * phrased so a reader would take the list itself as verified.
 *
 * THE INSTRUMENT. `install-hooks` writes files. A file that did not exist and now
 * does, or existed and now differs, is a per-agent fact about THIS machine that
 * we can hold in our hand. So: snapshot the declared config paths immediately
 * before invoking git-ai, re-read them immediately after, and report the agents
 * whose files moved.
 *
 * WHY A SNAPSHOT AND NOT THE BACKUP MANIFEST. The backup was the obvious
 * candidate — it enumerated exactly the three real agents on that Windows box,
 * because copying forced it to touch actual files, and it disagreed with the
 * printed count INSIDE THE SAME RUN. But it can only see files that ALREADY
 * EXIST: git-ai created copilot's `.copilot/hooks/git-ai.json` fresh, so the
 * backup is silent about the single clearest case of a genuine install. The
 * backup answers "what was at risk"; this answers "what changed". Neighbours,
 * not the same question.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM. An agent with no evidence is reported as
 * NOT EVIDENCED, never as not installed. Three separate things produce a silent
 * agent and only one of them is a defect:
 *
 * - git-ai wrote nothing because the content was already identical (its
 *   `Ok(None)` path — a legitimate no-op re-run).
 * - git-ai wrote somewhere we do not know to look (`CLAUDE_CONFIG_DIR`,
 *   `CODEX_HOME`, `GEMINI_CLI_HOME` all move a root we do not read).
 * - git-ai reported an agent it did not hook.
 *
 * We cannot distinguish those from inside the harness, and saying "not installed"
 * would be a confident wrong number in place of the one we are replacing. The
 * honest output is two lists and the difference between them.
 */

export interface AgentConfigSnapshot {
  /** Home-relative path → its bytes as a digest, or `null` when absent. */
  readonly digests: ReadonlyMap<string, string | null>;
}

/**
 * Read every declared config path for every DETECTED agent.
 *
 * Absent paths are recorded as `null` rather than omitted, and that is the whole
 * reason a created file is detectable: omission cannot be told from "we did not
 * look", which is the same absence-versus-null confusion that plan 077 fixed in
 * the health read.
 */
export function snapshotAgentConfigs(deps: CollectorDeps): AgentConfigSnapshot {
  const home = deps.host.home.replace(/\/+$/, '');
  const digests = new Map<string, string | null>();
  let detected: readonly { configs: readonly string[] }[];
  try {
    detected = detectAgents(deps.fs, home);
  } catch {
    // A snapshot we could not take yields NO evidence either way — never a false
    // "nothing changed", which would read as a fleet of unhooked agents.
    return { digests };
  }
  for (const agent of detected) {
    for (const rel of agent.configs) {
      if (digests.has(rel)) continue;
      digests.set(rel, digestOf(deps, `${home}/${rel}`));
    }
  }
  return { digests };
}

export interface AgentEvidence {
  /** Agents with a config file we watched get created or change. Hooked, proven. */
  readonly evidenced: string[];
  /**
   * Agents named by git-ai's own output that we could NOT evidence. Not a claim
   * that they are uninstalled — a claim that nothing here proves they are not.
   */
  readonly claimedOnly: string[];
  /** One operator line stating both, and what the gap means. */
  readonly detail: string;
}

/**
 * Compare a post-install read against {@link snapshotAgentConfigs} and report
 * what MOVED, alongside what was merely named.
 */
export function agentEvidence(
  deps: CollectorDeps,
  before: AgentConfigSnapshot,
  claimed: readonly string[],
): AgentEvidence {
  const home = deps.host.home.replace(/\/+$/, '');
  const evidenced: string[] = [];
  for (const agent of AGENT_MARKERS) {
    const moved = agent.configs.some((rel) => {
      // A path absent from the snapshot was never looked at (the agent was not
      // detected before the run), so it cannot support a CHANGE claim.
      if (!before.digests.has(rel)) return false;
      const was = before.digests.get(rel) ?? null;
      const now = digestOf(deps, `${home}/${rel}`);
      return now !== null && now !== was;
    });
    if (moved) evidenced.push(agent.id);
  }
  const proven = new Set(evidenced);
  const claimedOnly = [...new Set(claimed.map((id) => id.toLowerCase()))]
    .filter((id) => !proven.has(id))
    .sort();
  return { evidenced: evidenced.sort(), claimedOnly, detail: describe(evidenced, claimedOnly) };
}

function describe(evidenced: readonly string[], claimedOnly: readonly string[]): string {
  const head =
    evidenced.length === 0
      ? 'no agent config file was observed to change, so NO agent hook is evidenced by this run'
      : `hooks EVIDENCED for ${evidenced.length} agent(s) by a config file we watched change: ${evidenced.join(', ')}`;
  const parts = [head];
  if (claimedOnly.length > 0) {
    parts.push(
      `git-ai also named ${claimedOnly.join(', ')}, which we could NOT evidence — that is not proof they are unhooked (git-ai writes nothing when the content already matches, and CLAUDE_CONFIG_DIR/CODEX_HOME/GEMINI_CLI_HOME move paths we do not read), only that nothing here confirms them`,
    );
  }
  const stale = pinDrift();
  if (stale !== null) parts.push(stale);
  return parts.join('; ');
}

/**
 * Say so when the evidence is being drawn from paths measured against a DIFFERENT
 * collector version than the one installed.
 *
 * A RUNTIME WARNING RATHER THAN A FAILING TEST, and the choice is deliberate.
 * `pin.test.ts` declares that bumping the pin is a one-file diff — the pin is
 * data. A test binding {@link MEASURED_AGAINST_PIN} to `GITAI_PIN.version` would
 * quietly repeal that invariant: every bump would fail a test in a second file.
 *
 * But the staleness is real. `install-hooks` can move a config path in a patch
 * release, and if it does, this whole check reads "not evidenced" for agents that
 * were hooked perfectly well — a confident wrong number of exactly the kind it
 * exists to remove. So the bump stays cheap, and the COST OF THE BUMP becomes
 * visible to whoever reads the row, at the moment it starts mattering.
 */
function pinDrift(): string | null {
  const installed = GITAI_PIN.version.replace(/^v/, '');
  if (installed === MEASURED_AGAINST_PIN.replace(/^v/, '')) return null;
  return `NOTE: these config paths were read from git-ai's source at ${MEASURED_AGAINST_PIN} and the pinned collector is now ${GITAI_PIN.version} — a path moved in a release since would make this evidence read as absent rather than as wrong, so re-read src/mdm/agents/*.rs and update MEASURED_AGAINST_PIN`;
}

function digestOf(deps: CollectorDeps, path: string): string | null {
  try {
    const bytes = deps.fs.readBytesNoFollow(path);
    return bytes === null ? null : deps.hash.sha256Hex(bytes);
  } catch {
    return null;
  }
}
