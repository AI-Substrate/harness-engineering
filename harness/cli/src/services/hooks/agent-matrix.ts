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

/**
 * THE SHAPE OF ONE HOOK ENTRY. **Not uniform across agents** (plan 082 F005).
 *
 * THE INCIDENT THIS FIELD EXISTS FOR. We wrote Cursor's FLAT shape into
 * `~/.claude/settings.json`, which requires the NESTED one. Claude Code answered:
 *
 *     hooks.PostToolUse.1.hooks: Expected array, but received undefined
 *     Files with errors are SKIPPED ENTIRELY, not just the invalid settings.
 *
 * Index `[1]` was ours. It did not break our hook — **it disabled every setting in
 * that file**, permissions and notifications included, from the live install until a
 * human removed it by hand. The same entry went into `~/.gemini/settings.json` and
 * `~/.factory/settings.json`. Three agents, not one.
 *
 * SO THE COST OF A WRONG SHAPE IS NOT A DEAD HOOK — IT IS A DEAD HOST CONFIG. That
 * is why this is a field with a per-agent citation rather than a default with
 * exceptions, and why {@link AgentSpec.supported} exists for agents we cannot check.
 */
export type EntryShape =
  /**
   * The entry IS the hook: `{command, ...extras}`, and **never** a `matcher`.
   *
   * cursor (`cursor.rs:150-164`), firebender (`firebender.rs:126-141`),
   * github-copilot (`github_copilot.rs:59-69`), windsurf (`windsurf.rs:114-117`).
   *
   * The no-matcher part is measured, not inferred: firebender treats a
   * matcher-bearing entry as NOT INSTALLED (`firebender.rs:66`, `:81`) and its
   * installer strips the matcher from one it finds (`firebender.rs:179`).
   */
  | 'flat'
  /**
   * The entry is a MATCHER BLOCK wrapping the hooks:
   * `{matcher: "*", hooks: [{type: "command", command}]}`.
   *
   * claude-code (`claude_code.rs:151-154`, `:206-209`), gemini
   * (`gemini.rs:162-165`, `:194-197`), droid (`droid.rs:183-186`, `:237-240`).
   */
  | 'nested';

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
  /**
   * The event keys this agent dispatches on, per phase, in its own casing.
   *
   * A LIST PER PHASE, not one key per phase, because **windsurf has five** and none
   * of them is `PreToolUse` (`windsurf.rs:17-23`). We wrote `PreToolUse`/`PostToolUse`
   * into `~/.codeium/hooks.json`: structurally valid, so the file still parses, and
   * DEAD if windsurf dispatches only on its own names. That is F004's class —
   * registered nowhere, fires never — arriving through the event table instead of
   * the flag table.
   */
  events: { pre: string[]; post: string[] };
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
  /**
   * The shape of one hook entry in this agent's config. See {@link EntryShape}.
   *
   * NO DEFAULT, DELIBERATELY. A default is what produced F005: one shape was
   * assumed for everybody and three host configs were disabled. Making it required
   * means adding an agent forces the question to be answered from that agent's own
   * installer source, and a new row cannot inherit a silent wrong answer.
   */
  entryShape: EntryShape;
  /** The `matcher` a nested block carries. `'*'` for all three nested agents. */
  matcher?: string;
  /**
   * Fields this agent needs at the DOCUMENT ROOT, written only when absent.
   *
   * A third surface where our config could differ from the one the upstream writer
   * produces, alongside the entry shape and the event keys. git-ai sets
   * `tools.enableHooks` on every gemini install (`gemini.rs:99-106`, asserted
   * `gemini.rs:478-480`) and stamps `version: 1` for cursor and firebender
   * (`cursor.rs:172-174`, `firebender.rs:143-148`). We wrote none of them.
   *
   * MATCHED-NOT-VERIFIED (phase-5 review F3). The claim is *git-ai writes these, so
   * we write them too* — structural parity with the upstream writer. Whether any of
   * these agents' runtimes GATES on them is UNVERIFIED here; no runtime has been
   * exercised, with or without the field.
   *
   * NEVER OVERWRITTEN. An existing value is the user's, and a root key is shared
   * with settings we have no business touching. What we DID create is recorded, so
   * uninstall can reverse our own write without clearing somebody else's — see
   * `uninstall-strategy-a.ts`.
   */
  rootExtras?: Record<string, unknown>;
  /**
   * Also emit a `powershell` variant of the command in the entry.
   *
   * git-ai writes one for github-copilot (`github_copilot.rs:59-69`). Data rather
   * than a branch, so the reason lives on the row it applies to.
   */
  powershellVariant?: boolean;
  /** The env var that moves the config root, when the agent has one. */
  override?: AgentEnvOverride;
  /**
   * May we install into this agent at all?
   *
   * A row can be KNOWN and still be REFUSED. F005 established that a wrong entry
   * shape does not merely fail to install — it can disable the host application's
   * entire config file. So an agent nobody has ever exercised end to end is reported
   * as unsupported rather than installed on a guess: an explicit refusal is cheap,
   * and a confident wrong default cost three broken configs.
   */
  supported: boolean;
  /** Why not, in words a human can act on. Required when `supported` is false. */
  unsupportedReason?: string;
}

/** Every event key this agent dispatches on, pre first. */
export const eventKeys = (spec: AgentSpec): string[] => [...spec.events.pre, ...spec.events.post];

/** Every event key paired with the phase it fires in. */
export const phaseKeys = (spec: AgentSpec): [phase: 'pre' | 'post', key: string][] => [
  ...spec.events.pre.map((key): ['pre', string] => ['pre', key]),
  ...spec.events.post.map((key): ['post', string] => ['post', key]),
];

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
    events: { pre: ['PreToolUse'], post: ['PostToolUse'] },
    // VERBATIM: $CLAUDE_CONFIG_DIR/settings.json, with no `.claude` in between.
    override: { name: 'CLAUDE_CONFIG_DIR', kind: 'config-dir' },
    // claude_code.rs:151-154 (the block) and :206-209 (the inner command hook).
    entryShape: 'nested',
    matcher: '*',
    supported: true,
  },
  {
    agent: 'cursor',
    detectId: 'cursor',
    subdir: '.cursor',
    configFiles: ['hooks.json'],
    events: { pre: ['preToolUse'], post: ['postToolUse'] },
    entryShape: 'flat', // cursor.rs:150-164
    rootExtras: { version: 1 }, // cursor.rs:172-174
    supported: true,
  },
  {
    agent: 'gemini',
    detectId: 'gemini',
    subdir: '.gemini',
    configFiles: ['settings.json'],
    events: { pre: ['BeforeTool'], post: ['AfterTool'] },
    // HOME ROOT: $GEMINI_CLI_HOME/.gemini/settings.json — `.gemini` IS appended.
    override: { name: 'GEMINI_CLI_HOME', kind: 'home-root' },
    entryShape: 'nested', // gemini.rs:162-165, :194-197
    matcher: '*',
    // MATCHED-NOT-VERIFIED. gemini.rs:99-106 sets this on every install and
    // gemini.rs:478-480 asserts it; we match. Whether the gemini runtime gates
    // dispatch on it is UNVERIFIED here — nothing has been exercised either way.
    rootExtras: { tools: { enableHooks: true } },
    supported: true,
  },
  {
    agent: 'droid',
    detectId: 'droid',
    subdir: '.factory',
    configFiles: ['settings.json'],
    events: { pre: ['PreToolUse'], post: ['PostToolUse'] },
    entryShape: 'nested', // droid.rs:183-186, :237-240
    matcher: '*',
    supported: true,
  },
  {
    agent: 'firebender',
    detectId: 'firebender',
    subdir: '.firebender',
    configFiles: ['hooks.json'],
    events: { pre: ['preToolUse'], post: ['postToolUse'] },
    entryShape: 'flat', // firebender.rs:126-141; a matcher is REJECTED (:66, :81, :179)
    rootExtras: { version: 1 }, // firebender.rs:143-148
    // HELD OUT (plan 082 F005, PM ruling). Its SHAPE is known — `firebender.rs:126-141`,
    // flat, and a `matcher` is actively stripped (`firebender.rs:179`). What is unknown
    // is any END-TO-END exercise: no firebender config exists on any machine this plan
    // has touched, so nothing has ever confirmed the file is read where we write it.
    supported: false,
    unsupportedReason:
      'shape known from git-ai source but the install is unverified end to end — no firebender config has ever been observed',
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
    events: { pre: ['PreToolUse'], post: ['PostToolUse'] },
    entryShape: 'flat', // github_copilot.rs:59-69
    entryExtras: { type: 'command' },
    // MATCHED TO git-ai's ENTRY RATHER THAN REASONED ABOUT. It writes a `powershell`
    // variant alongside the posix command (`github_copilot.rs:59-69`), and copilot
    // parses hook files in NATIVE code, so requiredness is not readable from its
    // bundle. Copying the worked example is the safe answer when the schema cannot
    // be established — and the general shape guard asserts that we did.
    powershellVariant: true,
    supported: true,
  },
  {
    agent: 'windsurf',
    detectId: 'windsurf',
    subdir: '.codeium',
    // TWO files. Both are written; installing one is installing half.
    configFiles: ['hooks.json', 'windsurf/hooks.json'],
    // THE CASCADE EVENTS, from `windsurf.rs:17-23`. NOT PreToolUse/PostToolUse —
    // see the `events` field doc.
    events: {
      pre: ['pre_write_code', 'pre_run_command'],
      post: ['post_write_code', 'post_run_command', 'post_cascade_response_with_transcript'],
    },
    entryShape: 'flat', // windsurf.rs:114-117
    entryExtras: { show_output: false }, // windsurf.rs:114-117
    supported: true,
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

/**
 * Read every config-root override the matrix declares, as an ordinary map.
 *
 * ONE place answers "which environment variables move an agent's config", so the
 * installer and `backupAgentConfigs` cannot disagree about it — which is exactly
 * how a backup ends up copying `~/.claude/settings.json` while the write lands in
 * `$CLAUDE_CONFIG_DIR/settings.json`. Adding an override is still adding a row.
 *
 * Blank values are dropped, matching {@link resolveConfigRoot}: an exported-but-empty
 * variable is not a location.
 */
export function readEnvOverrides(
  get: (name: string) => string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of AGENT_MATRIX) {
    const name = spec.override?.name;
    if (name === undefined) continue;
    const value = get(name);
    if (value !== undefined && value.trim() !== '') out[name] = value;
  }
  return out;
}
