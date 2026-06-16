/**
 * The entry grammar for the transient observation buffer (plan 015 D2): the
 * exact YAML-blocks-in-markdown shape the old observe skill taught, kept so
 * legacy hand-written buffers parse natively (D3). The CLI is the sole writer
 * going forward — a constrained serializer (flat fields + the `system.compound`
 * block, stable field order) paired with a tolerant line-based parser. No
 * `yaml` runtime dependency: the grammar is a small contract and the
 * npx-installed core stays at commander+jiti only (constitution P10).
 */

/**
 * The 8 universal-schema kinds and their ID prefixes (workshop 005 § D5/D6;
 * `win` added plan 020 Phase 2 as the positive counterpart to `difficulty`).
 */
export const OBSERVATION_KINDS = {
  difficulty: 'DL',
  'magic-wand': 'MW',
  gift: 'GFT',
  insight: 'INS',
  coordination: 'COORD',
  'improvement-suggestion': 'SUGG',
  confusion: 'CONF',
  win: 'WIN',
} as const;

export type ObservationKind = keyof typeof OBSERVATION_KINDS;

export const OBSERVATION_SEVERITIES = ['blocking', 'degrading', 'annoying'] as const;

export interface ObservationEntry {
  id: string;
  kind: string;
  description: string;
  target?: string;
  severity?: string;
  workaround?: string;
  suggested_encoding?: string;
  /** From the nested `system.compound` block. */
  first_seen_at?: string;
}

/** `<PREFIX>-<3+ digits>` per workshop 005 § D6 — anything else is a deviant block. */
const ID_PATTERN = /^[A-Z]+-\d{3,}$/;

/** The flat entry fields (plus first_seen_at from the nested block), any indent. */
const FIELD_PATTERN =
  /^\s+(kind|description|target|severity|workaround|suggested_encoding|first_seen_at):\s*(.*)$/;

/**
 * Serialize one entry as an append-ready YAML block — identical in shape to the
 * old skill's template, including the full `system.compound` lifecycle block
 * (D10) so drained entries carry the fields the harvest already expects.
 */
export function serializeEntry(entry: ObservationEntry): string {
  const lines = [
    `- id: ${entry.id}`,
    `  kind: ${entry.kind}`,
    `  description: ${JSON.stringify(entry.description)}`,
  ];
  if (entry.target !== undefined) lines.push(`  target: ${entry.target}`);
  if (entry.severity !== undefined) lines.push(`  severity: ${entry.severity}`);
  if (entry.workaround !== undefined) {
    lines.push(`  workaround: ${JSON.stringify(entry.workaround)}`);
  }
  if (entry.suggested_encoding !== undefined) {
    lines.push(`  suggested_encoding: ${JSON.stringify(entry.suggested_encoding)}`);
  }
  lines.push(
    '  system:',
    '    compound:',
    '      status: open',
    '      source: agent-self',
    `      first_seen_at: "${entry.first_seen_at ?? ''}"`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Tolerant parse of a whole buffer: split on `- id:` block starts; a block that
 * fails to parse or lacks a required field (valid id, known kind, non-empty
 * description) counts as *malformed* — skipped, counted, and returned RAW in
 * `deviant` so callers can preserve it on disk (D3: nothing is silently
 * dropped, not even by `--clear`). Non-blank content before the first block
 * counts as one malformed chunk.
 */
export function parseBuffer(content: string): {
  entries: ObservationEntry[];
  malformed: number;
  deviant: string[];
} {
  const entries: ObservationEntry[] = [];
  const deviant: string[] = [];
  let malformed = 0;
  if (content.trim().length === 0) {
    return { entries, malformed, deviant };
  }

  const lines = content.split('\n');
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (line.startsWith('- id:')) starts.push(i);
  });

  const preamble = lines.slice(0, starts[0] ?? lines.length).join('\n');
  if (preamble.trim().length > 0) {
    malformed += 1;
    deviant.push(preamble);
  }

  for (let s = 0; s < starts.length; s++) {
    const startLine = starts[s] as number;
    const block = lines.slice(startLine, starts[s + 1] ?? lines.length);
    const entry = parseBlock(block);
    if (entry === null) {
      malformed += 1;
      deviant.push(block.join('\n'));
    } else {
      entries.push(entry);
    }
  }
  return { entries, malformed, deviant };
}

function parseBlock(block: string[]): ObservationEntry | null {
  const id = bareValue((block[0] ?? '').slice('- id:'.length));
  const fields: Record<string, string> = {};
  for (const line of block.slice(1)) {
    const m = FIELD_PATTERN.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined && !(m[1] in fields)) {
      fields[m[1]] = unquote(m[2]);
    }
  }
  const { kind, description } = fields;
  if (!ID_PATTERN.test(id) || kind === undefined || !(kind in OBSERVATION_KINDS)) {
    return null;
  }
  if (description === undefined || description.length === 0) {
    return null;
  }
  return {
    id,
    kind,
    description,
    ...(fields.target !== undefined && { target: fields.target }),
    ...(fields.severity !== undefined && { severity: fields.severity }),
    ...(fields.workaround !== undefined && { workaround: fields.workaround }),
    ...(fields.suggested_encoding !== undefined && {
      suggested_encoding: fields.suggested_encoding,
    }),
    ...(fields.first_seen_at !== undefined && { first_seen_at: fields.first_seen_at }),
  };
}

/** Quoted values are JSON strings; bare values may carry the old template's inline `# comments`. */
function unquote(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(trimmed);
    if (m !== null) {
      try {
        return JSON.parse(`"${m[1]}"`) as string;
      } catch {
        return m[1] ?? '';
      }
    }
    return trimmed;
  }
  return bareValue(trimmed);
}

/** Strip an unquoted trailing ` # comment` (the old skill's template carried them inline). */
function bareValue(raw: string): string {
  return (raw.split(/\s+#/)[0] ?? raw).trim();
}
