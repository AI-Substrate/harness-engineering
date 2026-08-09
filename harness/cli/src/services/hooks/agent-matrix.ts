/**
 * THE AGENT MATRIX, AS DATA (plan 082 tk-0004).
 *
 * One table, no per-agent code. Every difference between agents — where the config
 * lives, which env var moves it, what the event keys are called, how many files get
 * written — is a FIELD, so adding an agent is adding a row.
 *
 * That is asserted rather than asserted-about: a test adds a FAKE agent as a table
 * row and installs it with no code change (dw-0010). Reading the writer for `switch`
 * statements would prove less — a reviewer can miss a branch; a fake agent that
 * installs cannot be argued with.
 *
 * EVENT NAMES ARE NOT CONSISTENT, and assuming `PreToolUse` is wrong (dw-000f).
 * From the source raid:
 *
 * | agent | event keys |
 * | --- | --- |
 * | claude-code, github-copilot, droid | `PreToolUse` / `PostToolUse` (Pascal) |
 * | cursor, firebender | `preToolUse` / `postToolUse` (**lowerCamel**) |
 * | gemini | **`BeforeTool` / `AfterTool`** |
 *
 * THE TWO ENV OVERRIDES BEHAVE DIFFERENTLY, and getting them backwards writes to
 * the wrong place SILENTLY — which is why {@link OverrideKind} exists as data
 * rather than as two `if` branches:
 *
 * - `CLAUDE_CONFIG_DIR` is used **verbatim as the directory**. Nothing is appended.
 * - `GEMINI_CLI_HOME` points at the **home root**, and `.gemini` IS appended.
 *
 * "Assert both directions" is NOT set-vs-unset — a resolver that always appends
 * passes a set-vs-unset test while the bug is present. The assertion that proves the
 * asymmetry is a MUTATION: swap the two kinds and BOTH fixtures must go red
 * (dw-000d).
 */

/** How an env override relates to the config directory. The asymmetry, as data. */
export type OverrideKind =
  /** The variable IS the directory. Nothing is appended. (`CLAUDE_CONFIG_DIR`) */
  | 'config-dir'
  /** The variable is the HOME ROOT; the agent's subdir is appended. (`GEMINI_CLI_HOME`) */
  | 'home-root';

export interface AgentEnvOverride {
  name: string;
  kind: OverrideKind;
}

export interface AgentSpec {
  /** Slug, as it appears in our hook command. */
  agent: string;
  /** Directory under the home, e.g. `.cursor`. Also what a `home-root` override appends. */
  subdir: string;
  /**
   * Config files RELATIVE to the resolved config root.
   *
   * A list, not a string, because **windsurf writes TWO** (dw-000e): `hooks.json`
   * and `windsurf/hooks.json` under `~/.codeium`. An agent modelled as one file
   * would silently install half of windsurf's hooks.
   */
  configFiles: string[];
  /** The event keys, in this agent's own casing. */
  events: { pre: string; post: string };
  /** The env var that moves the config root, when the agent has one. */
  override?: AgentEnvOverride;
}

/**
 * Strategy A — JSON config merge. Seven agents.
 *
 * Ordered as the workshop lists them. Cursor is the critical path: it is the agent
 * the end-to-end validation runs against.
 */
export const AGENT_MATRIX: AgentSpec[] = [
  {
    agent: 'claude-code',
    subdir: '.claude',
    configFiles: ['settings.json'],
    events: { pre: 'PreToolUse', post: 'PostToolUse' },
    // VERBATIM: $CLAUDE_CONFIG_DIR/settings.json, with no `.claude` in between.
    override: { name: 'CLAUDE_CONFIG_DIR', kind: 'config-dir' },
  },
  {
    agent: 'cursor',
    subdir: '.cursor',
    configFiles: ['hooks.json'],
    events: { pre: 'preToolUse', post: 'postToolUse' },
  },
  {
    agent: 'gemini',
    subdir: '.gemini',
    configFiles: ['settings.json'],
    events: { pre: 'BeforeTool', post: 'AfterTool' },
    // HOME ROOT: $GEMINI_CLI_HOME/.gemini/settings.json — `.gemini` IS appended.
    override: { name: 'GEMINI_CLI_HOME', kind: 'home-root' },
  },
  {
    agent: 'droid',
    subdir: '.factory',
    configFiles: ['settings.json'],
    events: { pre: 'PreToolUse', post: 'PostToolUse' },
  },
  {
    agent: 'firebender',
    subdir: '.firebender',
    configFiles: ['hooks.json'],
    events: { pre: 'preToolUse', post: 'postToolUse' },
  },
  {
    agent: 'github-copilot',
    subdir: '.copilot',
    configFiles: ['hooks/git-ai.json'],
    events: { pre: 'PreToolUse', post: 'PostToolUse' },
  },
  {
    agent: 'windsurf',
    subdir: '.codeium',
    // TWO files. Both are written; installing one is installing half.
    configFiles: ['hooks.json', 'windsurf/hooks.json'],
    events: { pre: 'PreToolUse', post: 'PostToolUse' },
  },
];

/** POSIX-joined path. The matrix is data, so it must not import `node:path`. */
const joinPath = (...parts: string[]): string =>
  parts
    .filter((part) => part.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/');

/**
 * The directory this agent's config files live in.
 *
 * THE ASYMMETRY LIVES HERE AND NOWHERE ELSE, which is what makes the swap mutation
 * a single, meaningful edit. With no override set, both kinds resolve identically —
 * which is exactly why a set-vs-unset test cannot tell them apart.
 */
export function resolveConfigRoot(
  spec: AgentSpec,
  home: string,
  env: (name: string) => string | undefined,
): string {
  const override = spec.override;
  if (override !== undefined) {
    const value = env(override.name);
    if (value !== undefined && value.length > 0) {
      return override.kind === 'config-dir' ? value : joinPath(value, spec.subdir);
    }
  }
  return joinPath(home, spec.subdir);
}

/** Every config file this agent needs written, absolute. */
export function resolveConfigFiles(
  spec: AgentSpec,
  home: string,
  env: (name: string) => string | undefined,
): string[] {
  const root = resolveConfigRoot(spec, home, env);
  return spec.configFiles.map((file) => joinPath(root, file));
}

/** Look one up by slug. `undefined` for an agent this strategy does not cover. */
export const findAgent = (agent: string): AgentSpec | undefined =>
  AGENT_MATRIX.find((spec) => spec.agent === agent);
