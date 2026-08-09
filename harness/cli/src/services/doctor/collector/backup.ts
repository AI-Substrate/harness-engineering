import { AGENT_MARKERS, detectAgents, UNDETECTED_INSTALLERS } from './agents.js';
import type { CollectorDeps } from './types.js';

/**
 * Copy the agent config files `install-hooks` rewrites, immediately before it
 * runs (plan 077).
 *
 * SCOPE, and it is deliberately small. Of git-ai's seven disclosed side effects
 * only ONE destroys content that cannot be reconstructed: it rewrites each
 * detected agent's config in place, reformatting it and DISCARDING JSONC
 * COMMENTS, and keeps no backup of its own. The global trace2 reset is a
 * debugging section nobody hand-authors, and our precondition only proceeds on
 * an observed-EMPTY one; the daemon restart is a restart; the skills removal is
 * already guarded by a nine-path inspection that refuses on real content. So
 * this is a file copy, not a transaction log, and it is not a safety mechanism
 * that makes anything else acceptable.
 *
 * NEVER THROWS, and never blocks the install. A backup that could abort the
 * thing it protects would be a worse failure than the comment loss it prevents.
 * Every error is captured and reported as a `failed` entry.
 *
 * PLATFORM. Paths are composed from `host.home`, which the composition root
 * resolves as `$HOME || %USERPROFILE% || os.homedir()`, and joined with `/` —
 * the repo's logical-POSIX convention, which Node accepts on win32.
 */

export interface ConfigBackup {
  /** Where the copies went; `null` when nothing needed copying. */
  dir: string | null;
  /** Home-relative config paths successfully copied. */
  copied: string[];
  /** Config paths that exist but could not be copied, with the reason. */
  failed: string[];
  /**
   * Detected agents for which we declare NO config path — so the reader can see
   * the difference between "nothing to copy" and "we did not know where to look".
   */
  undeclared: string[];
  /** One line for the operator, naming the location or why there is none. */
  detail: string;
}

/** `<home>/.git-ai/harness-backups/<iso-with-safe-separators>`. */
export function backupDirFor(home: string, nowIso: string): string {
  const stamp = nowIso.replace(/[:.]/g, '-');
  return `${home.replace(/\/+$/, '')}/.git-ai/harness-backups/${stamp}`;
}

export function backupAgentConfigs(deps: CollectorDeps): ConfigBackup {
  const home = deps.host.home.replace(/\/+$/, '');
  const dir = backupDirFor(home, deps.clock.nowIso());
  const copied: string[] = [];
  const failed: string[] = [];
  const undeclared: string[] = [];

  let detected: readonly { id: string; label: string; configs: readonly string[] }[];
  try {
    detected = detectAgents(deps.fs, home);
  } catch (err) {
    return {
      dir: null,
      copied,
      failed: [`could not detect agents: ${message(err)}`],
      undeclared,
      detail: `no agent configs were copied — detection failed: ${message(err)}`,
    };
  }

  for (const agent of detected) {
    if (agent.configs.length === 0) {
      undeclared.push(agent.id);
      continue;
    }
    for (const rel of agent.configs) {
      const source = `${home}/${rel}`;
      try {
        if (!deps.fs.exists(source)) continue;
        const bytes = deps.fs.readBytesNoFollow(source);
        if (bytes === null) {
          failed.push(`${rel} (unreadable, or not a regular file)`);
          continue;
        }
        // Flatten into one directory: the home-relative path becomes the name,
        // so a restore is an unambiguous one-to-one mapping rather than a tree
        // walk, and two agents cannot collide on `settings.json`.
        deps.fs.mkdirp(dir);
        deps.fs.writeBytes(`${dir}/${rel.replace(/\//g, '__')}`, bytes);
        copied.push(rel);
      } catch (err) {
        failed.push(`${rel} (${message(err)})`);
      }
    }
  }

  return {
    dir: copied.length === 0 ? null : dir,
    copied,
    failed,
    undeclared,
    detail: describe(dir, copied, failed, undeclared),
  };
}

function describe(dir: string, copied: string[], failed: string[], undeclared: string[]): string {
  const parts: string[] = [];
  parts.push(
    copied.length === 0
      ? 'no agent config files needed copying'
      : `copied ${copied.length} agent config file(s) to ${dir} before install-hooks rewrote them (${copied.join(', ')})`,
  );
  if (failed.length > 0) parts.push(`could NOT copy: ${failed.join('; ')}`);
  if (undeclared.length > 0) {
    parts.push(
      `no config path is declared for ${undeclared.join(', ')}, so nothing was copied for them`,
    );
  }
  // The honest denominator: this copy covers the agents WE enumerate, and that
  // set is provably smaller than the one git-ai rewrites.
  parts.push(
    `this covers the ${AGENT_MARKERS.length} agent(s) harness detects; git-ai also installs for ${UNDETECTED_INSTALLERS.join(', ')}, which are NOT detected and NOT backed up here`,
  );
  return parts.join('; ');
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
