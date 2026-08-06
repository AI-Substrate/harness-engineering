import type { PathKindPort } from '../../../adapters/fs/path-kind-port.js';
import type { HostTarget } from './types.js';

/**
 * The SKILLS precondition guard (plan 073 · phase-1 review, skills ruling).
 *
 * git-ai's `install-hooks` manages three skills — `ask`, `prompt-analysis` and
 * `git-ai-search` — as symlinks under each agent's skills directory, and it is
 * destructive in BOTH directions:
 *
 * - **without `--skills`** it runs `uninstall_skills` on every invocation,
 *   removing whatever sits at those paths;
 * - **with `--skills`** it installs over them, replacing whatever sits there.
 *
 * So neither constant is a safe default, and that is why this is a guard rather
 * than a flag. It is the same shape as the trace2 guard: **inspect, and decline
 * to destroy.** If any of the nine paths holds real user content — a directory
 * or a file rather than git-ai's own symlink or nothing at all — we do not
 * invoke `install-hooks` at all, we name the path that stopped us, and we print
 * the command the operator can run themselves. The destructive path is made
 * unreachable rather than chosen.
 *
 * `CLAUDE_CONFIG_DIR` is honoured because git-ai honours it (`utils.rs:430`);
 * on a machine where it points at `~/.claude-alt`, guarding `~/.claude` would be
 * guarding the wrong directory — which is worse than not guarding at all,
 * because it reports safety it never checked.
 */

/** The three skills git-ai links, from its own skills installer. */
export const GITAI_SKILL_NAMES: readonly string[] = ['ask', 'prompt-analysis', 'git-ai-search'];

export interface SkillsGuardReading {
  /** True only when every one of the inspected paths is absent or a symlink. */
  mayInstall: boolean;
  /** Paths holding real content, with what was found there. */
  blocking: Array<{ path: string; kind: string }>;
  /** Every path inspected — so "we checked nine places" is auditable, not claimed. */
  inspected: string[];
  detail: string;
}

/** The three skills roots git-ai writes into, for one home + CLAUDE_CONFIG_DIR. */
export function skillsRootsFor(host: HostTarget): string[] {
  const home = host.home.replace(/\/+$/, '');
  const claude =
    host.claudeConfigDir !== undefined && host.claudeConfigDir.trim() !== ''
      ? host.claudeConfigDir.replace(/\/+$/, '')
      : `${home}/.claude`;
  return [`${home}/.agents/skills`, `${home}/.cursor/skills`, `${claude}/skills`];
}

/**
 * Inspect before invoking. Never mutates anything; a caller that ignores
 * `mayInstall` has not been protected, which is why the install path treats this
 * exactly like the trace2 reading — a precondition, not advice.
 */
export function readSkillsGuard(paths: PathKindPort, host: HostTarget): SkillsGuardReading {
  const inspected: string[] = [];
  const blocking: Array<{ path: string; kind: string }> = [];

  for (const root of skillsRootsFor(host)) {
    for (const name of GITAI_SKILL_NAMES) {
      const path = `${root}/${name}`;
      inspected.push(path);
      const kind = paths.kindNoFollow(path);
      // `absent` and `symlink` are git-ai's own territory. Everything else —
      // including `unknown` — is somebody's content until proven otherwise.
      if (kind !== 'absent' && kind !== 'symlink') blocking.push({ path, kind });
    }
  }

  if (blocking.length === 0) {
    return {
      mayInstall: true,
      blocking,
      inspected,
      detail: `no user content at any of the ${inspected.length} git-ai skill paths (all absent or symlinks) — install-hooks cannot delete anything of yours there`,
    };
  }
  return {
    mayInstall: false,
    blocking,
    inspected,
    detail: `git-ai's install-hooks manages ${GITAI_SKILL_NAMES.join(', ')} as symlinks and removes or replaces whatever is at those paths — but ${blocking
      .map((entry) => `${entry.path} is a real ${entry.kind}`)
      .join(', ')}. Hooks were NOT installed rather than risk deleting your work.`,
  };
}

/** What to tell an operator whose own skills are in the way. */
export function manualSkillsInstructions(
  binaryPath: string,
  blocking: ReadonlyArray<{ path: string; kind: string }>,
): string[] {
  return [
    'git-ai hooks were NOT installed: real content sits where git-ai keeps its own skill links.',
    ...blocking.map((entry) => `  ${entry.path} (${entry.kind})`),
    'git-ai removes those paths when invoked without `--skills` and overwrites them when invoked with it,',
    'so harness will not invoke it at all while your content is there.',
    'Move or rename the paths above if they are yours to keep, then either re-run',
    '  harness doctor --install-collector',
    'or install by hand, knowing what it does:',
    `  ${binaryPath} install-hooks`,
  ];
}
