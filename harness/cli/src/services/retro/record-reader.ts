import type { FsPort } from '../../adapters/fs/fs-port.js';
import { posixJoin, posixRelative, toPosix } from '../shared/posix-path.js';

export type RetroSource = 'canonical' | 'agents' | 'retros';

export interface RetroEntry {
  id: string;
  kind: string;
  description: string;
  target?: string;
  severity?: string;
  workaround?: string;
  suggested_encoding?: string;
  disposition?: string;
  fp?: string;
  status: string;
  first_seen_at?: string;
  resolved_by?: string;
}

export interface RetroRecord {
  schema_version: string;
  retro_id: string;
  agent: string;
  plan_id: string | null;
  started_at: string;
  ended_at?: string;
  summary?: string;
  entries: RetroEntry[];
  source: RetroSource;
  record_path: string;
}

export interface RetroReadFilters {
  plans?: string[];
  since?: string;
  kinds?: string[];
  agents?: string[];
}

export interface RetroSourceCounts {
  scanned: number;
  parsed: number;
  included: number;
  deduped: number;
}

export interface UnsupportedRetroVersion {
  path: string;
  schema_version: string;
}

export interface RetroReadResult {
  records: RetroRecord[];
  malformed_skipped: number;
  unsupported_versions: UnsupportedRetroVersion[];
  sources: Record<RetroSource, RetroSourceCounts>;
}

export interface ReadRetroRecordsOptions {
  fs: FsPort;
  repoRoot: string;
  filters?: RetroReadFilters;
}

interface SourceSpec {
  source: RetroSource;
  root: string;
  suffix: string;
  recursive: boolean;
}

interface ParsedFrontmatter {
  fields: Record<string, string | null>;
  entryLines: string[];
}

interface CollectedScalar {
  raw: string;
  end: number;
  malformed?: boolean;
}

interface YamlPathNode {
  key: string;
  indent: number;
}

const SUPPORTED_MAJOR = 1;
const TEXT_FIELDS = new Set(['description', 'workaround', 'suggested_encoding']);
const ENTRY_FIELD_PATTERN =
  /^\s+(kind|description|target|severity|workaround|suggested_encoding|disposition|fp):\s*(.*)$/;
const ENTRY_MAPPING_PATTERN = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;
const LIFECYCLE_FIELD_NAMES = ['status', 'first_seen_at', 'resolved_by'] as const;
type LifecycleFieldName = (typeof LIFECYCLE_FIELD_NAMES)[number];
const LIFECYCLE_FIELDS = new Set<string>(LIFECYCLE_FIELD_NAMES);
const TOP_FIELD_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/;

export function readRetroRecords(options: ReadRetroRecordsOptions): RetroReadResult {
  const repoRoot = toPosix(options.repoRoot).replace(/\/+$/, '');
  const specs: SourceSpec[] = [
    {
      source: 'canonical',
      root: posixJoin(repoRoot, '.harness', 'records', 'retro'),
      suffix: '.md',
      recursive: true,
    },
    {
      source: 'agents',
      root: posixJoin(repoRoot, 'docs', 'harness', 'agents'),
      suffix: '.retro.md',
      recursive: true,
    },
    {
      source: 'retros',
      root: posixJoin(repoRoot, 'docs', 'retros'),
      suffix: '.md',
      recursive: false,
    },
  ];
  const sources = emptySourceCounts();
  const unsupported_versions: UnsupportedRetroVersion[] = [];
  const records: RetroRecord[] = [];
  const seenRetroIds = new Set<string>();
  let malformed_skipped = 0;

  for (const spec of specs) {
    for (const path of collectFiles(options.fs, spec)) {
      const relativePath = posixRelative(repoRoot, path);
      sources[spec.source].scanned += 1;
      const content = options.fs.readText(path);
      if (content === null) {
        malformed_skipped += 1;
        continue;
      }
      const parsed = parseRetro(content, spec.source, relativePath);
      if (parsed === null) {
        malformed_skipped += 1;
        continue;
      }
      const version = schemaVersion(parsed.schema_version);
      if (version === null) {
        malformed_skipped += 1;
        continue;
      }
      if (version.major !== SUPPORTED_MAJOR) {
        unsupported_versions.push({ path: relativePath, schema_version: parsed.schema_version });
        continue;
      }
      sources[spec.source].parsed += 1;
      if (seenRetroIds.has(parsed.retro_id)) {
        sources[spec.source].deduped += 1;
        continue;
      }
      seenRetroIds.add(parsed.retro_id);
      const filtered = applyFilters(parsed, options.filters ?? {});
      if (filtered === null) continue;
      sources[spec.source].included += 1;
      records.push(filtered);
    }
  }

  records.sort(
    (a, b) =>
      a.started_at.localeCompare(b.started_at) ||
      a.retro_id.localeCompare(b.retro_id) ||
      a.record_path.localeCompare(b.record_path),
  );
  return { records, malformed_skipped, unsupported_versions, sources };
}

function emptySourceCounts(): Record<RetroSource, RetroSourceCounts> {
  return {
    canonical: { scanned: 0, parsed: 0, included: 0, deduped: 0 },
    agents: { scanned: 0, parsed: 0, included: 0, deduped: 0 },
    retros: { scanned: 0, parsed: 0, included: 0, deduped: 0 },
  };
}

function collectFiles(fs: FsPort, spec: SourceSpec): string[] {
  const found = new Set<string>();
  const seen = new Set<string>();
  const walk = (path: string): void => {
    const normalized = toPosix(path);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    for (const name of fs.readdir(normalized).slice().sort()) {
      const child = posixJoin(normalized, name);
      if (name.endsWith('.legacy.md')) continue;
      if (name.endsWith(spec.suffix)) {
        found.add(child);
      } else if (spec.recursive) {
        walk(child);
      }
    }
  };
  walk(spec.root);
  return [...found].sort();
}

function parseRetro(content: string, source: RetroSource, recordPath: string): RetroRecord | null {
  const frontmatter = splitFrontmatter(content);
  if (frontmatter === null) return null;
  const schema_version = field(frontmatter.fields, 'schema_version');
  const retro_id = field(frontmatter.fields, 'retro_id');
  const agent = field(frontmatter.fields, 'agent');
  const started_at = field(frontmatter.fields, 'started_at');
  if (
    schema_version === undefined ||
    retro_id === undefined ||
    agent === undefined ||
    started_at === undefined
  ) {
    return null;
  }
  const plan_id = frontmatter.fields.plan_id ?? null;
  const entries = parseEntries(frontmatter.entryLines);
  if (entries === null) return null;
  const record: RetroRecord = {
    schema_version,
    retro_id,
    agent,
    plan_id,
    started_at,
    entries,
    source,
    record_path: recordPath,
  };
  const ended_at = field(frontmatter.fields, 'ended_at');
  const summary = field(frontmatter.fields, 'summary');
  if (ended_at !== undefined) record.ended_at = ended_at;
  if (summary !== undefined) record.summary = summary;
  return record;
}

function splitFrontmatter(content: string): ParsedFrontmatter | null {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return null;
  const body = lines.slice(1, end);
  const fields: Record<string, string | null> = {};
  let entriesAt = -1;
  for (let i = 0; i < body.length; i++) {
    const line = body[i] ?? '';
    if (/^entries:\s*$/.test(line)) {
      entriesAt = i + 1;
      break;
    }
    const match = TOP_FIELD_PATTERN.exec(line);
    if (match?.[1] === undefined || match[2] === undefined) continue;
    const collected = collectScalar(body, i, match[2], 0, match[1]);
    if (collected.malformed) return null;
    i = collected.end;
    fields[match[1]] = parseScalar(collected.raw);
  }
  return { fields, entryLines: entriesAt < 0 ? [] : body.slice(entriesAt) };
}

function parseEntries(lines: string[]): RetroEntry[] | null {
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s+id:\s*/.test(lines[i] ?? '')) starts.push(i);
  }
  const entries: RetroEntry[] = [];
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index] as number;
    const end = starts[index + 1] ?? topLevelTail(lines, start + 1);
    const parsed = parseEntry(lines.slice(start, end));
    if (parsed === null) return null;
    entries.push(parsed);
  }
  return entries;
}

function topLevelTail(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (TOP_FIELD_PATTERN.test(lines[i] ?? '')) return i;
  }
  return lines.length;
}

function parseEntry(lines: string[]): RetroEntry | null {
  const idMatch = /^\s*-\s+id:\s*(.*)$/.exec(lines[0] ?? '');
  const id = idMatch?.[1] === undefined ? '' : parseScalar(idMatch[1]);
  if (id === null || id.length === 0) return null;
  const fields: Record<string, string | null> = {};
  const compoundLifecycle: Record<string, string | null> = {};
  const legacyLifecycle: Record<string, string | null> = {};
  const path: YamlPathNode[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const mapping = ENTRY_MAPPING_PATTERN.exec(line);
    if (mapping?.[1] === undefined || mapping[2] === undefined) continue;
    const indent = leadingSpaces(line);
    while (path.at(-1) !== undefined && indent <= (path.at(-1)?.indent ?? -1)) path.pop();
    const name = mapping[1];
    const raw = mapping[2];
    if (name === 'compound' && pathMatches(path, 'system')) {
      parseInlineCompound(raw, compoundLifecycle);
    }
    if (isLifecycleField(name)) {
      const lifecycleFields = pathMatches(path, 'system', 'compound')
        ? compoundLifecycle
        : path.length === 0
          ? legacyLifecycle
          : null;
      if (lifecycleFields !== null && !(name in lifecycleFields)) {
        const collected = collectScalar(lines, i, raw, indent, name);
        if (collected.malformed) return null;
        i = collected.end;
        lifecycleFields[name] = parseScalar(collected.raw);
      }
    }
    const match = ENTRY_FIELD_PATTERN.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      const collected = collectScalar(lines, i, match[2], indent, match[1]);
      if (collected.malformed) return null;
      i = collected.end;
      if (!(match[1] in fields)) fields[match[1]] = parseScalar(collected.raw);
    }
    if (raw.trim().length === 0) path.push({ key: name, indent });
  }
  const kind = field(fields, 'kind');
  const description = field(fields, 'description');
  if (kind === undefined || description === undefined || description.length === 0) return null;
  const entry: RetroEntry = {
    id,
    kind,
    description,
    status: lifecycleField(compoundLifecycle, legacyLifecycle, 'status') ?? 'other',
  };
  assignOptional(entry, fields, [
    'target',
    'severity',
    'workaround',
    'suggested_encoding',
    'disposition',
    'fp',
  ]);
  for (const name of ['first_seen_at', 'resolved_by'] as const) {
    const value = lifecycleField(compoundLifecycle, legacyLifecycle, name);
    if (value !== undefined) entry[name] = value;
  }
  return entry;
}

function parseInlineCompound(raw: string, fields: Record<string, string | null>): void {
  if (!raw.trim().startsWith('{')) return;
  for (const name of LIFECYCLE_FIELD_NAMES) {
    const match = new RegExp(`\\b${name}:\\s*("[^"]*"|'(?:[^']|'')*'|[^,}]+)`).exec(raw);
    if (match?.[1] !== undefined && !(name in fields)) fields[name] = parseScalar(match[1]);
  }
}

function pathMatches(path: YamlPathNode[], ...keys: string[]): boolean {
  return path.length === keys.length && path.every((node, index) => node.key === keys[index]);
}

function isLifecycleField(name: string): name is LifecycleFieldName {
  return LIFECYCLE_FIELDS.has(name);
}

function lifecycleField(
  compound: Record<string, string | null>,
  legacy: Record<string, string | null>,
  name: LifecycleFieldName,
): string | undefined {
  return field(compound, name) ?? field(legacy, name);
}

function collectScalar(
  lines: string[],
  start: number,
  raw: string,
  indent: number,
  fieldName: string,
): CollectedScalar {
  const trimmed = stripYamlComment(raw.trim()).trim();
  if (trimmed === '>' || trimmed === '|') {
    return collectIndented(lines, start, indent, '');
  }
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && !quoteClosed(trimmed, quote)) {
    return collectUntilQuote(lines, start, trimmed, quote, indent);
  }
  if (TEXT_FIELDS.has(fieldName) && trimmed.length > 0) {
    return collectIndented(lines, start, indent, trimmed);
  }
  return { raw: trimmed, end: start };
}

function collectIndented(
  lines: string[],
  start: number,
  indent: number,
  initial: string,
): CollectedScalar {
  const parts = initial.length > 0 ? [initial] : [];
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    const next = lines[i] ?? '';
    if (next.trim().length === 0) {
      end = i;
      continue;
    }
    if (leadingSpaces(next) <= indent || /^\s*-\s+id:/.test(next)) break;
    parts.push(next.trim());
    end = i;
  }
  return { raw: parts.join(' '), end };
}

function collectUntilQuote(
  lines: string[],
  start: number,
  initial: string,
  quote: string,
  indent: number,
): CollectedScalar {
  const parts = [initial];
  let end = start;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const next = line.trim();
    if (
      next.length > 0 &&
      leadingSpaces(line) <= indent &&
      /^\s*(?:-\s+id|[A-Za-z_][A-Za-z0-9_]*):/.test(line)
    ) {
      return { raw: parts.join(' '), end, malformed: true };
    }
    parts.push(next);
    end = i;
    if (quoteClosed(parts.join(' '), quote)) break;
  }
  const raw = parts.join(' ');
  return { raw, end, malformed: !quoteClosed(raw, quote) };
}

function quoteClosed(value: string, quote: string): boolean {
  const uncommented = stripYamlComment(value.trim()).trim();
  if (!uncommented.startsWith(quote) || uncommented.length < 2) return true;
  if (quote === "'") {
    return uncommented.endsWith("'") && !uncommented.endsWith("''");
  }
  let escapes = 0;
  for (let i = uncommented.length - 2; i >= 0 && uncommented[i] === '\\'; i--) escapes += 1;
  return uncommented.endsWith('"') && escapes % 2 === 0;
}

function parseScalar(raw: string): string | null {
  const trimmed = stripYamlComment(raw.trim()).trim();
  if (trimmed === 'null' || trimmed === '~') return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function stripYamlComment(value: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote === '"') {
      if (char === '"' && !isEscaped(value, i)) quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && value[i + 1] === "'") {
        i += 1;
      } else if (char === "'") {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#' && (i === 0 || /\s/.test(value[i - 1] ?? ''))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trimEnd();
}

function isEscaped(value: string, index: number): boolean {
  let escapes = 0;
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i--) escapes += 1;
  return escapes % 2 === 1;
}

function field(fields: Record<string, string | null>, name: string): string | undefined {
  const value = fields[name];
  return value === null || value === undefined || value.length === 0 ? undefined : value;
}

function assignOptional(
  target: RetroEntry,
  fields: Record<string, string | null>,
  names: Array<keyof Omit<RetroEntry, 'id' | 'kind' | 'description' | 'status'>>,
): void {
  for (const name of names) {
    const value = field(fields, name);
    if (value !== undefined) target[name] = value;
  }
}

function schemaVersion(value: string): { major: number; minor: number } | null {
  const match = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { major: Number.parseInt(match[1], 10), minor: Number.parseInt(match[2], 10) };
}

function applyFilters(record: RetroRecord, filters: RetroReadFilters): RetroRecord | null {
  if (filters.plans !== undefined && !filters.plans.includes(record.plan_id ?? '')) return null;
  if (filters.agents !== undefined && !filters.agents.includes(record.agent)) return null;
  if (filters.since !== undefined) {
    const since = Date.parse(filters.since);
    const started = Date.parse(record.started_at);
    if (!Number.isFinite(since) || !Number.isFinite(started) || started < since) return null;
  }
  if (filters.kinds === undefined) return record;
  const entries = record.entries.filter((entry) => filters.kinds?.includes(entry.kind));
  return entries.length === 0 ? null : { ...record, entries };
}

function leadingSpaces(value: string): number {
  return /^\s*/.exec(value)?.[0].length ?? 0;
}
