import { resolveInRepo } from '../../shared/posix-path.js';
import { isAddressFailure, parseAddress } from '../core/address.js';
import { resolveAddressFile } from '../core/validate.js';
import type { DdMapMark, DdMapNode, DdMapResult } from './map.js';
import type { DdCorpusGraph, DdLinkEdge } from './model.js';

export interface DdLinksReport {
  /** The document the report is about, absolute and POSIX-logical. */
  path: string;
  /** The argument as given, normalized — an address keeps its interior. */
  target: string;
  /** Edges written in this document. */
  outbound: DdLinkEdge[];
  /** Edges anywhere in the corpus that land in this document. */
  inbound: DdLinkEdge[];
}

/**
 * Resolve the `dd links <target>` argument to a document path.
 *
 * The argument is either a path or an address; an address's interior selects
 * nothing extra, because edges are a property of documents (D11). Reporting at
 * document granularity is the honest answer to "what points here" — a cell's
 * address names a document plus a location inside it, and both are already in
 * the edge.
 */
export function resolveLinksTarget(target: string, repoRoot: string): string {
  const parsed = parseAddress(target);
  if (isAddressFailure(parsed) || parsed.file === null) {
    return resolveInRepo(target.split('#')[0] ?? target, repoRoot);
  }
  return resolveAddressFile(`${repoRoot}/_`, parsed.file);
}

/**
 * Inbound and outbound edges for one document, read off a traversal.
 *
 * Nothing is stored and nothing is indexed (D11): the corpus is scanned, the
 * graph is built, and the answer is a filter over it. A link that was deleted
 * upstream stops being reported the moment it is deleted, because there is no
 * cached edge to go stale.
 */
export function linksFor(path: string, graph: DdCorpusGraph, target = path): DdLinksReport {
  return {
    path,
    target,
    outbound: graph.edges.filter((edge) => edge.from === path),
    inbound: graph.edges.filter((edge) => edge.to === path && edge.from !== path),
  };
}

/**
 * Accent functions the human map render calls, injected rather than imported.
 *
 * This layer must never reach `output/` — the same architecture rule that keeps
 * `dd graph` off the render layer (`isolation.test.ts`) — so the ANSI itself is
 * composed in the act, from `output/style.ts`, and handed in. The renderer then
 * has exactly ONE code path: it always calls the palette, and the palette is the
 * identity when colour is off. There is no coloured branch that can drift away
 * from the plain golden, and `--json` cannot acquire an escape byte by accident
 * because it never builds this string at all.
 */
export interface DdMapPalette {
  seed(text: string): string;
  inbound(text: string): string;
  outbound(text: string): string;
  path(text: string): string;
  id(text: string): string;
  label(text: string): string;
  faint(text: string): string;
  alarm(text: string): string;
  mark(mark: DdMapMark): (text: string) => string;
}

const identity = (text: string): string => text;

/** The palette every non-colour surface uses — a pipe, `NO_COLOR`, the golden. */
export const PLAIN_MAP_PALETTE: DdMapPalette = {
  seed: identity,
  inbound: identity,
  outbound: identity,
  path: identity,
  id: identity,
  label: identity,
  faint: identity,
  alarm: identity,
  mark: () => identity,
};

/** The width the render is built to fit. 80 is the contract, not a preference. */
export const MAP_WIDTH = 80;

/**
 * How many cut nodes are named before the block summarises the rest.
 *
 * The COUNT is always exact and always first: a reader has to be able to see
 * that twelve things were dropped even when only five are named, because the
 * number is the part that changes a decision.
 */
const TRUNCATION_SAMPLE = 5;

/** Split an address so its last segment — the id a reader scans for — can be accented. */
function splitAddress(address: string): { head: string; tail: string } {
  const cut = Math.max(address.lastIndexOf('/'), address.lastIndexOf('#'));
  return cut < 0
    ? { head: '', tail: address }
    : { head: address.slice(0, cut + 1), tail: address.slice(cut + 1) };
}

function clip(text: string, width: number): string {
  if (width <= 1) return '';
  return text.length <= width ? text : `${text.slice(0, width - 1)}\u2026`;
}

/** The folder the seed document sits in — every other address is shown against it. */
function seedFolder(seedAddress: string): string {
  const file = seedAddress.split('#')[0] ?? seedAddress;
  const cut = file.lastIndexOf('/');
  return cut < 0 ? '' : file.slice(0, cut);
}

/**
 * Shorten an address for display against the seed's own folder.
 *
 * A corpus lives together, so a full repo-relative path on every line spends the
 * 80 columns on the part that never changes and leaves none for the part a
 * reader came for. The same document collapses to its bare interior — `#rows/
 * bp-0201`, which is how the link was authored — a sibling to its file name, and
 * anything further away keeps its full repo-relative path so it stands out as
 * being from somewhere else. The header states the folder, so nothing is
 * ambiguous: this is display only, and `--json` always carries the long form.
 */
function relativeToSeed(seedAddress: string): (address: string) => string {
  const seedFile = seedAddress.split('#')[0] ?? seedAddress;
  const folder = seedFolder(seedAddress);
  return (address: string): string => {
    if (address === seedFile) return seedFile.slice(folder === '' ? 0 : folder.length + 1);
    if (address.startsWith(`${seedFile}#`)) return address.slice(seedFile.length);
    if (folder !== '' && address.startsWith(`${folder}/`)) return address.slice(folder.length + 1);
    return address;
  };
}

/**
 * One node as a line: connector, direction arrow, state mark, address, and — only
 * if it still fits inside {@link MAP_WIDTH} — the human label.
 *
 * Every width is measured on the PLAIN text and the styling is applied to the
 * measured pieces, so colour can never change where the line wraps.
 *
 * The label is display only: it is read from a small set of conventional naming
 * fields, and a schema that names nothing recognisable renders without one
 * rather than rendering a guess.
 */
function nodeRow(
  node: DdMapNode,
  shown: string,
  prefix: string,
  arrow: string,
  palette: DdMapPalette,
  emphasise: boolean,
): string {
  const mark = node.mark === '' ? '   ' : node.mark;
  const progress = node.progress ? ` ${node.progress.terminal}/${node.progress.total}` : '';
  const flag = node.resolved ? '' : '  (unresolved)';
  const { head, tail } = splitAddress(shown);
  const lead = `${prefix}${arrow}${mark}${progress} `;
  const room = MAP_WIDTH - (lead.length + shown.length + flag.length) - 2;
  const label = node.label !== null && room > 8 ? `  ${clip(node.label, room)}` : '';

  const accent = emphasise ? palette.seed : identity;
  const fade = node.distance > 1 ? palette.faint : identity;
  return (
    `${prefix}${arrow}${palette.mark(node.mark)(mark)}${progress} ` +
    `${fade(palette.path(head))}${accent(palette.id(tail))}` +
    `${flag === '' ? '' : palette.alarm(flag)}${label === '' ? '' : fade(palette.label(label))}`
  );
}

/**
 * The human map: what reaches this row above, where this row goes below.
 *
 * The two arms are drawn differently (`<-` against `->`) rather than only
 * coloured differently, so the distinction survives a pipe, a `NO_COLOR`
 * terminal and a paste into a document. Colour sharpens it; it never carries it
 * alone.
 *
 * A cycle is drawn, not hidden: an edge into a node already on the page becomes
 * a `↩` reference line rather than silently disappearing, and a bound that fired
 * gets its own block. A render that looks complete when it is not is the worst
 * thing this command can produce, so truncation is the loudest thing on it.
 */
export function renderMapTree(
  result: DdMapResult,
  palette: DdMapPalette = PLAIN_MAP_PALETTE,
): string {
  const byKey = new Map(result.nodes.map((node) => [node.key, node]));
  const seed = result.nodes.find((node) => node.arm === 'seed');
  const lines: string[] = [];
  const shorten = relativeToSeed(result.seed.address);

  const branch = (node: DdMapNode, arm: 'in' | 'out', prefix: string, arrow: string): void => {
    const steps = result.edges.flatMap((edge) => {
      if (edge.arm !== arm) return [];
      if ((arm === 'out' ? edge.from : edge.to) !== node.key) return [];
      const other = byKey.get(arm === 'out' ? edge.to : edge.from);
      return other ? [other] : [];
    });
    steps.forEach((other, index) => {
      const last = index === steps.length - 1;
      const connector = `${prefix}${last ? '\u2514\u2500' : '\u251c\u2500'}`;
      const nested = `${prefix}${last ? '  ' : '\u2502 '}`;
      if (other.parent === node.key && other.key !== node.key) {
        lines.push(nodeRow(other, shorten(other.address), connector, arrow, palette, false));
        branch(other, arm, nested, arrow);
        return;
      }
      const back = `\u21a9 ${shorten(other.address)}  (already shown)`;
      lines.push(`${connector}${palette.faint(back)}`);
    });
  };

  const folder = seedFolder(result.seed.address);
  const file = result.seed.address.slice(folder === '' ? 0 : folder.length + 1);
  // The header carries the long form once so every row below can be short. An
  // address is never truncated or wrapped anywhere in this render: half an
  // address is not a shorter address, it is a wrong one.
  lines.push(palette.seed(`dd graph map  ${file}`));
  lines.push(
    palette.faint(`  relative to ${folder === '' ? 'the repository root' : `${folder}/`}`),
    '',
  );

  if (seed) {
    if (result.bounds.direction !== 'out') {
      const heading = '  <- inbound   what reaches this';
      lines.push(palette.inbound(heading));
      const before = lines.length;
      branch(seed, 'in', '  ', '<- ');
      if (lines.length === before) {
        lines.push(palette.faint('     (nothing in the corpus reaches this)'));
      }
      lines.push('');
    }

    lines.push(nodeRow(seed, shorten(seed.address), '  ', '@  ', palette, true), '');

    if (result.bounds.direction !== 'in') {
      const heading = '  -> outbound  where this goes';
      lines.push(palette.outbound(heading));
      const before = lines.length;
      branch(seed, 'out', '  ', '-> ');
      if (lines.length === before) {
        lines.push(palette.faint('     (this reaches nothing)'));
      }
      lines.push('');
    }
  }

  if (result.truncated.cut) {
    lines.push(
      palette.alarm(`  ! TRUNCATED \u2014 ${result.truncated.nodes.length} node(s) not shown`),
    );
    for (const cut of result.truncated.nodes.slice(0, TRUNCATION_SAMPLE)) {
      const bound =
        cut.reason === 'depth'
          ? `depth ${result.bounds.depth}`
          : `max-nodes ${result.bounds.max_nodes}`;
      lines.push(palette.alarm(`     ${bound} stopped at ${shorten(cut.address)}`));
    }
    const rest = result.truncated.nodes.length - TRUNCATION_SAMPLE;
    if (rest > 0) lines.push(palette.alarm(`     \u2026 and ${rest} more`));
    lines.push('');
  }

  for (const issue of result.issues) {
    lines.push(palette.alarm(`  ! ${issue.severity} ${issue.message}`));
  }

  return `${lines.join('\n')}\n`;
}
