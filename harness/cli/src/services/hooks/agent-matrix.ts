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
  /** Slug, as it appears in our hook command (`harness hooks fire <agent>`). */
  agent: string;
  /**
   * The COLLECTOR's marker id for this same agent (`AGENT_MARKERS` in
   * `doctor/collector/agents.ts`).
   *
   * Two namespaces, deliberately linked rather than merged. Our slug is a CLI
   * argument the user can see; the collector's id mirrors git-ai's own marker
   * table, where the same agents are called `claude` and `copilot`. MEASURED: a
   * test comparing the two sets directly found `claude-code` and `github-copilot`
   * unmatched — which is exactly the "two answers to which agents are here" that
   * reusing one detector is supposed to prevent, arriving through naming instead
   * of through a second detector.
   *
   * Declaring the link makes it assertable: every `detectId` must resolve to a real
   * marker, so a rename on either side fails a test instead of silently detecting
   * nothing.
   */
  detectId: string;
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
  /**
   * Extra fields this agent's hook ENTRY needs beyond `command`.
   *
   * A FIELD rather than a branch, so "adding an agent is a row" survives contact
   * with agents whose entry shape differs. MEASURED from the only working copilot
   * hook file on this machine (git-ai's), whose entries carry `type: "command"`
   * alongside the command.
   *
   * UNRESOLVED and deliberately not guessed: that same file also carries a
   * `powershell` variant of the command. Copilot parses hook files in NATIVE code,
   * so the schema is not readable from its JS bundle and requiredness cannot be
   * established here. Windows is already EXPECTED-UNVERIFIED for this plan; this is
   * a second reason it stays that way.
   */
  entryExtras?: Record<string, unknown>;
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
    detectId: 'claude',
    subdir: '.claude',
    configFiles: ['settings.json'],
    events: { pre: 'PreToolUse', post: 'PostToolUse' },
    // VERBATIM: $CLAUDE_CONFIG_DIR/settings.json, with no `.claude` in between.
    override: { name: 'CLAUDE_CONFIG_DIR', kind: 'config-dir' },
  },
  {
    agent: 'cursor',
    detectId: 'cursor',
    subdir: '.cursor',
    configFiles: ['hooks.json'],
    events: { pre: 'preToolUse', post: 'postToolUse' },
  },
  {
    agent: 'gemini',
    detectId: 'gemini',
    subdir: '.gemini',
    configFiles: ['settings.json'],
    events: { pre: 'BeforeTool', post: 'AfterTool' },
    // HOME ROOT: $GEMINI_CLI_HOME/.gemini/settings.json — `.gemini` IS appended.
    override: { name: 'GEMINI_CLI_HOME', kind: 'home-root' },
  },
  {
    agent: 'droid',
    detectId: 'droid',
    subdir: '.factory',
    configFiles: ['settings.json'],
    events: { pre: 'PreToolUse', post: 'PostToolUse' },
  },
  {
    agent: 'firebender',
    detectId: 'firebender',
    subdir: '.firebender',
    configFiles: ['hooks.json'],
    events: { pre: 'preToolUse', post: 'postToolUse' },
  },
  {
    agent: 'github-copilot',
    detectId: 'copilot',
    subdir: '.copilot',
    // MEASURED, and NOT git-ai's file. `~/.copilot/hooks/` is a DROP-IN DIRECTORY:
    // the installed CLI resolves `userHooksDir = <config>/hooks` (and `.github/hooks`
    // per repo) and enumerates it — there is no fixed hooks filename anywhere in its
    // bundle. The only file present is `git-ai.json`, named for the tool that wrote
    // it. Merging our entry into THAT file would put our hook in a file we do not
    // own, which `git-ai uninstall-hooks` deletes — our hook would vanish silently,
    // this plan's own failure class arriving through a config path. So we write our
    // OWN file beside it, exactly as git-ai writes its own.
    configFiles: ['hooks/harness.json'],
    events: { pre: 'PreToolUse', post: 'PostToolUse' },
    entryExtras: { type: 'command' },
  },
  {
    agent: 'windsurf',
    detectId: 'windsurf',
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
