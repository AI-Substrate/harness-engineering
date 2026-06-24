import type { HarnessRecordType } from '../contract.js';

/**
 * The core `segment` record type — the record-system citizen for a counts-only
 * telemetry segment (plan 034 Phase 1, T003). Inline TS constant, mirroring
 * `retro.ts` / `harness-change.ts`.
 *
 * ORTHOGONAL to `services/telemetry/segment.ts` (F5): that module owns the
 * load-bearing buffer/scraper contract (the JSON `Segment` type + serializer +
 * `segment.schema.json`). THIS type only registers `segment` with the record
 * system so the 7-key provenance header can be auto-stamped onto a persisted
 * segment record. The payload itself is the counts-only JSON, which conforms to
 * `segment.schema.json`.
 *
 * The template ships only the template-owned `schema_version`; the CLI splices
 * the 7-key provenance header into this frontmatter at write time. NO content
 * fields ever — the body holds only the allowlisted counts-only JSON payload.
 */
export const SEGMENT_RECORD_TEMPLATE = `---
schema_version: "1.0"
---

# Telemetry segment — <command> @ <timecode>

<!-- A counts-only per-session telemetry segment (plan 034). The machine-written
     payload below conforms to services/telemetry/segment.schema.json — only
     allowlisted counts/identifiers, never prompt/message text, file contents, or
     free-form tool args; paths are repo-relative. The CLI splices the 7-key
     provenance header above at write time. -->

\`\`\`json
{}
\`\`\`
`;

/** The core `segment` record type (always present, even under \`--no-extensions\`). */
export const segmentRecordType: HarnessRecordType = {
  kind: 'record',
  type: 'segment',
  description:
    'Counts-only per-session telemetry segment — tokens/skills/tools/subagents/files/plan-links.',
  template: SEGMENT_RECORD_TEMPLATE,
};
