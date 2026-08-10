import { AGENT_MATRIX, resolveConfigFiles } from '../../hooks/agent-matrix.js';
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
 * KNOWN LIMIT, MEASURED (plan 077, on a clean-slate VM): a marker directory does
 * not distinguish an agent THE USER INSTALLED from a directory THE INSTALLER
 * MADE. Three markers were seeded and `install-hooks` hooked FOUR — it created
 * `~/.copilot` itself during the run. So on any machine where git-ai has ever
 * run, this list reports Copilot CLI as present whether or not it is, and a
 * later re-check sees a "detected" agent that no human ever installed.
 *
 * Not fixed here, and worth being explicit about why: the failure is benign in
 * the direction it fires. A phantom marker makes us report an agent as covered
 * or as newly-detected, never as MISSING attribution for something real. Telling
 * the two apart needs evidence a directory's existence cannot carry — an agent
 * binary, a config with user content, an mtime older than the git-ai install —
 * which is a different detection shape, not another row.
 *
 * The list does NOT mirror git-ai's installer registry, and the gap is named in
 * {@link UNDETECTED_INSTALLERS} rather than left to be rediscovered. Continue CLI
 * is deliberately absent for a different reason: git-ai ships no installer for
 * it at all, so reporting its hooks as missing would nag about something no
 * re-check can fix.
 */

export interface AgentMarker {
  /** The id git-ai uses in its install-hooks output. */
  id: string;
  /** Human label for the doctor row. */
  label: string;
  /** Home-relative path whose existence means "this agent is on the machine". */
  marker: string;
  /**
   * Home-relative config files `install-hooks` WRITES — rewriting them in place,
   * reformatting them and discarding JSONC comments, keeping no backups of its
   * own (`INSTALL_HOOKS_DISCLOSURES`). These are the only genuinely
   * unrecoverable content in the whole install, so they are the only thing we
   * copy first — and since plan 077 they are also the EVIDENCE that a hook
   * install actually happened for an agent (see `evidence.ts`).
   *
   * MEASURED against the source of the pinned tag (see {@link MEASURED_AGAINST_PIN}),
   * one installer at a time — not against the checkout's HEAD, which is one patch
   * ahead and would have been a different tree. Each entry cites the line that
   * builds the path.
   *
   * The list was previously ASSERTED, and six of eleven rows were wrong: they
   * named plausible-looking dotfiles (`.copilot/config.json`, `.pi/config.json`,
   * `.amp/settings.json`) that git-ai never touches, while missing every file it
   * does write. One row invented a file that appears nowhere in git-ai at all
   * (`.cursor/cli-config.json`), and one declared nothing for an agent that gets
   * TWO files written. The Windows run of 2026-08-09 is what exposed it:
   * copilot's `.copilot/config.json` came back byte-identical after a successful
   * install, because the real target is two directories down.
   *
   * KNOWN INCOMPLETENESS, declared rather than discovered later: three of these
   * roots move under an environment variable — `CLAUDE_CONFIG_DIR`
   * (`src/mdm/utils.rs:428`), `CODEX_HOME` (:439) and `GEMINI_CLI_HOME` (:450).
   * We do not read those, so on a machine that sets one our path is wrong and the
   * agent reads as UNEVIDENCED rather than as wrongly-confirmed. That is the safe
   * direction to be wrong in, and it is why the evidence check reports "could not
   * evidence" instead of "not installed".
   */
  configs: readonly string[];
}

/**
 * The collector version the `configs` paths below were MEASURED against.
 *
 * NOT the pin, and deliberately not imported from it — this records what a human
 * actually read, and it must be able to DISAGREE with the pin. When they differ,
 * the table below is evidence about a build we no longer ship, and the row says
 * so out loud at runtime (`evidence.ts`) rather than leaving a stale comment to
 * be believed.
 *
 * `install-hooks` can move a config path in a patch release. If it does, our
 * backup copies the wrong bytes and the evidence check silently proves nothing —
 * so bumping the pin means re-reading `src/mdm/agents/*.rs` and updating this
 * constant with it.
 *
 * A separate literal precisely so `pin.test.ts`'s "the pin is data" control keeps
 * passing: bumping the version stays a one-file diff to `pin.ts`, and this
 * constant makes the resulting evidence gap VISIBLE instead of making the bump
 * fail. Different jobs.
 */
export const MEASURED_AGAINST_PIN = '1.6.21';

export const AGENT_MARKERS: readonly AgentMarker[] = [
  // claude_code.rs:21 — claude_config_dir().join("settings.json").
  { id: 'claude', label: 'Claude Code', marker: '.claude', configs: ['.claude/settings.json'] },
  // codex.rs:21 and :25 — BOTH files, and the second was missing here.
  {
    id: 'codex',
    label: 'Codex',
    marker: '.codex',
    configs: ['.codex/config.toml', '.codex/hooks.json'],
  },
  // cursor.rs:23 — hooks.json only. `.cursor/cli-config.json` used to be listed
  // and appears nowhere in git-ai; it was invented, not observed.
  { id: 'cursor', label: 'Cursor', marker: '.cursor', configs: ['.cursor/hooks.json'] },
  // github_copilot.rs:19-23, plus the legacy location at :26-28 which git-ai
  // MIGRATES FROM and deletes — content at risk, so it is copied too.
  {
    id: 'copilot',
    label: 'Copilot CLI',
    marker: '.copilot',
    configs: ['.copilot/hooks/git-ai.json', '.github/hooks/git-ai.json'],
  },
  // gemini.rs:19 — gemini_config_dir().join("settings.json").
  { id: 'gemini', label: 'Gemini CLI', marker: '.gemini', configs: ['.gemini/settings.json'] },
  // droid.rs:53 — .factory/settings.json.
  { id: 'droid', label: 'Droid', marker: '.factory', configs: ['.factory/settings.json'] },
  // windsurf.rs:31-38 — TWO files, always both. Previously declared as none.
  {
    id: 'windsurf',
    label: 'Windsurf',
    marker: '.codeium',
    configs: ['.codeium/hooks.json', '.codeium/windsurf/hooks.json'],
  },
  // firebender.rs:16 — hooks.json, not the `firebender.json` we had.
  {
    id: 'firebender',
    label: 'Firebender',
    marker: '.firebender',
    configs: ['.firebender/hooks.json'],
  },
  // amp.rs:14-21 — a PLUGIN under .config, not a dotfile settings.json.
  { id: 'amp', label: 'Amp', marker: '.amp', configs: ['.config/amp/plugins/git-ai.ts'] },
  // opencode.rs:14-21 — same shape as amp.
  {
    id: 'opencode',
    label: 'OpenCode',
    marker: '.opencode',
    configs: ['.config/opencode/plugins/git-ai.ts'],
  },
  // pi.rs:16-20 — an extension three directories down, not `.pi/config.json`.
  { id: 'pi', label: 'Pi', marker: '.pi', configs: ['.pi/agent/extensions/git-ai.ts'] },
];

/**
 * Agents git-ai ships an installer for that we do NOT detect — MEASURED against
 * `get_all_installers` (`src/mdm/agents/mod.rs:38-59`) rather than inherited
 * from the comment that used to sit here, which claimed a 15-installer mirror
 * while listing eleven.
 *
 * The real registry is FOURTEEN on POSIX and FIFTEEN on Windows — the count is
 * platform-conditional (`#[cfg(windows)] installers.push(VisualStudioInstaller)`),
 * so the old "15" was the Windows number stated as a constant.
 *
 * These four are the difference. They are named rather than silently missing
 * because both things we do with this list — reporting an agent as uninstrumented,
 * and copying its config before `install-hooks` rewrites it — are only as
 * complete as the list itself. git-ai WILL hook and rewrite these; we will
 * neither report nor back them up.
 *
 * They are editor-level installers rather than `~/.<agent>` CLI harnesses, so
 * marker-directory detection does not reach them; closing the gap needs a
 * different detection shape, not four more rows.
 */
export const UNDETECTED_INSTALLERS: readonly string[] = [
  'Cline',
  'VSCode',
  'JetBrains',
  'VisualStudio (Windows only)',
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
 *
 * DELIBERATELY ONE-DIRECTIONAL, and this is a declared NON-GOAL rather than an
 * oversight (plan 077, raised in review).
 *
 * It answers `detected − covered` and is structurally silent on the reverse,
 * `covered − detected`. The asymmetry is not laziness: the two directions are
 * not the same KIND of fact.
 *
 * - `detected − covered` is a REAL GAP. A coding harness is on this machine and
 *   its edits are not being attributed. Actionable, and the whole reason this
 *   function exists.
 * - `covered − detected` means MORE is instrumented than we can see — git-ai
 *   hooked something our marker list has no entry for. That is never bad news
 *   about the machine; it is a fact about OUR list being narrower than git-ai's.
 *
 * And we know exactly when it fires: {@link UNDETECTED_INSTALLERS}. git-ai ships
 * installers for Cline, VSCode and JetBrains (plus Visual Studio on Windows),
 * which are editor-level and have no `~/.<agent>` marker directory to test for.
 * So on any machine with VS Code — i.e. most of them — the reverse direction
 * would report a permanent non-problem, on every run, forever. A row that is
 * always on is a row nobody reads, and it would be competing for attention with
 * the forward direction, which is the one that means something.
 *
 * The honest disposition is therefore: measure the gap ONCE, in source, and name
 * it as a constant a reader can check ({@link UNDETECTED_INSTALLERS}) — rather
 * than re-derive it at runtime as a finding we would have to teach everyone to
 * ignore. If detection ever grows a shape that reaches editor-level installers,
 * this reasoning expires and the reverse direction becomes worth asserting.
 */
export function agentsMissingHooks(
  detected: readonly AgentMarker[],
  installedFor: readonly string[],
): AgentMarker[] {
  const covered = new Set(installedFor.map((id) => id.toLowerCase()));
  return detected.filter((agent) => !covered.has(agent.id.toLowerCase()));
}

/**
 * Every home-relative config path that must be considered for one detected agent —
 * the UNION of what git-ai rewrites and what OUR installer writes (plan 082).
 *
 * ONE resolver, shared by `backupAgentConfigs` and `snapshotAgentConfigs`, because
 * two collector functions answering "which files does this agent have" differently
 * is the same divergence class that produced `detectId` and the
 * back-up-the-wrong-file defect. Widening one and not the other would have created
 * a fresh instance of it inside the same directory.
 *
 * Matrix paths resolve through the installer's own function, so an env override
 * moves the backup, the digest and the write TOGETHER.
 */
export function configPathsFor(
  agent: { id: string; configs: readonly string[] },
  home: string,
  envOverrides: Readonly<Record<string, string>> = {},
): string[] {
  const spec = AGENT_MATRIX.find((s) => s.detectId.toLowerCase() === agent.id.toLowerCase());
  const ours =
    spec === undefined
      ? []
      : resolveConfigFiles(spec, home, (name) => envOverrides[name]).map((abs) =>
          abs.startsWith(`${home}/`) ? abs.slice(home.length + 1) : abs,
        );
  return [...new Set([...agent.configs, ...ours])];
}
