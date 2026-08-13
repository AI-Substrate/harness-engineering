/**
 * COPILOT'S OWN PUBLISHED HOOK CONTRACT — the vendor's, not a sibling writer's.
 *
 * WHY THIS FILE EXISTS, STATED BEFORE ANYTHING ELSE. `writer-shape-parity.ts` asks
 * *does our entry look like the entry git-ai produces?* That is a real signal and it
 * is honestly labelled there. But it is a DIFFERENTIAL CHECK BETWEEN TWO THINGS WE
 * WROTE — us and one peer — and such a check is structurally blind to any defect the
 * two share. Both writers emit `{command, type, powershell}` for copilot and neither
 * emits `bash`; a parity check between them reports agreement, forever, whatever
 * copilot actually requires.
 *
 * So every check we owned asked "does this match git-ai?" and none asked "does the
 * vendor accept it?". This file asks the second question.
 *
 * THE SOURCE IS PUBLIC, AND THAT IS THE OTHER HALF OF THE LESSON. Plan 082 recorded
 * copilot's schema as UNKNOWABLE because it "is not readable from its JS bundle" —
 * true of the 1.x native binary, and irrelevant, because GitHub publishes the whole
 * thing:
 *
 *   https://docs.github.com/en/copilot/reference/hooks-reference
 *
 * "Unreadable from that one file" was allowed to mean "unknowable", and a question
 * (082's Q1) shipped open on that basis. The rules below are transcribed from the
 * vendor's field table, with each rule's grade recorded on it.
 *
 * WHAT THIS IS STILL NOT. It is the vendor's DOCUMENTED contract, not their runtime.
 * A document can be wrong or stale, and where the docs and a measurement disagree the
 * MEASUREMENT wins and says so on the rule. Three rules below are corroborated by a
 * live probe of the real copilot 1.0.79 binary (2026-08-13, macOS, four hook files in
 * `.github/hooks/`, one marker file per field, re-run with `pwsh` masked off PATH):
 *
 *   entry shape                             marker that fired
 *   {command, type, powershell} (ours)      command
 *   {command, powershell} + version 1       command
 *   {bash, powershell} + version 1          bash
 *   {command} + version 1                   command
 *
 * That probe is why `command` is accepted as populating the unix slot rather than
 * merely tolerated: the copy is applied PER FIELD, and an explicit `powershell` does
 * not suppress it.
 */

/** One way a document departs from the published contract. */
export interface SchemaViolation {
  /** Where, e.g. `hooks.PreToolUse[0]`. */
  at: string;
  /** What rule it breaks, in the vendor's own terms. */
  problem: string;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Check a whole copilot hook document against the published contract.
 *
 * Returns EVERY violation rather than the first, because an entry can break more
 * than one rule and a reader fixing them one run at a time is a reader we have made
 * work for nothing.
 */
export function copilotSchemaViolations(doc: unknown): SchemaViolation[] {
  const violations: SchemaViolation[] = [];
  const root = asRecord(doc);
  if (root === null) return [{ at: '<root>', problem: 'Expected a JSON object' }];

  /*
   * RULE — `version`, WHEN PRESENT, must be 1.
   *
   * GRADE: documented, and deliberately NOT asserted as required. The vendor says a
   * "bad `version`" rejects the entire file, and every published example carries
   * `"version": 1` — but our shipped file omits it, and the probe measured an
   * omitted version LOADING AND FIRING on 1.0.79. Absent and wrong are different
   * facts and only the second is documented as fatal, so only the second is a
   * violation here. This is the one rule where our own shape sits in a gap between
   * the documentation and a measurement, and it is recorded rather than resolved.
   */
  if (root.version !== undefined && root.version !== 1) {
    violations.push({
      at: 'version',
      problem: `Expected 1, got ${JSON.stringify(root.version)} — a bad version rejects the whole file`,
    });
  }

  const hooks = asRecord(root.hooks);
  if (hooks === null) return [...violations, { at: 'hooks', problem: 'Expected an object' }];

  for (const [event, entries] of Object.entries(hooks)) {
    // RULE — every event value is an ARRAY. GRADE: documented; a non-array event
    // list is named as one of the three structural errors that reject the file.
    if (!Array.isArray(entries)) {
      violations.push({ at: `hooks.${event}`, problem: 'Expected an array' });
      continue;
    }

    entries.forEach((raw, index) => {
      const at = `hooks.${event}[${index}]`;
      const entry = asRecord(raw);
      if (entry === null) {
        violations.push({ at, problem: 'Expected an object' });
        return;
      }

      // RULE — `type` is optional and defaults to "command"; when present it must
      // name a hook kind the vendor implements. GRADE: documented.
      const type = entry.type;
      if (type !== undefined && type !== 'command' && type !== 'http' && type !== 'prompt') {
        violations.push({
          at: `${at}.type`,
          problem: `Expected "command", "http" or "prompt", got ${JSON.stringify(type)}`,
        });
      }
      if (type === 'http' || type === 'prompt') return;

      /*
       * RULE — a command hook carries at least one of `bash`, `powershell`,
       * `command`. GRADE: documented, quoted verbatim in the vendor's field table as
       * the requiredness of all three ("One of `bash`, `powershell`, or `command`").
       */
      const shells = ['bash', 'powershell', 'command'].filter(
        (field) => typeof entry[field] === 'string',
      );
      if (shells.length === 0) {
        violations.push({
          at,
          problem: 'A command hook must carry at least one of `bash`, `powershell` or `command`',
        });
        return;
      }

      /*
       * RULE — THE UNIX SLOT MUST BE POPULATED: `bash`, or `command` as the
       * documented cross-platform fallback.
       *
       * GRADE: documented AND probe-corroborated, and it is the rule this whole file
       * was built to carry. An entry holding only `powershell` is a well-formed
       * document that cannot run on Linux or macOS — and it is exactly the shape a
       * platform-gated `powershell` field would produce if someone "fixed" the
       * variant by emitting it alone. Nothing in a git-ai parity check can see this,
       * because git-ai does not emit `bash` either.
       *
       * The vendor's cloud-agent section is the unambiguous half: "Only the `bash`
       * field on command hooks is honored; `powershell` entries are ignored. The
       * cross-platform `command` field is honored as a fallback."
       */
      if (typeof entry.bash !== 'string' && typeof entry.command !== 'string') {
        violations.push({
          at,
          problem:
            'No unix invocation: needs `bash`, or `command` as the cross-platform fallback — a `powershell`-only entry cannot run on Linux or macOS',
        });
      }

      // RULE — the optional scalars are the types the vendor documents.
      if (entry.cwd !== undefined && typeof entry.cwd !== 'string') {
        violations.push({ at: `${at}.cwd`, problem: 'Expected a string' });
      }
      if (entry.env !== undefined && asRecord(entry.env) === null) {
        violations.push({ at: `${at}.env`, problem: 'Expected an object' });
      }
      for (const field of ['timeoutSec', 'timeout']) {
        if (entry[field] !== undefined && typeof entry[field] !== 'number') {
          violations.push({ at: `${at}.${field}`, problem: 'Expected a number' });
        }
      }
    });
  }

  return violations;
}
