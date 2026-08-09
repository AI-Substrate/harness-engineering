import { escapeCell, headingSlug } from '@ai-substrate/dd/render/renderer';
import type { PlanEdge, PlanIndex, PlanItem } from '../../services/plan-semantics/index.js';

/**
 * The PR-body acceptance table — a plan's closed claims, each beside the evidence
 * it rests on (ac-7112).
 *
 * The human checkpoint in this pipeline is the pull request. Everything before it
 * is autonomous: agents close criteria, gates refuse departures, the documents
 * record what happened. So the PR is the one place a person decides whether to
 * believe any of it, and the thing that makes that decision cheap is not a
 * summary — it is each claim with its proof ONE CLICK away, generated from the
 * corpus rather than retyped from it.
 *
 * Two properties make this trustworthy rather than decorative:
 *
 *   - It is DERIVED. Every row, mark, and reference comes from the plan index the
 *     validator and the departure gate read. A PR body assembled by prose would be
 *     a fourth account of the same corpus, and the day it disagreed nobody would
 *     be able to tell which one was lying.
 *   - It REFUSES. An unclosed corpus does not produce a partial table; it produces
 *     a refusal naming the open rows. A table that quietly omitted the criteria
 *     that were not met would be the most expensive possible defect here — it
 *     would make a reviewer's approval mean less than they thought it did.
 *
 * It lives at the ACT layer because neither dd slice may reach the other: the plan
 * semantic layer never imports the renderer (`dd-plan-never-imports-render`), and
 * the renderer is a leaf that reaches no Phase-4 module (`renderer-purity`). A PR
 * table needs BOTH — the item graph and the markdown — so it belongs where
 * composition is the job, beside `scaffold.ts`. Pure over an already-built index:
 * no filesystem, no clock, no envelope, so a golden is a function call.
 */

/** One resolved citation on a criterion row. */
export interface PrBodyReference {
  /** The id a reader recognises (`bp-7112`), or the raw text when nothing resolved. */
  label: string;
  /** Repo-relative `path#interior` of the target, or the raw address when unresolved. */
  address: string;
  /** Where a click goes, or null when the citation reaches nothing linkable. */
  href: string | null;
}

export interface PrBodyCriterion {
  id: string;
  /** Repo-relative address of the criterion row itself. */
  address: string;
  /** The row's own state word, verbatim — `checked`, `skipped`, whatever it says. */
  state: string | null;
  done: boolean;
  claim: string;
  proven_by: PrBodyReference[];
  pressure: PrBodyReference[];
  /** Incoming `satisfies` — the tasks that accounted for this criterion. */
  satisfied_by: PrBodyReference[];
}

export interface PrBodyOptions {
  /**
   * Absolute prefix every reference is resolved against — a blob URL pinned at the
   * head sha, so the links keep meaning what they meant when the PR was opened
   * (tk-7152). Absent, references stay repo-relative, which is what a golden pins
   * and what renders correctly inside the repository.
   */
  linkBase?: string | null;
  /** The heading text, so a caller can compose this into a larger body. */
  heading?: string;
}

export interface PrBodyRefusal {
  ok: false;
  reason: 'unclosed' | 'no-criteria';
  /** Addresses of the criteria that are still open — the reason, named. */
  open: string[];
  message: string;
  next_action: string;
}

export interface PrBodyRendered {
  ok: true;
  markdown: string;
  criteria: PrBodyCriterion[];
}

export type PrBodyResult = PrBodyRendered | PrBodyRefusal;

const DEFAULT_HEADING = 'Acceptance criteria';

/** The last interior segment — the id a reader recognises. */
function idOf(item: PlanItem): string {
  return item.interior[item.interior.length - 1] ?? item.address;
}

/**
 * Where a criterion's citation points.
 *
 * A dd address names a `.dd.json`, but the artifact a human can READ is its
 * generated sibling, so the link swaps the extension and anchors on the section
 * heading — exactly what the document renderer does for its own link cells. The
 * interior is deliberately dropped from the anchor: a cross-document interior has
 * no heading of its own, and an anchor that does not exist is worse than one that
 * lands a reader on the right section.
 */
function hrefFor(address: string, linkBase: string | null): string {
  const [path, interior] = address.split('#', 2);
  const file = (path ?? address).replace(/\.dd\.json$/, '.dd.md');
  const section = interior?.split('/')[0];
  const anchor = section === undefined || section.length === 0 ? '' : `#${headingSlug(section)}`;
  const base = linkBase === null ? '' : linkBase.replace(/\/+$/, '') + '/';
  return `${base}${file}${anchor}`;
}

/**
 * Turn one edge into a reference.
 *
 * An edge whose target is not indexable — a literal `not-applicable`, a citation
 * out of the plan's document set, a typo — is kept and rendered as PLAIN TEXT
 * rather than dropped or linked. Dropping it would hide that the author said
 * something; linking it would manufacture a dead link in the one artifact whose
 * credibility rests on its links working.
 */
function referenceFor(edge: PlanEdge, index: PlanIndex, linkBase: string | null): PrBodyReference {
  const target = edge.to === null ? undefined : index.byKey.get(edge.to);
  if (target === undefined) {
    return { label: edge.address, address: edge.address, href: null };
  }
  return {
    label: idOf(target),
    address: target.address,
    href: hrefFor(target.address, linkBase),
  };
}

/**
 * The other end of an INCOMING edge — the row that did the citing.
 *
 * Deliberately its own function. An incoming `satisfies` answers "which task
 * accounted for this criterion", so the interesting item is the edge's SOURCE;
 * reusing the outgoing resolver here would render every row as a list of itself,
 * which is a mistake that reads perfectly until someone checks a link.
 */
function citerFor(edge: PlanEdge, index: PlanIndex, linkBase: string | null): PrBodyReference {
  const source = index.byKey.get(edge.from);
  if (source === undefined) {
    return { label: edge.from, address: edge.from, href: null };
  }
  return {
    label: idOf(source),
    address: source.address,
    href: hrefFor(source.address, linkBase),
  };
}

function cell(references: readonly PrBodyReference[]): string {
  if (references.length === 0) return '—';
  return references
    .map((reference) =>
      reference.href === null
        ? escapeCell(reference.label)
        : `[${escapeCell(reference.label)}](${reference.href})`,
    )
    .join(', ');
}

/**
 * Build the acceptance table for a plan, or refuse to.
 *
 * Rel-driven throughout — `proven_by`, `pressure` and `satisfies` are read off the
 * EDGES, never off field names — so a second plan schema that declares the same
 * relations renders here for free, and renaming a field in `builder/plan` cannot
 * silently empty a column.
 */
export function renderPrBody(index: PlanIndex, options: PrBodyOptions = {}): PrBodyResult {
  const linkBase = options.linkBase ?? null;
  const claims = index.items.filter((item) => item.claim);

  if (claims.length === 0) {
    return {
      ok: false,
      reason: 'no-criteria',
      open: [],
      message:
        'this corpus declares no acceptance criteria, so there is no proof to render — an empty table under a "proof" heading claims more than the documents do',
      next_action:
        'Point at the plan document whose schema declares a `satisfies` target section, or add the criteria this work was meant to meet.',
    };
  }

  const open = claims.filter((item) => !item.done);
  if (open.length > 0) {
    return {
      ok: false,
      reason: 'unclosed',
      open: open.map((item) => item.address),
      message: `${open.length} of ${claims.length} acceptance criteria are still open, so this corpus cannot render a proof of them: ${open
        .map((item) => `${idOf(item)} is "${item.state ?? 'stateless'}"`)
        .join('; ')}`,
      next_action:
        'Close the criteria through the dd surfaces (`harness dd set <address>/state checked`) once their evidence is linked, then re-run. `harness plan validate <plan> --complete` lists everything still outstanding.',
    };
  }

  const outgoing = new Map<string, PlanEdge[]>();
  const incoming = new Map<string, PlanEdge[]>();
  for (const edge of index.edges) {
    const from = outgoing.get(edge.from) ?? [];
    from.push(edge);
    outgoing.set(edge.from, from);
    if (edge.to === null) continue;
    const to = incoming.get(edge.to) ?? [];
    to.push(edge);
    incoming.set(edge.to, to);
  }

  const references = (edges: readonly PlanEdge[], rel: string): PrBodyReference[] =>
    edges.filter((edge) => edge.rel === rel).map((edge) => referenceFor(edge, index, linkBase));

  const citers = (edges: readonly PlanEdge[], rel: string): PrBodyReference[] =>
    edges.filter((edge) => edge.rel === rel).map((edge) => citerFor(edge, index, linkBase));

  const criteria: PrBodyCriterion[] = claims.map((item) => {
    const out = outgoing.get(item.key) ?? [];
    const into = incoming.get(item.key) ?? [];
    return {
      id: idOf(item),
      address: item.address,
      state: item.state,
      done: item.done,
      claim: item.label ?? '',
      proven_by: references(out, 'proven_by'),
      pressure: references(out, 'pressure'),
      satisfied_by: citers(into, 'satisfies'),
    };
  });

  const heading = options.heading ?? DEFAULT_HEADING;
  const lines: string[] = [
    `## ${heading}`,
    '',
    `All ${criteria.length} criteria are closed in the plan's own documents. Each row links to`,
    'the evidence it rests on, so a claim can be checked rather than taken on trust.',
    '',
    '| Criterion | Claim | Proven by | Instrument | Accounted for by |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const criterion of criteria) {
    const mark = `✅ \`${criterion.id}\`${criterion.state === null ? '' : ` · ${escapeCell(criterion.state)}`}`;
    lines.push(
      `| ${mark} | ${escapeCell(criterion.claim)} | ${cell(criterion.proven_by)} | ${cell(
        criterion.pressure,
      )} | ${cell(criterion.satisfied_by)} |`,
    );
  }
  lines.push('');

  return { ok: true, markdown: lines.join('\n'), criteria };
}
