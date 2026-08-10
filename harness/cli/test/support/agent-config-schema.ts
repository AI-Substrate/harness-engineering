/**
 * WHAT EACH AGENT REQUIRES OF ITS OWN CONFIG FILE — derived from git-ai's
 * per-agent installer source, NOT from the configs on this machine (plan 082 F005).
 *
 * THE DEFECT THIS EXISTS TO CATCH, STATED PLAINLY. We wrote Cursor's FLAT entry
 * shape `{command}` into `~/.claude/settings.json`, which requires the NESTED shape
 * `{matcher, hooks:[{type, command}]}`. Claude Code reported:
 *
 *     hooks.PostToolUse.1.hooks: Expected array, but received undefined
 *     hooks.PreToolUse.1.hooks:  Expected array, but received undefined
 *     Files with errors are SKIPPED ENTIRELY, not just the invalid settings.
 *
 * Index `[1]` was ours. It did not break OUR hook — **it disabled every setting in
 * the file**: permissions, notifications, all of it. The same flat entry went into
 * `~/.gemini/settings.json` and `~/.factory/settings.json`, which are nested too.
 *
 * WHY OUR EXISTING FIXTURES ALL PASSED. Every one of them asserts that OUR entry is
 * present and that the SIBLINGS survived — properties of the PARTS. Not one asserts
 * that the FILE is still valid to its own consumer. **Preservation is not
 * correctness**: every entry survived and the document stopped working anyway.
 * Validity is a property of the whole document, so it needs an assertion about the
 * whole document.
 *
 * WHY THE SCHEMAS ARE DERIVED FROM git-ai's SOURCE. git-ai ships SIXTEEN per-agent
 * installers under `src/mdm/agents/`. Every correct shape is already written down
 * there. This plan raided that source for the four defects it was fixing and never
 * lifted the SHAPES — then wrote one shape for all seven agents. Reading the configs
 * on this machine is a weaker method for two reasons: it can only describe agents
 * that happen to have a file here (firebender has none), and an installed file is an
 * artifact of a writer rather than a statement of the requirement.
 *
 * Citations are `<file>:<line>` in `git-ai/src/mdm/agents/`, per agent, so the claim
 * is checkable rather than remembered.
 */

/** A structural description of a value: key names and types, never values. */
export type ShapeSignature = string;

/**
 * Describe a value's STRUCTURE, discarding every value.
 *
 * `{command: "x"}` and `{command: "y"}` share a signature; `{command}` and
 * `{matcher, hooks}` do not. That is what lets a test say "our entry has the same
 * shape as the sibling already in this file" without caring what either runs.
 *
 * Object keys are SORTED, because key order is a property of the writer and not of
 * the shape — our writer appends and git-ai's re-sorts alphabetically, and neither
 * difference makes an entry structurally wrong.
 */
export function shapeOf(value: unknown): ShapeSignature {
  if (Array.isArray(value)) {
    const inner = [...new Set(value.map(shapeOf))].sort();
    return `[${inner.join('|')}]`;
  }
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, inner]) => `${key}:${shapeOf(inner)}`)
    .sort();
  return `{${entries.join(',')}}`;
}

export interface SchemaViolation {
  /** Where in the document, e.g. `hooks.PreToolUse[1]`. */
  at: string;
  /** What the agent requires, phrased as the agent's own loader would put it. */
  problem: string;
}

/** Validate one whole config document against one agent's requirements. */
export type ConfigValidator = (doc: unknown) => SchemaViolation[];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * The NESTED entry requirement — claude-code, gemini, droid.
 *
 * Every element of an event array is a MATCHER BLOCK: an optional `matcher` string
 * plus a `hooks` ARRAY of `{type, command}`. A bare `{command}` is the exact defect:
 * its `hooks` is `undefined`, which is what "Expected array, but received undefined"
 * is reporting.
 *
 * git-ai writes the block at `claude_code.rs:151-154`, `gemini.rs:162-165`,
 * `droid.rs:183-186`, and the inner command hook at `claude_code.rs:206-209`,
 * `gemini.rs:194-197`, `droid.rs:237-240`.
 */
const nestedValidator: ConfigValidator = (doc) => {
  const violations: SchemaViolation[] = [];
  const hooks = asRecord(asRecord(doc)?.hooks);
  if (hooks === null) return violations;

  for (const [event, blocks] of Object.entries(hooks)) {
    if (!Array.isArray(blocks)) {
      violations.push({ at: `hooks.${event}`, problem: 'Expected array' });
      continue;
    }
    blocks.forEach((block, index) => {
      const at = `hooks.${event}.${index}`;
      const record = asRecord(block);
      if (record === null) {
        violations.push({ at, problem: 'Expected object' });
        return;
      }
      // THE EXACT MESSAGE JORDAN SAW, reproduced as an assertion.
      if (!Array.isArray(record.hooks)) {
        violations.push({ at: `${at}.hooks`, problem: 'Expected array, but received undefined' });
        return;
      }
      record.hooks.forEach((entry, inner) => {
        const hook = asRecord(entry);
        if (hook === null || typeof hook.command !== 'string') {
          violations.push({ at: `${at}.hooks.${inner}.command`, problem: 'Expected string' });
        }
      });
      if (record.matcher !== undefined && typeof record.matcher !== 'string') {
        violations.push({ at: `${at}.matcher`, problem: 'Expected string' });
      }
    });
  }
  return violations;
};

/**
 * The FLAT entry requirement — cursor, firebender, github-copilot, windsurf.
 *
 * Every element is the hook itself: a `command` string, and NEVER a `matcher`.
 *
 * The no-matcher rule is not inferred. firebender's own check treats a
 * matcher-bearing entry as NOT INSTALLED (`firebender.rs:66`, `firebender.rs:81`)
 * and its installer REWRITES such an entry to strip it
 * (`firebender.rs:179`, test `firebender.rs:516`). So a nested block is as wrong
 * here as a flat entry is in claude-code — the mirror image of the same defect.
 */
const flatValidator: ConfigValidator = (doc) => {
  const violations: SchemaViolation[] = [];
  const hooks = asRecord(asRecord(doc)?.hooks);
  if (hooks === null) return violations;

  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      violations.push({ at: `hooks.${event}`, problem: 'Expected array' });
      continue;
    }
    entries.forEach((entry, index) => {
      const at = `hooks.${event}.${index}`;
      const record = asRecord(entry);
      if (record === null) {
        violations.push({ at, problem: 'Expected object' });
        return;
      }
      if (typeof record.command !== 'string') {
        violations.push({ at: `${at}.command`, problem: 'Expected string' });
      }
      if (record.matcher !== undefined) {
        violations.push({ at: `${at}.matcher`, problem: 'A matcher is not accepted here' });
      }
      if (record.hooks !== undefined) {
        violations.push({
          at: `${at}.hooks`,
          problem: 'A nested hooks array is not accepted here',
        });
      }
    });
  }
  return violations;
};

/**
 * Per-agent validators, keyed by our slug.
 *
 * THREE NESTED, FOUR FLAT — measured, and NOT the one-nested-exception the first
 * report assumed. Taking claude-code as a special case would have fixed a third of
 * the bug and left gemini and droid broken.
 */
export const CONFIG_VALIDATORS: Record<string, ConfigValidator> = {
  // NESTED — a `matcher` + `hooks` array per block.
  'claude-code': nestedValidator, // claude_code.rs:151-154, 206-209
  gemini: nestedValidator, //        gemini.rs:162-165, 194-197
  droid: nestedValidator, //         droid.rs:183-186, 237-240
  // FLAT — the hook itself, no matcher.
  cursor: flatValidator, //          cursor.rs:150-164
  firebender: flatValidator, //      firebender.rs:126-141 (matcher rejected: :66, :81, :179)
  'github-copilot': flatValidator, // github_copilot.rs:59-69
  windsurf: flatValidator, //        windsurf.rs:114-117
};

/**
 * git-ai's OWN entry for each agent — the worked example that was sitting in the
 * file we were editing, one line above ours, the whole time.
 *
 * Reproduced from its installer source rather than copied from this machine, so
 * firebender (which has no config here) is covered exactly as well as the rest.
 * The binary path is a placeholder; only the SHAPE is load-bearing.
 */
const GIT_AI = '/Users/example/.git-ai/bin/git-ai';

const nestedBlock = (agent: string): unknown => ({
  matcher: '*',
  hooks: [{ type: 'command', command: `${GIT_AI} checkpoint ${agent} --hook-input stdin` }],
});

const flatEntry = (agent: string, extras: Record<string, unknown> = {}): unknown => ({
  command: `${GIT_AI} checkpoint ${agent} --hook-input stdin`,
  ...extras,
});

/** git-ai's entry, per our agent slug, keyed by ITS detect id in the command. */
export const GIT_AI_SEED_ENTRY: Record<string, (event: string) => unknown> = {
  'claude-code': () => nestedBlock('claude'),
  gemini: () => nestedBlock('gemini'),
  droid: () => nestedBlock('droid'),
  cursor: () => flatEntry('cursor'),
  firebender: () => flatEntry('firebender'),
  // github_copilot.rs:59-69 — a `powershell` variant alongside the posix command.
  'github-copilot': () =>
    flatEntry('github-copilot', {
      type: 'command',
      powershell: `& '${GIT_AI}' checkpoint github-copilot --hook-input stdin`,
    }),
  // windsurf.rs:114-117 — `show_output: false`.
  windsurf: () => flatEntry('windsurf', { show_output: false }),
};
