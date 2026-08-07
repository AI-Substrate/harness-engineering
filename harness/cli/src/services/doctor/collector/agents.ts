import type { CollectorFsPort } from './types.js';

/**
 * Coding-harness detection (plan 073 · ac-0010).
 *
 * The re-check case is mundane and the whole reason doctor owns this lifecycle:
 * hooks were installed in March, the developer installed Codex in July, and
 * nothing in the machine tells anyone that Codex is producing zero attribution.
 * git-ai's `install-hooks` only writes hooks for the agents it finds AT THAT
 * MOMENT, so a later arrival is invisible until someone re-runs it.
 *
 * Detection is a marker-path existence test, deliberately: it must be a pure fs
 * read so doctor can report it without invoking anything, and a false positive
 * costs one line of "hooks missing for X" rather than a wrong install.
 *
 * The list mirrors git-ai's installer registry (`src/mdm/agents/mod.rs`
 * `get_all_installers`) — 15 installers. Continue CLI is deliberately ABSENT:
 * git-ai ships no installer for it, so reporting its hooks as missing would nag
 * about something no re-check can fix.
 */

export interface AgentMarker {
  /** The id git-ai uses in its install-hooks output. */
  id: string;
  /** Human label for the doctor row. */
  label: string;
  /** Home-relative path whose existence means "this agent is on the machine". */
  marker: string;
}

export const AGENT_MARKERS: readonly AgentMarker[] = [
  { id: 'claude', label: 'Claude Code', marker: '.claude' },
  { id: 'codex', label: 'Codex', marker: '.codex' },
  { id: 'cursor', label: 'Cursor', marker: '.cursor' },
  { id: 'copilot', label: 'Copilot CLI', marker: '.copilot' },
  { id: 'gemini', label: 'Gemini CLI', marker: '.gemini' },
  { id: 'droid', label: 'Droid', marker: '.factory' },
  { id: 'windsurf', label: 'Windsurf', marker: '.codeium' },
  { id: 'firebender', label: 'Firebender', marker: '.firebender' },
  { id: 'amp', label: 'Amp', marker: '.amp' },
  { id: 'opencode', label: 'OpenCode', marker: '.opencode' },
  { id: 'pi', label: 'Pi', marker: '.pi' },
];

/** Agents present on this machine, by marker directory. */
export function detectAgents(fs: CollectorFsPort, home: string): AgentMarker[] {
  const root = home.replace(/\/+$/, '');
  return AGENT_MARKERS.filter((agent) => fs.exists(`${root}/${agent.marker}`));
}

/**
 * Agents present on the machine that the recorded hook install did not cover —
 * i.e. what a re-check would newly hook. Comparison is by id, case-insensitively,
 * because git-ai's reported ids are not case-stable across surfaces.
 */
export function agentsMissingHooks(
  detected: readonly AgentMarker[],
  installedFor: readonly string[],
): AgentMarker[] {
  const covered = new Set(installedFor.map((id) => id.toLowerCase()));
  return detected.filter((agent) => !covered.has(agent.id.toLowerCase()));
}
