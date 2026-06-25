/**
 * Pure projections that shrink a raw telemetry capture into a privacy-safe,
 * adapter-faithful fixture (plan 037, Phase 2). No `node:*`, no I/O — the caller
 * (the `.harness/extensions/telemetry-fixtures` run() composition root) reads the
 * raw bytes via injected ports and feeds them here.
 *
 * Single source of truth for the copilot-cli process-log filter (T001/AC-03) and
 * the copilot-vscode row projection (T006/AC-04), so the privacy-critical shrink
 * is unit-tested in one place.
 */

/**
 * A copilot-cli `process-*.log` is a per-PROCESS verbose debug log: it interleaves
 * MANY sessions and embeds huge payloads, but the runtime adapter reads ONLY the
 * `assistant_usage` JSON objects, filtered by their inner `session_id`. So a fixture
 * must keep ONLY this session's `assistant_usage` records — tiny, and with no other
 * session's data.
 *
 * This replicates `copilot-adapter`'s `extractJsonObjects` scan (a JSON block runs
 * from a line starting `{` to a line starting `}`), keeps the matching objects, and
 * re-serializes each as a pretty block the adapter re-parses identically. Token
 * metrics survive the JSON round-trip verbatim.
 */
export function filterCopilotProcessLog(logContent: string, sessionId: string): string {
  const kept: string[] = [];
  let buf: string[] | null = null;
  const consider = (lines: string[]): void => {
    try {
      const obj = JSON.parse(lines.join('\n')) as Record<string, unknown>;
      if (obj.kind === 'assistant_usage' && obj.session_id === sessionId) {
        kept.push(JSON.stringify(obj, null, 2));
      }
    } catch {
      // not a JSON object (debug noise / pretty-printed array) — skip, as the adapter does
    }
  };
  for (const raw of logContent.split('\n')) {
    if (buf === null) {
      if (raw.startsWith('{')) {
        buf = [raw];
        if (raw.trimEnd().endsWith('}')) {
          consider(buf);
          buf = null;
        }
      }
    } else {
      buf.push(raw);
      if (raw.startsWith('}')) {
        consider(buf);
        buf = null;
      }
    }
  }
  return kept.length > 0 ? `${kept.join('\n')}\n` : '';
}

/** The placeholder swapped in for a redacted system-prompt body. */
export const SYSTEM_PROMPT_PLACEHOLDER = '<redacted: vendor system prompt>';

/**
 * Replace the body of a copilot-cli `system.message` event (the vendor's ~33KB
 * proprietary system prompt) with a short placeholder, keeping the event envelope
 * (type/id/timestamp/parentId/role). The runtime adapter never reads `system.message`
 * — it consumes `user.message`/`tool.execution_*`/`assistant.turn_*`/etc — so the
 * serialized segment is byte-identical; this only shrinks the fixture (~100KB → ~5KB)
 * and avoids republishing a proprietary prompt. User prompts stay verbatim.
 */
export function redactCopilotSystemMessage(eventsJsonl: string): string {
  return eventsJsonl
    .split('\n')
    .map((line) => {
      if (line.trim() === '') return line;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return line; // not JSON — leave untouched
      }
      if (obj.type !== 'system.message') return line;
      const data = obj.data;
      if (data !== null && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        for (const k of ['content', 'text', 'message']) {
          if (typeof d[k] === 'string') d[k] = SYSTEM_PROMPT_PLACEHOLDER;
        }
      }
      return JSON.stringify(obj);
    })
    .join('\n');
}
