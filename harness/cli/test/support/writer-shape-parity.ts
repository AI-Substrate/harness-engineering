/**
 * THE ENTRY SHAPE git-ai WRITES FOR EACH AGENT — lifted from its per-agent
 * installer source, NOT from the configs on this machine (plan 082 F005).
 *
 * WHAT THESE CHECKS ARE, STATED BEFORE ANYTHING ELSE (phase-5 review F3). They are
 * HAND-WRITTEN PARITY CHECKS against git-ai's WRITER — not any agent's own schema,
 * and not its runtime behaviour. What they measure is: *does our entry look like the
 * entry the upstream writer produces for this agent?* That is a strong signal and a
 * narrow claim, and the file used to make a wider one by calling itself a schema.
 *
 * THE COST OF THE FALSE NAME CUTS BOTH WAYS. Under "schema", a divergence reads as a
 * defect even when the runtime would accept it — so a correct change could be
 * rejected by a test that never measured the runtime at all.
 *
 * ONE ROW IS DIFFERENT AND IT IS THE ONE THIS FILE WAS BUILT FOR. For CLAUDE-CODE,
 * "invalid" means invalid TO THE RUNTIME, measured: Jordan's machine, the error
 * verbatim below, the whole file skipped. Everywhere else, read "violation" as
 * "diverges from what git-ai writes".
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
 * WHY THE SHAPES ARE DERIVED FROM git-ai's SOURCE. git-ai ships SIXTEEN per-agent
 * installers under `src/mdm/agents/`. Every shape it writes is already written down
 * there. This plan raided that source for the four defects it was fixing and never
 * lifted the SHAPES — then wrote one shape for all seven agents. Reading the configs
 * on this machine is a weaker method for two reasons: it can only describe agents
 * that happen to have a file here (firebender has none), and an installed file
 * records one run of one writer rather than that writer's rule.
 *
 * It is a weaker method than reading each AGENT's own loader would be — and that is
 * not available: several parse their configs in native code. Upstream parity is the
 * best evidence obtainable here, and naming it as such is the point of F3.
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

export interface ShapeDivergence {
  /** Where in the document, e.g. `hooks.PreToolUse[1]`. */
  at: string;
  /**
   * How it diverges from what git-ai writes here.
   *
   * Phrased as a loader would put it because that is the most legible wording, NOT
   * because a loader said it — except for claude-code, where the wording IS the
   * message Claude Code printed on Jordan's machine.
   */
  problem: string;
}

/** Check one whole config document against the shape git-ai writes for that agent. */
export type WriterShapeCheck = (doc: unknown) => ShapeDivergence[];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * The NESTED entry shape — claude-code, gemini, droid.
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
const nestedShape: WriterShapeCheck = (doc) => {
  const violations: ShapeDivergence[] = [];
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
 * The FLAT entry shape — cursor, firebender, github-copilot, windsurf.
 *
 * Every element is the hook itself: a `command` string, and NEVER a `matcher`.
 *
 * The no-matcher part is not guessed. firebender's own installer treats a
 * matcher-bearing entry as NOT INSTALLED (`firebender.rs:66`, `firebender.rs:81`)
 * and REWRITES such an entry to strip it (`firebender.rs:179`, test
 * `firebender.rs:516`). So the upstream writer's rule is explicit here rather than
 * merely observable — which is still a statement about the WRITER. Whether
 * firebender's runtime would reject a matcher is unverified; nothing has ever
 * exercised it.
 */
const flatShape: WriterShapeCheck = (doc) => {
  const violations: ShapeDivergence[] = [];
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
 * Per-agent shape checks, keyed by our slug.
 *
 * THREE NESTED, FOUR FLAT — measured, and NOT the one-nested-exception the first
 * report assumed. Taking claude-code as a special case would have fixed a third of
 * the bug and left gemini and droid broken.
 *
 * EVIDENCE GRADE, PER ROW, because it is not uniform (phase-5 review F3):
 *
 * - **claude-code — RUNTIME-MEASURED.** A divergence here was observed to disable
 *   the whole file, with the error text reproduced verbatim in `nestedShape`.
 * - **every other row — WRITER PARITY.** git-ai writes this shape for this agent
 *   and asserts it in its own tests. Whether the agent's runtime would REJECT a
 *   divergence is UNVERIFIED here; no runtime was exercised.
 */
export const WRITER_SHAPE_CHECKS: Record<string, WriterShapeCheck> = {
  // NESTED — a `matcher` + `hooks` array per block.
  'claude-code': nestedShape, //     claude_code.rs:151-154, 206-209 — RUNTIME-MEASURED
  gemini: nestedShape, //            gemini.rs:162-165, 194-197 — writer parity
  droid: nestedShape, //             droid.rs:183-186, 237-240 — writer parity
  // FLAT — the hook itself, no matcher.
  cursor: flatShape, //              cursor.rs:150-164 — writer parity
  firebender: flatShape, //          firebender.rs:126-141 (matcher stripped: :66, :81, :179)
  'github-copilot': flatShape, //    github_copilot.rs:59-69 — writer parity
  windsurf: flatShape, //            windsurf.rs:114-117 — writer parity
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
