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

/**
 * The narrowest address column a wrap will ever use.
 *
 * Deep indentation is not allowed to squeeze an address into a one-character
 * ribbon; past this point the continuation goes flush against the reserved
 * column instead, losing the guide bars rather than the readability.
 */
const MIN_WRAP = 16;

/**
 * How far the tree indent grows before it stops widening.
 *
 * Indentation is the only part of a line whose width the render controls but
 * cannot shorten, so it is bounded. Past this depth siblings and children share
 * a column — the shape flattens, which is visible and therefore honest, instead
 * of the line silently running past {@link MAP_WIDTH}.
 */
const MAX_INDENT = 40;

/**
 * Every code point a terminal draws two cells wide: East Asian Wide + Fullwidth.
 *
 * DERIVED, NOT AUTHORED — that distinction is the whole point. A hand-picked
 * table is short and wrong: adding the one missing range that someone noticed
 * moves the hole, it does not close it. This is the complete W/F run set, so the
 * code honours the policy its comment states rather than approximating it.
 *
 * Unicode 16.0.0. Regenerate with:
 *
 *   python3 -c "import unicodedata; runs=[]; prev=None
 *   [ (runs.append(prev:=[cp,cp]) if not (prev and cp==prev[1]+1) else prev.__setitem__(1,cp))
 *     if unicodedata.east_asian_width(chr(cp)) in ('W','F') else (prev:=None)
 *     for cp in range(0x110000) ]
 *   print(runs)"
 *
 * and check `unicodedata.unidata_version` against the version above — that is
 * what makes this table's staleness checkable rather than invisible. A table
 * with no stated version cannot be audited, only trusted.
 *
 * Ranges are ascending and disjoint, which {@link isWide} relies on.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2630, 0x2637],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x268a, 0x268f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x2e99],
  [0x2e9b, 0x2ef3],
  [0x2f00, 0x2fd5],
  [0x2ff0, 0x303e],
  [0x3041, 0x3096],
  [0x3099, 0x30ff],
  [0x3105, 0x312f],
  [0x3131, 0x318e],
  [0x3190, 0x31e5],
  [0x31ef, 0x321e],
  [0x3220, 0x3247],
  [0x3250, 0xa48c],
  [0xa490, 0xa4c6],
  [0xa960, 0xa97c],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe52],
  [0xfe54, 0xfe66],
  [0xfe68, 0xfe6b],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x16ff0, 0x16ff1],
  [0x17000, 0x187f7],
  [0x18800, 0x18cd5],
  [0x18cff, 0x18d08],
  [0x1aff0, 0x1aff3],
  [0x1aff5, 0x1affb],
  [0x1affd, 0x1affe],
  [0x1b000, 0x1b122],
  [0x1b132, 0x1b132],
  [0x1b150, 0x1b152],
  [0x1b155, 0x1b155],
  [0x1b164, 0x1b167],
  [0x1b170, 0x1b2fb],
  [0x1d300, 0x1d356],
  [0x1d360, 0x1d376],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f202],
  [0x1f210, 0x1f23b],
  [0x1f240, 0x1f248],
  [0x1f250, 0x1f251],
  [0x1f260, 0x1f265],
  [0x1f300, 0x1f320],
  [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c],
  [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f43e],
  [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d],
  [0x1f54b, 0x1f54e],
  [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a],
  [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2],
  [0x1f6d5, 0x1f6d7],
  [0x1f6dc, 0x1f6df],
  [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb],
  [0x1f7f0, 0x1f7f0],
  [0x1f90c, 0x1f93a],
  [0x1f93c, 0x1f945],
  [0x1f947, 0x1f9ff],
  [0x1fa70, 0x1fa7c],
  [0x1fa80, 0x1fa89],
  [0x1fa8f, 0x1fac6],
  [0x1face, 0x1fadc],
  [0x1fadf, 0x1fae9],
  [0x1faf0, 0x1faf8],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

/**
 * Is this code point drawn two cells wide?
 *
 * Binary search rather than a scan: {@link cellWidth} asks per code point and
 * the wrap asks per candidate break, so a linear pass over 122 runs is work done
 * thousands of times to render one tree.
 */
function isWide(code: number): boolean {
  let low = 0;
  let high = WIDE_RANGES.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const range = WIDE_RANGES[mid];
    if (range === undefined) return false;
    if (code < range[0]) high = mid - 1;
    else if (code > range[1]) low = mid + 1;
    else return true;
  }
  return false;
}

/** Marks and format controls that occupy no cell of their own. */
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u;

/**
 * How many terminal CELLS a string occupies.
 *
 * Characters are not columns. `length` counts UTF-16 code units and `[...text]`
 * counts code points, and BOTH are wrong for a terminal: one CJK ideograph is a
 * single code point that a terminal draws two cells wide, and a combining mark
 * is a code point that draws none. `dd` addresses can legitimately contain them
 * — `core/address.ts` constrains only the INTERIOR segments to ASCII, so the
 * file part is free — which is how a line the code believed was 80 wide rendered
 * at 146.
 *
 * This is the ONE place a width is decided. The renderer wraps by it and the
 * tests assert by it, so break geometry and the oracle cannot disagree; a test
 * that measures differently from the renderer is how the defect above survived.
 *
 * Scope, deliberately, and each part is a decision rather than an omission:
 *
 * - East Asian Wide and Fullwidth are TWO cells, from the derived table above.
 * - Combining marks and format controls are ZERO.
 * - East Asian AMBIGUOUS (U+25B6 and its kind) is ONE. There is no correct
 *   answer for these — they render one cell in a Latin context and two in a CJK
 *   one, so the width depends on the reader's font and locale, not on the code
 *   point. One is chosen because this render's content is paths and identifiers,
 *   which is a Latin context, and because it is the choice every common terminal
 *   makes by default. Silence here would be the same defect this helper fixed.
 * - Everything else is ONE.
 *
 * Multi-code-point GRAPHEME CLUSTERS are NOT resolved: emoji ZWJ sequences,
 * regional-indicator flags and variation selectors are counted by their parts,
 * because terminals themselves disagree on how wide those render
 * and there is no correct answer to encode. That imprecision runs one way only —
 * it over-counts, so the render wraps early rather than overflowing.
 */
export function cellWidth(text: string): number {
  let cells = 0;
  for (const char of text) {
    if (ZERO_WIDTH.test(char)) continue;
    const code = char.codePointAt(0) ?? 0;
    cells += isWide(code) ? 2 : 1;
  }
  return cells;
}

/**
 * The offset of the first character past `cells` worth of room from `from`.
 *
 * Widths are cells but slices are code-unit offsets, so the two have to be
 * walked together — a wide character either fits whole or does not start.
 */
function fitEnd(text: string, from: number, cells: number): number {
  let used = 0;
  let at = from;
  while (at < text.length) {
    const point = text.codePointAt(at);
    if (point === undefined) break;
    const char = String.fromCodePoint(point);
    const width = cellWidth(char);
    if (used + width > cells) break;
    used += width;
    at += char.length;
  }
  return at;
}

/** Pad with spaces to a CELL width, which is what an aligned column means. */
function padToCells(text: string, cells: number): string {
  return text + ' '.repeat(Math.max(cells - cellWidth(text), 0));
}

/**
 * A run of text with the accent it gets once the line breaks are known.
 *
 * Width is measured on the plain text and styling is applied to the measured
 * slices, so a coloured render breaks in exactly the same places as the golden.
 * Styling after wrapping is what makes that structural: there is no path where
 * escape bytes can be counted as columns.
 */
interface Span {
  text: string;
  style(text: string): string;
}

/** The plain text of a span run — what every width decision is measured against. */
function spanText(spans: Span[]): string {
  return spans.map((span) => span.text).join('');
}

/** Cut `[start, end)` out of a span run, styling each surviving piece. */
function sliceSpans(spans: Span[], start: number, end: number): string {
  let out = '';
  let at = 0;
  for (const span of spans) {
    const from = at;
    at += span.text.length;
    if (at <= start || from >= end) continue;
    out += span.style(span.text.slice(Math.max(start, from) - from, Math.min(end, at) - from));
  }
  return out;
}

/** Characters a wrap prefers to break after, so a wrapped address breaks at its joints. */
const BREAK_AFTER = new Set(['/', '#', '.', '[', ']', '_', '-']);

/**
 * Where to break at or before `limit`: `end` is the last column kept, `next` the
 * column the continuation resumes from.
 *
 * A space is the best break and is consumed rather than kept, so prose never
 * ends a line with trailing whitespace and never splits a word. Addresses have
 * no spaces, so they fall through to their own joints — a break after `/` or `#`
 * reads as a path continuing. The final fallback is a hard cut, which is what
 * guarantees progress: every branch returns a break strictly after `from`.
 */
function breakPoint(text: string, from: number, limit: number): { end: number; next: number } {
  for (let at = limit; at > from + 1; at -= 1) {
    if (text[at - 1] === ' ') return { end: at - 1, next: at };
  }
  for (let at = limit; at > from + 1; at -= 1) {
    if (BREAK_AFTER.has(text[at - 1] ?? '')) return { end: at, next: at };
  }
  return { end: limit, next: limit };
}

/**
 * Lay a span run out inside {@link MAP_WIDTH}, continuing onto indented lines.
 *
 * Wrapping, never truncating, is the whole point. An address is an identifier:
 * half of one is not a shorter address, it is a different address that resolves
 * to nothing, and a reader who pastes it gets a lie. So the text always survives
 * intact and only its PRESENTATION spans lines, aligned under the column it
 * started in so the tree still reads down the page.
 *
 * Every budget here is in {@link cellWidth} cells, never in characters, and
 * every slice is in code-unit offsets — the two are walked together by
 * {@link fitEnd} so a wide character either fits whole or starts the next line.
 *
 * Labels are the one thing that may be shortened, and they are shortened before
 * they ever get here — they are prose, not identifiers.
 */
function wrapSpans(spans: Span[], lead: Span[], continuation: string): string[] {
  const text = spanText(spans);
  const cont =
    cellWidth(continuation) <= MAP_WIDTH - MIN_WRAP
      ? continuation
      : ' '.repeat(Math.max(MAP_WIDTH - MIN_WRAP, 0));
  const lines: string[] = [];
  let cursor = 0;
  let rendered = sliceSpans(lead, 0, spanText(lead).length);
  let width = cellWidth(spanText(lead));
  for (;;) {
    const room = Math.max(MAP_WIDTH - width, 1);
    const fits = fitEnd(text, cursor, room);
    if (fits >= text.length) {
      lines.push(rendered + sliceSpans(spans, cursor, text.length));
      return lines;
    }
    // A single character wider than the room left is the one case that can make
    // no progress; it takes the line it is on rather than looping forever.
    const limit =
      fits > cursor
        ? fits
        : cursor + (String.fromCodePoint(text.codePointAt(cursor) ?? 32).length || 1);
    const cut = breakPoint(text, cursor, limit);
    lines.push(rendered + sliceSpans(spans, cursor, cut.end));
    cursor = cut.next;
    rendered = cont;
    width = cellWidth(cont);
  }
}

/**
 * {@link wrapSpans} for text that carries no accents — the act's status lines.
 *
 * The 80-column contract covers everything this command puts on a terminal, not
 * only the tree, and the next-action line is the one that most often runs long.
 */
export function wrapPlain(text: string, lead = '', continuation = ''): string[] {
  return wrapSpans([{ text, style: identity }], [{ text: lead, style: identity }], continuation);
}

/** Wrap one accented run behind a plain indent — the render's non-node lines. */
function wrapOne(text: string, style: (text: string) => string, continuation: string): string[] {
  return wrapSpans([{ text, style }], [], continuation);
}

/** Split an address so its last segment — the id a reader scans for — can be accented. */
function splitAddress(address: string): { head: string; tail: string } {
  const cut = Math.max(address.lastIndexOf('/'), address.lastIndexOf('#'));
  return cut < 0
    ? { head: '', tail: address }
    : { head: address.slice(0, cut + 1), tail: address.slice(cut + 1) };
}

function clip(text: string, width: number): string {
  if (width <= 1) return '';
  if (cellWidth(text) <= width) return text;
  return `${text.slice(0, fitEnd(text, 0, width - 1))}\u2026`;
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
 * One node as a line — connector, direction arrow, state mark, address and, only
 * if it still fits inside {@link MAP_WIDTH}, the human label.
 *
 * The address is never shortened. When it does not fit it continues onto an
 * indented line aligned under the address column, so the tree structure still
 * reads down the page and the identifier stays whole and pasteable.
 *
 * The label is display only: it is read from a small set of conventional naming
 * fields, and a schema that names nothing recognisable renders without one
 * rather than rendering a guess. It is also the only piece here that may be
 * clipped, and it is dropped entirely the moment the address needs the room.
 */
function nodeRow(
  node: DdMapNode,
  shown: string,
  prefix: string,
  continuation: string,
  arrow: string,
  palette: DdMapPalette,
  emphasise: boolean,
): string[] {
  const mark = node.mark === '' ? '   ' : node.mark;
  const progress = node.progress ? ` ${node.progress.terminal}/${node.progress.total}` : '';
  const flag = node.resolved ? '' : '  (unresolved)';
  const { head, tail } = splitAddress(shown);
  const lead = `${prefix}${arrow}${mark}${progress} `;
  const room = MAP_WIDTH - (cellWidth(lead) + cellWidth(shown) + cellWidth(flag)) - 2;
  const label = node.label !== null && room > 8 ? `  ${clip(node.label, room)}` : '';

  const accent = emphasise ? palette.seed : identity;
  const fade = node.distance > 1 ? palette.faint : identity;
  const leadSpans: Span[] = [
    { text: `${prefix}${arrow}`, style: identity },
    { text: mark, style: palette.mark(node.mark) },
    { text: `${progress} `, style: identity },
  ];
  const spans: Span[] = [
    { text: head, style: (text) => fade(palette.path(text)) },
    { text: tail, style: (text) => accent(palette.id(text)) },
    { text: flag, style: palette.alarm },
    { text: label, style: (text) => fade(palette.label(text)) },
  ];
  return wrapSpans(spans, leadSpans, padToCells(continuation, cellWidth(lead)));
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
      // Indentation is the only width this render cannot shorten, so it stops
      // growing rather than pushing a line past the budget. Past MAX_INDENT the
      // shape flattens — visibly, which is the honest way to run out of room.
      const nested =
        cellWidth(prefix) >= MAX_INDENT ? prefix : `${prefix}${last ? '  ' : '\u2502 '}`;
      if (other.parent === node.key && other.key !== node.key) {
        lines.push(
          ...nodeRow(other, shorten(other.address), connector, nested, arrow, palette, false),
        );
        branch(other, arm, nested, arrow);
        return;
      }
      const back = `\u21a9 ${shorten(other.address)}  (already shown)`;
      lines.push(
        ...wrapSpans(
          [{ text: back, style: palette.faint }],
          [{ text: connector, style: identity }],
          `${nested}  `,
        ),
      );
    });
  };

  const folder = seedFolder(result.seed.address);
  const file = result.seed.address.slice(folder === '' ? 0 : folder.length + 1);
  // The header carries the long form once so every row below can be short. No
  // address is ever truncated anywhere in this render — half an address is not a
  // shorter address, it is a wrong one — so a long one continues onto an
  // indented line instead. The caption is the LEAD rather than part of the text,
  // so a long file gets the whole first line rather than breaking at the space
  // after the caption and leaving most of that line empty.
  lines.push(
    ...wrapSpans(
      [{ text: file, style: palette.seed }],
      [{ text: 'dd graph map  ', style: palette.seed }],
      '              ',
    ),
  );
  lines.push(
    ...wrapSpans(
      [
        {
          text: folder === '' ? 'the repository root' : `${folder}/`,
          style: palette.faint,
        },
      ],
      [{ text: '  relative to ', style: palette.faint }],
      '              ',
    ),
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

    lines.push(...nodeRow(seed, shorten(seed.address), '  ', '  ', '@  ', palette, true), '');

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
      ...wrapOne(
        `  ! TRUNCATED \u2014 ${result.truncated.nodes.length} node(s) not shown`,
        palette.alarm,
        '    ',
      ),
    );
    for (const cut of result.truncated.nodes.slice(0, TRUNCATION_SAMPLE)) {
      const bound =
        cut.reason === 'depth'
          ? `depth ${result.bounds.depth}`
          : `max-nodes ${result.bounds.max_nodes}`;
      lines.push(
        ...wrapOne(`     ${bound} stopped at ${shorten(cut.address)}`, palette.alarm, '       '),
      );
    }
    const rest = result.truncated.nodes.length - TRUNCATION_SAMPLE;
    if (rest > 0) lines.push(palette.alarm(`     \u2026 and ${rest} more`));
    lines.push('');
  }

  for (const issue of result.issues) {
    lines.push(...wrapOne(`  ! ${issue.severity} ${issue.message}`, palette.alarm, '      '));
  }

  return `${lines.join('\n')}\n`;
}
