import type { RetroEntry, RetroRecord } from './record-reader.js';

export const RETRO_INSIGHTS_SCHEMA_VERSION = 'harness.retro-insights/v1' as const;
export const N_THRESHOLD = 5;

const KNOWN_KINDS = [
  'difficulty',
  'magic-wand',
  'gift',
  'insight',
  'coordination',
  'improvement-suggestion',
  'confusion',
  'win',
] as const;
const KNOWN_STATUSES = ['open', 'suggested', 'encoded', 'wontfix', 'stale'] as const;
const KNOWN_DISPOSITIONS = [
  'fixed-now',
  'task',
  'plan',
  'diffs',
  'command',
  'kept',
  'declined',
  'deferred',
] as const;
const PROOF_TARGETS = new Set([
  'project-sensor',
  'runtime-inspectability',
  'architecture-fitness',
  'security',
  'schema',
]);
const PROOF_KEYWORDS =
  /\b(smoke|screenshot|logs?|traces?|health|dependency[- ]rule|codeql|schema(?:\s+check)?|eyeballed|read(?:\s+code)?\s+manually)\b/i;
const MAGIC_WAND_COMMAND = /\b(check|diagnostic|command)\b/i;
const DAY_MS = 86_400_000;

export interface InsightRow {
  claim: string;
  measures_used: string[];
  n: number;
  interval?: string;
  caveat: string;
  values: Record<string, number | string | null>;
}

export interface SectionSuppression {
  rows: number;
  reason: string;
}

export interface InsightSection<Row extends InsightRow = InsightRow> {
  id: string;
  title: string;
  available: boolean;
  rows: Row[];
  suppressed?: SectionSuppression;
  note?: string;
}

export interface RetroClusterMember {
  record_path: string;
  retro_id: string;
  entry_id: string;
  status: string;
}

export interface RetroClusterRow extends InsightRow {
  kind: string;
  target: string;
  severity: string | null;
  first_seen_at: string | null;
  proof_gap: boolean;
  proof_gap_signal?: 'target' | 'keyword';
  repeatedly_deferred: boolean;
  members: RetroClusterMember[];
}

export interface RetroStaleRow extends InsightRow {
  record_path: string;
  retro_id: string;
  entry_id: string;
  status: string;
}

export interface RetroHeadline {
  records: number;
  entries: number;
  plans_touched: string[];
  agents: string[];
  date_range: { from: string | null; to: string | null };
  status_counts: Record<(typeof KNOWN_STATUSES)[number] | 'other', number>;
  kind_counts: Record<(typeof KNOWN_KINDS)[number] | 'other', number>;
  disposition_counts: Record<(typeof KNOWN_DISPOSITIONS)[number] | 'unspecified', number>;
  open_to_encoded_ratio: string;
}

export interface RetroInsightsDocument {
  schema_version: typeof RETRO_INSIGHTS_SCHEMA_VERSION;
  generated_at: string;
  headline: RetroHeadline;
  sections: {
    totals: InsightSection;
    top_clusters: InsightSection<RetroClusterRow>;
    stale: InsightSection<RetroStaleRow>;
    disposition_mix_records: InsightSection;
  };
}

export interface BuildRetroInsightsOptions {
  generatedAt: string;
}

interface LocatedEntry {
  record: RetroRecord;
  entry: RetroEntry;
}

interface Cluster {
  kind: string;
  target: string;
  entries: LocatedEntry[];
}

export function makeRow(input: {
  claim: string;
  measures_used: string[];
  n: number;
  interval?: string;
  caveat: string;
  values: Record<string, number | string | null>;
}): InsightRow {
  if (typeof input.n !== 'number' || !Number.isFinite(input.n)) {
    throw new Error(`insight row "${input.claim}" cannot render: missing n (epistemics contract)`);
  }
  if (typeof input.caveat !== 'string' || input.caveat.trim().length === 0) {
    throw new Error(
      `insight row "${input.claim}" cannot render: missing caveat (epistemics contract)`,
    );
  }
  const row: InsightRow = {
    claim: input.claim,
    measures_used: input.measures_used,
    n: input.n,
    caveat: input.caveat,
    values: input.values,
  };
  if (input.interval !== undefined) row.interval = input.interval;
  return row;
}

export function suppressLowN(
  rows: InsightRow[],
  threshold: number,
): { rendered: InsightRow[]; suppressed?: SectionSuppression } {
  const above = rows.filter((row) => row.n >= threshold);
  const below = rows.filter((row) => row.n < threshold);
  if (below.length === 0) return { rendered: above };
  const summed: Record<string, number> = {};
  for (const row of below) {
    for (const [key, value] of Object.entries(row.values)) {
      if (typeof value === 'number') summed[key] = (summed[key] ?? 0) + value;
    }
  }
  const n = below.reduce((sum, row) => sum + row.n, 0);
  return {
    rendered: [
      ...above,
      makeRow({
        claim: `other (${below.length} row(s) each below n=${threshold})`,
        measures_used: ['aggregated tail'],
        n,
        caveat: `Folded ${below.length} row(s) each with n<${threshold}; shown as one aggregate so low-sample observations remain visible without overstating individual patterns.`,
        values: { ...summed, folded_rows: below.length },
      }),
    ],
    suppressed: { rows: below.length, reason: `n<${threshold}` },
  };
}

export function buildRetroInsights(
  records: RetroRecord[],
  options: BuildRetroInsightsOptions,
): RetroInsightsDocument {
  const orderedRecords = [...records].sort(
    (a, b) =>
      a.started_at.localeCompare(b.started_at) ||
      a.retro_id.localeCompare(b.retro_id) ||
      a.record_path.localeCompare(b.record_path),
  );
  const located = orderedRecords.flatMap((record) =>
    record.entries.map((entry) => ({ record, entry })),
  );
  const headline = buildHeadline(orderedRecords, located);
  return {
    schema_version: RETRO_INSIGHTS_SCHEMA_VERSION,
    generated_at: options.generatedAt,
    headline,
    sections: {
      totals: totalsSection(headline),
      top_clusters: clusterSection(located),
      stale: staleSection(located, options.generatedAt),
      disposition_mix_records: dispositionSection(headline),
    },
  };
}

function buildHeadline(records: RetroRecord[], located: LocatedEntry[]): RetroHeadline {
  const status_counts = initializedCounts(KNOWN_STATUSES, 'other');
  const kind_counts = initializedCounts(KNOWN_KINDS, 'other');
  const disposition_counts = initializedCounts(KNOWN_DISPOSITIONS, 'unspecified');
  for (const { entry } of located) {
    incrementKnown(status_counts, entry.status, KNOWN_STATUSES, 'other');
    incrementKnown(kind_counts, entry.kind, KNOWN_KINDS, 'other');
    incrementKnown(
      disposition_counts,
      entry.disposition ?? 'unspecified',
      KNOWN_DISPOSITIONS,
      'unspecified',
    );
  }
  const plans_touched = sortedUnique(
    records.flatMap((record) => (record.plan_id === null ? [] : [record.plan_id])),
  );
  const agents = sortedUnique(records.map((record) => record.agent));
  const dates = records
    .map((record) => record.started_at)
    .filter(validIso)
    .sort();
  return {
    records: records.length,
    entries: located.length,
    plans_touched,
    agents,
    date_range: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    status_counts,
    kind_counts,
    disposition_counts,
    open_to_encoded_ratio: `${status_counts.open}:${status_counts.encoded}`,
  };
}

function totalsSection(headline: RetroHeadline): InsightSection {
  const statusRows = Object.entries(headline.status_counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) =>
      makeRow({
        claim: `${status}: ${count}`,
        measures_used: ['system.compound.status'],
        n: count,
        caveat:
          'Lifecycle status is read from committed retro entries; missing or unknown values are counted as other, never inferred.',
        values: { status, count },
      }),
    );
  const suppressed = suppressLowN(statusRows, N_THRESHOLD);
  return {
    id: 'totals',
    title: 'Retro totals',
    available: true,
    rows: [
      makeRow({
        claim: `${headline.records} record(s), ${headline.entries} entr(y/ies)`,
        measures_used: ['parsed committed retro records'],
        n: headline.records,
        caveat:
          'Counts cover the records supplied to the engine after reader validation, deduplication, and scope filters.',
        values: {
          records: headline.records,
          entries: headline.entries,
          plans: headline.plans_touched.length,
          agents: headline.agents.length,
        },
      }),
      ...suppressed.rendered,
    ],
    ...(suppressed.suppressed && { suppressed: suppressed.suppressed }),
    note: 'Exact status counts remain in headline.status_counts; low-n status rows are folded visibly.',
  };
}

function clusterSection(located: LocatedEntry[]): InsightSection<RetroClusterRow> {
  const clusters = new Map<string, Cluster>();
  for (const item of located) {
    if (item.entry.status !== 'open') continue;
    const target = item.entry.target ?? '(none)';
    const key = `${item.entry.kind}\u0000${target}`;
    const cluster = clusters.get(key) ?? { kind: item.entry.kind, target, entries: [] };
    cluster.entries.push(item);
    clusters.set(key, cluster);
  }
  const rows = [...clusters.values()].map(clusterRow).sort(compareClusterRows).slice(0, 10);
  return {
    id: 'top_clusters',
    title: 'Open clusters',
    available: rows.length > 0,
    rows,
    note: 'Top 10 open clusters, ranked by recurrence, severity, proof leverage, then oldest first-seen time.',
  };
}

function clusterRow(cluster: Cluster): RetroClusterRow {
  const entries = [...cluster.entries].sort(
    (a, b) =>
      a.record.record_path.localeCompare(b.record.record_path) ||
      a.record.retro_id.localeCompare(b.record.retro_id) ||
      a.entry.id.localeCompare(b.entry.id),
  );
  const severity = highestSeverity(entries.map(({ entry }) => entry.severity));
  const proof = proofGap(cluster);
  const firstSeen =
    entries
      .map(({ entry }) => entry.first_seen_at)
      .filter((value): value is string => value !== undefined && validIso(value))
      .sort()[0] ?? null;
  const repeatedlyDeferred =
    entries.filter(({ entry }) => ['declined', 'deferred'].includes(entry.disposition ?? ''))
      .length >= 2;
  const row = makeRow({
    claim: `[${cluster.kind}/${cluster.target}] ${entries.length} open entr(y/ies)`,
    measures_used: ['kind', 'target', 'severity', 'system.compound.first_seen_at'],
    n: entries.length,
    caveat:
      'Cluster identity is the exact (kind,target) pair; descriptions are preserved as provenance and are not semantically merged.',
    values: {
      kind: cluster.kind,
      target: cluster.target,
      entries: entries.length,
      records: new Set(entries.map(({ record }) => record.retro_id)).size,
      agents: new Set(entries.map(({ record }) => record.agent)).size,
      severity,
      first_seen_at: firstSeen,
    },
  });
  return {
    ...row,
    kind: cluster.kind,
    target: cluster.target,
    severity,
    first_seen_at: firstSeen,
    proof_gap: proof.signal !== null,
    ...(proof.signal !== null && { proof_gap_signal: proof.signal }),
    repeatedly_deferred: repeatedlyDeferred,
    members: entries.map(({ record, entry }) => ({
      record_path: record.record_path,
      retro_id: record.retro_id,
      entry_id: entry.id,
      status: entry.status,
    })),
  };
}

function compareClusterRows(a: RetroClusterRow, b: RetroClusterRow): number {
  return (
    b.n - a.n ||
    severityRank(b.severity) - severityRank(a.severity) ||
    proofGapRank(b.proof_gap_signal) - proofGapRank(a.proof_gap_signal) ||
    compareNullableIso(a.first_seen_at, b.first_seen_at) ||
    a.kind.localeCompare(b.kind) ||
    a.target.localeCompare(b.target)
  );
}

function proofGapRank(signal: RetroClusterRow['proof_gap_signal']): number {
  return signal === 'target' ? 2 : signal === 'keyword' ? 1 : 0;
}

function staleSection(located: LocatedEntry[], generatedAt: string): InsightSection<RetroStaleRow> {
  const now = Date.parse(generatedAt);
  const rows: RetroStaleRow[] = [];
  if (Number.isFinite(now)) {
    for (const { record, entry } of located) {
      if (entry.first_seen_at === undefined) continue;
      const firstSeen = Date.parse(entry.first_seen_at);
      if (!Number.isFinite(firstSeen)) continue;
      const ageDays = (now - firstSeen) / DAY_MS;
      const threshold =
        entry.status === 'open'
          ? 28
          : entry.status === 'suggested' && !entry.resolved_by
            ? 14
            : null;
      if (threshold === null || ageDays <= threshold) continue;
      const row = makeRow({
        claim: `${entry.id} is stale (${entry.status}, ${Math.floor(ageDays)}d)`,
        measures_used: ['system.compound.status', 'system.compound.first_seen_at', 'resolved_by'],
        n: 1,
        caveat:
          'Staleness is observational: open >4 weeks, or suggested >2 weeks without resolved_by. It does not mutate lifecycle status.',
        values: {
          entry_id: entry.id,
          status: entry.status,
          age_days: Math.floor(ageDays),
          threshold_days: threshold,
          first_seen_at: entry.first_seen_at,
          resolved_by: entry.resolved_by ?? null,
        },
      });
      rows.push({
        ...row,
        record_path: record.record_path,
        retro_id: record.retro_id,
        entry_id: entry.id,
        status: entry.status,
      });
    }
  }
  rows.sort(
    (a, b) =>
      String(a.values.first_seen_at).localeCompare(String(b.values.first_seen_at)) ||
      a.record_path.localeCompare(b.record_path) ||
      a.entry_id.localeCompare(b.entry_id),
  );
  return {
    id: 'stale',
    title: 'Stale lifecycle entries',
    available: rows.length > 0,
    rows,
    note: 'Flags only; the report is read-only.',
  };
}

function dispositionSection(headline: RetroHeadline): InsightSection {
  const total = Object.values(headline.disposition_counts).reduce((sum, count) => sum + count, 0);
  const rows = Object.entries(headline.disposition_counts)
    .filter(([, count]) => count > 0)
    .map(([disposition, count]) =>
      makeRow({
        claim: `${disposition}: ${count}`,
        measures_used: ['entry disposition'],
        n: count,
        caveat:
          'Drain-time dispositions are counted from committed records; unspecified means the older record carried no disposition field.',
        values: {
          disposition,
          count,
          share: total === 0 ? null : Math.round((count / total) * 1000) / 1000,
        },
      }),
    );
  const suppressed = suppressLowN(rows, N_THRESHOLD);
  return {
    id: 'disposition_mix_records',
    title: 'Disposition mix from records',
    available: total > 0,
    rows: suppressed.rendered,
    ...(suppressed.suppressed && { suppressed: suppressed.suppressed }),
    note: `Disposition fields observed across ${total} committed entr(y/ies).`,
  };
}

function proofGap(cluster: Cluster): { signal: 'target' | 'keyword' | null } {
  if (PROOF_TARGETS.has(cluster.target)) return { signal: 'target' };
  if (
    cluster.kind === 'magic-wand' &&
    cluster.entries.some(({ entry }) =>
      MAGIC_WAND_COMMAND.test(
        [entry.description, entry.workaround, entry.suggested_encoding].filter(Boolean).join(' '),
      ),
    )
  ) {
    return { signal: 'target' };
  }
  const text = cluster.entries
    .flatMap(({ entry }) => [entry.description, entry.workaround, entry.suggested_encoding])
    .filter((value): value is string => value !== undefined)
    .join(' ');
  return { signal: PROOF_KEYWORDS.test(text) ? 'keyword' : null };
}

function highestSeverity(values: Array<string | undefined>): string | null {
  return (
    [...values]
      .filter((value): value is string => value !== undefined)
      .sort((a, b) => severityRank(b) - severityRank(a) || a.localeCompare(b))[0] ?? null
  );
}

function severityRank(value: string | null): number {
  return value === 'blocking' ? 3 : value === 'degrading' ? 2 : value === 'annoying' ? 1 : 0;
}

function compareNullableIso(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function validIso(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function initializedCounts<const Values extends readonly string[], Fallback extends string>(
  values: Values,
  fallback: Fallback,
): Record<Values[number] | Fallback, number> {
  return Object.fromEntries([...values, fallback].map((value) => [value, 0])) as Record<
    Values[number] | Fallback,
    number
  >;
}

function incrementKnown<const Values extends readonly string[], Fallback extends string>(
  counts: Record<Values[number] | Fallback, number>,
  value: string,
  known: Values,
  fallback: Fallback,
): void {
  const key = (known as readonly string[]).includes(value) ? value : fallback;
  counts[key as Values[number] | Fallback] += 1;
}
