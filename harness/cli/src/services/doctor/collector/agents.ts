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
   * Home-relative config files `install-hooks` REWRITES IN PLACE, reformatting
   * them and discarding JSONC comments, keeping no backups of its own
   * (`INSTALL_HOOKS_DISCLOSURES`). These are the only genuinely unrecoverable
   * content in the whole install, so they are the only thing we copy first.
   *
   * Enumerated by us, which means this list is exactly as complete as we are —
   * see {@link AGENT_MARKERS} on why that is stated rather than assumed.
   */
  configs: readonly string[];
}

export const AGENT_MARKERS: readonly AgentMarker[] = [
  { id: 'claude', label: 'Claude Code', marker: '.claude', configs: ['.claude/settings.json'] },
  { id: 'codex', label: 'Codex', marker: '.codex', configs: ['.codex/config.toml'] },
  {
    id: 'cursor',
    label: 'Cursor',
    marker: '.cursor',
    configs: ['.cursor/hooks.json', '.cursor/cli-config.json'],
  },
  { id: 'copilot', label: 'Copilot CLI', marker: '.copilot', configs: ['.copilot/config.json'] },
  { id: 'gemini', label: 'Gemini CLI', marker: '.gemini', configs: ['.gemini/settings.json'] },
  { id: 'droid', label: 'Droid', marker: '.factory', configs: ['.factory/settings.json'] },
  { id: 'windsurf', label: 'Windsurf', marker: '.codeium', configs: [] },
  {
    id: 'firebender',
    label: 'Firebender',
    marker: '.firebender',
    configs: ['.firebender/firebender.json'],
  },
  { id: 'amp', label: 'Amp', marker: '.amp', configs: ['.amp/settings.json'] },
  { id: 'opencode', label: 'OpenCode', marker: '.opencode', configs: ['.opencode/opencode.json'] },
  { id: 'pi', label: 'Pi', marker: '.pi', configs: ['.pi/config.json'] },
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
