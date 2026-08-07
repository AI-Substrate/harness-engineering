/**
 * The CLOSED registry of Cursor (`cursor-agent`) tool names → the role each plays
 * (FX009). ONE table, read by BOTH sides:
 *
 *  • capture-side — {@link ../cursor-adapter} dispatches file-event extraction on
 *    {@link cursorToolRole} rather than a chain of hardcoded name comparisons;
 *  • read-side — `session-export` classifies segments ALREADY on the wire to
 *    decide whether a window's write-shaped calls produced any `file` events.
 *
 * They must not drift into two lists. A duplicate control is not redundancy, it
 * is a future argument.
 *
 * WHY CLOSED. Cursor has already renamed its whole toolset more than once on this
 * machine — a June session speaks `Read` + `Glob`, three August sessions speak
 * `ReadFile` + `ApplyPatch`, and the FX009 specimen speaks `Read` + `Grep` +
 * `Write`/`StrReplace` + `Await` — and the newer builds do NOT move in one
 * direction (the longer name appeared later, then the shorter one came back). All
 * of them are live simultaneously and `ApplyPatch` is NEVER deprecated. Any name
 * absent from the table is {@link CURSOR_TOOL_UNKNOWN}, which is the point:
 * absence is loud, so the next rename surfaces as a named gap instead of a silent
 * zero.
 *
 * EVIDENCE CLASS is recorded per entry, deliberately:
 *  • `observed` — seen in a Cursor transcript on this machine;
 *  • `adapter`  — named by this repo's own cursor adapter code.
 *
 * `Write`/`StrReplace` entered as INHERITED — UNVERIFIED (an external report, with
 * no local specimen able to refuse a wrong guess) and were later CONFIRMED against
 * the reporter's scrubbed transcript: `Write` carries `{contents, path}` and
 * `StrReplace` carries `{old_string, new_string, path}`. The read-side
 * empty-extraction counter that guarded the guess stays regardless — a confirmed
 * shape today is the next build's rename.
 */

/** The role a Cursor tool plays. `unknown` is not in the table — it IS the absence. */
export type CursorToolRole = 'write' | 'read' | 'shell' | 'other' | 'unknown';

/** The role of a tool name the registry does not carry — the rename signal. */
export const CURSOR_TOOL_UNKNOWN: CursorToolRole = 'unknown';

/**
 * Every KNOWN Cursor tool name. Extend this — never a call site — when Cursor
 * renames or adds a tool.
 */
const CURSOR_TOOL_ROLES: Readonly<Record<string, Exclude<CursorToolRole, 'unknown'>>> = {
  // --- write: the tools that can change a file's bytes -------------------------
  ApplyPatch: 'write', // observed (Aug vocabulary) — raw V4A patch STRING input
  Write: 'write', // observed (FX009 specimen) — object input `{contents, path}`
  StrReplace: 'write', // observed (FX009 specimen) — object `{old_string, new_string, path}`

  // --- read ------------------------------------------------------------------
  Read: 'read', // observed (Jun + Write/StrReplace vocabularies)
  ReadFile: 'read', // observed (Aug vocabulary)
  Glob: 'read', // observed (every vocabulary)
  Grep: 'read', // observed (Write/StrReplace vocabulary specimen)
  ReadLints: 'read', // observed (Aug vocabulary)

  // --- shell -----------------------------------------------------------------
  Shell: 'shell', // observed (every vocabulary)
  AwaitShell: 'shell', // observed (Aug vocabulary)
  Await: 'shell', // observed (Write/StrReplace vocabulary specimen — AwaitShell renamed)
  Bash: 'shell', // adapter — the cursor adapter's own shell-signature branch names it

  // --- other -----------------------------------------------------------------
  GetMcpTools: 'other', // observed (Aug vocabulary)
  Skill: 'other', // adapter — the cursor adapter's own skill branch names it
};

/**
 * The role of one Cursor tool name. `unknown` for ANY name the registry does not
 * carry — including a renamed write tool, which is exactly the case the read-side
 * counter has to stay loud about.
 */
export function cursorToolRole(name: string): CursorToolRole {
  return CURSOR_TOOL_ROLES[name] ?? CURSOR_TOOL_UNKNOWN;
}

/**
 * Could this call have CHANGED a file? True for a known write tool AND for an
 * unknown name — an unrecognised tool is treated as write-capable, because the
 * one thing we know about a name we do not recognise is that we cannot rule it
 * out. Used read-side to decide whether a window with zero `file` events is a
 * measured zero or an unmeasured gap.
 */
export function mayWriteFiles(name: string): boolean {
  const role = cursorToolRole(name);
  return role === 'write' || role === 'unknown';
}

/** The known tool names, for tests + diagnostics. Order is not significant. */
export function knownCursorTools(): string[] {
  return Object.keys(CURSOR_TOOL_ROLES);
}
