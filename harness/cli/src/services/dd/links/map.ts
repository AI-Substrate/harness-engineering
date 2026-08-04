import { posixRelative, resolveInRepo } from '../../shared/posix-path.js';
import { isAddressFailure, parseAddress } from '../core/address.js';
import { DEFAULT_GATE_TERMINAL_STATES } from '../core/constants.js';
import { deriveItems } from '../core/derive.js';
import type { DdDoc, DdShape, ResolvedDdSchema } from '../core/model.js';
import { isPathWithinRepo, type SchemaResolver } from '../core/validate.js';
import { isRecord } from '../core/value.js';
import type { DocLoader } from '../core/walk.js';
import { type DdLinkEdge, type DdLinkIssue, linkIssue } from './model.js';
import { resolveLink } from './resolver.js';
import { boundedWalk, type DdWalkCut } from './traverse.js';

/**
 * What a segment turned out to BE once the shape was walked — the same three
 * kinds the resolver reports, plus the two this index needs and an address
 * cannot name: the document itself, and an array member with no id.
 */
export type DdAddressableKind = 'anonymous' | 'document' | 'instance' | 'part' | 'section';

/**
 * One addressable place in a document, holding BOTH of its names at once.
 *
 * This pairing is the whole point. An address names an interior
 * (`acceptance_criteria/ac-0201`); an edge names a location
 * (`$.sections[acceptance_criteria].value[0].pressure`). Until now nothing in
 * this layer could turn one into the other, which is exactly why `dd links`
 * answers about the whole document when you hand it a row: the address was
 * parsed, and then discarded.
 *
 * `location` is `null` for the document node, which every location is inside.
 */
export interface DdAddressable {
  interior: string[];
  location: string | null;
  kind: DdAddressableKind;
  value: unknown;
  /**
   * The gate-terminal set governing THIS node's own `state`, from the schema —
   * so a schema that declares `shipped`/`waived` marks its rows correctly
   * instead of against a hard-coded list. `null` when nothing here is stateful.
   */
  terminal: readonly string[] | null;
}

export interface DdDocumentIndex {
  path: string;
  entries: DdAddressable[];
}

const LABEL_FIELDS = [
  'title',
  'claim',
  'criterion',
  'assertion',
  'text',
  'brief',
  'summary',
  'name',
] as const;

/**
 * The gate-terminal set that governs a shape's own `state` field.
 *
 * `state` takes the built-in completion set; a declared enum takes its own
 * `gate_terminal` and, when it declares none, takes nothing — an enum without a
 * terminal set has not said what "done" means for it, and inventing one would
 * mark a row passing on a claim its schema never made. Array shapes answer for
 * their members, so a section reports the set its rows are judged by.
 *
 * The render layer computes the same thing for the markdown it emits. It is
 * restated here rather than imported because this layer must never reach into
 * `dd/render` — the boundary that keeps `dd graph` independent of it is
 * arch-enforced (`isolation.test.ts`), so the four lines are the cheap side of
 * that trade.
 */
function terminalFor(
  shape: DdShape | undefined,
  schema: ResolvedDdSchema,
): readonly string[] | null {
  if (!shape) return null;
  if (shape.type === 'array') return terminalFor(shape.items, schema);
  if (shape.type !== 'object') return null;
  const state = shape.fields?.state;
  if (!state) return null;
  if (state.type === 'state') return DEFAULT_GATE_TERMINAL_STATES;
  if (state.type === 'enum' && state.enum) return schema.enums?.[state.enum]?.gate_terminal ?? null;
  return null;
}

/**
 * Every addressable place in one document, with the location each one occupies.
 *
 * The recursion mirrors `collectLinkCells` exactly — array members index by
 * position, declared object fields append `.field`, and a dynamic-key map (OD-8)
 * appends `.key` — because the locations this produces have to be the same
 * strings the edges carry. It is shape-directed, never positional: an id is read
 * off the DATA, so a row's location can never be guessed from how its id reads.
 *
 * An array member with no `id` is `anonymous`: it earns no address of its own,
 * so it is indexed under its CONTAINER's interior. Anything it holds therefore
 * still attributes to the nearest thing a reader can actually cite.
 */
export function indexDocument(path: string, doc: DdDoc, schema: ResolvedDdSchema): DdDocumentIndex {
  const entries: DdAddressable[] = [
    { interior: [], location: null, kind: 'document', value: doc, terminal: null },
  ];

  const visit = (
    value: unknown,
    shape: DdShape | undefined,
    interior: string[],
    location: string,
    kind: DdAddressableKind,
  ): void => {
    entries.push({ interior, location, kind, value, terminal: terminalFor(shape, schema) });
    if (!shape) return;
    if (shape.type === 'array' && Array.isArray(value) && shape.items) {
      const items = shape.items;
      value.forEach((entry, index) => {
        const id = isRecord(entry) && typeof entry.id === 'string' ? entry.id : null;
        visit(
          entry,
          items,
          id === null ? interior : [...interior, id],
          `${location}[${index}]`,
          id === null ? 'anonymous' : 'instance',
        );
      });
      return;
    }
    if (shape.type === 'object' && isRecord(value)) {
      for (const [field, fieldShape] of Object.entries(shape.fields ?? {})) {
        if (field in value) {
          visit(value[field], fieldShape, [...interior, field], `${location}.${field}`, 'part');
        }
      }
      const valuesShape = shape.valuesShape;
      if (valuesShape) {
        for (const [key, entry] of Object.entries(value)) {
          if (shape.fields && key in shape.fields) continue;
          // A map entry reached by its own id is an INSTANCE, exactly as the
          // resolver classifies it — kind is what the segment turned out to be.
          visit(entry, valuesShape, [...interior, key], `${location}.${key}`, 'instance');
        }
      }
    }
  };

  const sections = new Map(doc.sections.map((section) => [section.name, section]));
  for (const [name, declaration] of Object.entries(schema.sections)) {
    const section = sections.get(name);
    if (section) {
      visit(section.value, declaration.shape, [name], `$.sections[${name}].value`, 'section');
    }
  }
  return { path, entries };
}

/**
 * Is `location` at, or inside, `prefix`?
 *
 * The boundary check is not decoration: `…value[1]` is a textual prefix of
 * `…value[10].pressure`, so a bare `startsWith` would scope row 1 to row 10's
 * links. A real containment continues with `.` or `[`, or not at all.
 *
 * A `null` prefix is the document node — everything is inside it, which is how
 * a document-shaped seed keeps `dd links`' whole-document answer.
 */
export function isWithinLocation(location: string, prefix: string | null): boolean {
  if (prefix === null) return true;
  if (location === prefix) return true;
  if (!location.startsWith(prefix)) return false;
  const next = location.charAt(prefix.length);
  return next === '.' || next === '[';
}

function interiorKey(interior: readonly string[]): string {
  return interior.join('/');
}

/** The addressable entry an interior names, or `undefined` when the document has none. */
export function addressableAt(
  index: DdDocumentIndex,
  interior: readonly string[],
): DdAddressable | undefined {
  const key = interiorKey(interior);
  return index.entries.find(
    (entry) => entry.kind !== 'anonymous' && interiorKey(entry.interior) === key,
  );
}

/**
 * The address a reader would cite for something sitting at `location`.
 *
 * The inverse of {@link addressableAt}, and the inbound arm depends on it: an
 * inbound edge is found by its LOCATION inside the citing document, and "what
 * points at this row" is only a useful answer if it names the row that points,
 * not the file it lives in.
 *
 * It resolves to the nearest enclosing INSTANCE — the id-bearing thing — and
 * falls back to the section, then the document. A cell is deliberately not the
 * answer: `#entries/lg-0201` is what someone cites, `#entries/lg-0201/links` is
 * where the string happens to sit.
 */
export function anchorForLocation(index: DdDocumentIndex, location: string): string[] {
  let deepest: DdAddressable | undefined;
  for (const entry of index.entries) {
    if (entry.location === null) continue;
    if (!isWithinLocation(location, entry.location)) continue;
    if (!deepest || entry.location.length > (deepest.location?.length ?? 0)) deepest = entry;
  }
  if (!deepest) return [];
  for (let depth = deepest.interior.length; depth > 0; depth -= 1) {
    const candidate = addressableAt(index, deepest.interior.slice(0, depth));
    if (candidate?.kind === 'instance') return candidate.interior;
  }
  return deepest.interior.slice(0, 1);
}

export type DdMapDirection = 'both' | 'in' | 'out';
export type DdMapArm = 'in' | 'out' | 'seed';
export type DdMapMark = '' | '[ ]' | '[-]' | '[x]' | '[~]';

export interface DdMapNode {
  /** Identity within one walk: the arm plus the address. */
  key: string;
  /** Repo-relative `path#interior`, or the raw cell when it resolves to nothing. */
  address: string;
  path: string | null;
  interior: string[];
  arm: DdMapArm;
  distance: number;
  /** Walk key of the node this one was first reached from — `null` for the seed. */
  parent: string | null;
  kind: DdAddressableKind | 'unresolved';
  mark: DdMapMark;
  /** Terminal/total, only when the mark was derived from descendants (`[~]`). */
  progress: { terminal: number; total: number } | null;
  label: string | null;
  resolved: boolean;
}

/** An edge of the map, always written in CITATION direction: `from` cites `to`. */
export interface DdMapEdge {
  from: string;
  to: string;
  address: string;
  location: string;
  /** The relation the edge carries, so a reader sees WHY one row points at another. */
  rel: string;
  /** Which arm of the walk found it — the question it answers, not its direction. */
  arm: 'in' | 'out';
}

export interface DdMapCut {
  address: string;
  reason: DdWalkCut['reason'];
  arm: DdMapArm;
}

export interface DdMapResult {
  seed: {
    address: string;
    path: string;
    interior: string[];
    /** The derived location prefix every outbound edge of the seed sits inside. */
    location: string | null;
    kind: DdAddressableKind;
  };
  /** The bounds this walk actually ran under — echoed so an answer explains itself. */
  bounds: { depth: number; max_nodes: number; direction: DdMapDirection };
  nodes: DdMapNode[];
  edges: DdMapEdge[];
  /** Always present, `cut: false` when nothing was dropped — an absent key reads as "complete". */
  truncated: { cut: boolean; nodes: DdMapCut[] };
  issues: DdLinkIssue[];
}

export interface DdMapDeps {
  schemaResolver: SchemaResolver;
  docLoader: DocLoader;
}

export interface DdMapOptions {
  repoRoot: string;
  depth: number;
  maxNodes: number;
  direction: DdMapDirection;
  /**
   * Follow only edges carrying one of these relations. Undefined means every
   * relation — a filter that defaults to something would quietly answer a
   * different question than the one asked.
   */
  rels?: readonly string[];
}

export type DdMapSeedResult =
  | { ok: true; path: string; interior: string[] }
  | { ok: false; issues: DdLinkIssue[] };

/**
 * Resolve the `<address>` argument to the document and interior it names.
 *
 * An address with an interior goes through `resolveLink` — the one engine every
 * other dd face resolves through — so a bad seed fails with the SAME reason
 * (`id-not-found`, `section-unknown`, `path-escape`) it would fail with
 * anywhere else, rather than with a second opinion invented here. A bare path
 * names the document, which is the whole-document question `dd links` answers.
 */
export function resolveMapSeed(
  raw: string,
  deps: DdMapDeps,
  options: { repoRoot: string },
): DdMapSeedResult {
  if (!raw.includes('#')) {
    const path = resolveInRepo(raw, options.repoRoot);
    if (!isPathWithinRepo(path, options.repoRoot)) {
      return {
        ok: false,
        issues: [
          linkIssue(
            'link-unresolved',
            'ERROR',
            raw,
            `address resolves outside the repository: ${path}`,
            raw,
            'path-escape',
          ),
        ],
      };
    }
    const loaded = deps.docLoader.load(path);
    if (!loaded.ok) {
      return {
        ok: false,
        issues: [
          linkIssue('link-unresolved', 'ERROR', raw, loaded.message, raw, 'file-unreadable'),
        ],
      };
    }
    return { ok: true, path, interior: [] };
  }
  const resolved = resolveLink(raw, deps, { repoRoot: options.repoRoot, fromPath: null });
  if (!resolved.ok) return { ok: false, issues: resolved.issues };
  return {
    ok: true,
    path: resolved.target.path,
    interior: resolved.target.segments.map((segment) => segment.value),
  };
}

function nodeId(path: string, interior: readonly string[]): string {
  return interior.length > 0 ? `${path}#${interior.join('/')}` : path;
}

function displayAddress(repoRoot: string, path: string, interior: readonly string[]): string {
  const relative = posixRelative(repoRoot, path);
  return nodeId(relative.length > 0 ? relative : path, interior);
}

function labelOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!isRecord(value)) return null;
  for (const field of LABEL_FIELDS) {
    const candidate = value[field];
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }
  return null;
}

/**
 * The state mark for one addressable node, in the vocabulary the rendered
 * markdown already uses: `[x]` passes, `[ ]` holds, `[-]` blocked, `[~] t/n`
 * partial.
 *
 * A node that carries its OWN `state` answers with it — that is the claim its
 * author made. Anything else answers from its descendants through `deriveItems`,
 * the single structural state collector in dd-core, so this cannot disagree with
 * what `deriveState` reports for the same subtree.
 */
function markOf(entry: DdAddressable): { mark: DdMapMark; progress: DdMapNode['progress'] } {
  const terminal = new Set(entry.terminal ?? DEFAULT_GATE_TERMINAL_STATES);
  if (isRecord(entry.value) && typeof entry.value.state === 'string') {
    const state = entry.value.state;
    if (state === 'blocked') return { mark: '[-]', progress: null };
    return { mark: terminal.has(state) ? '[x]' : '[ ]', progress: null };
  }
  const items = deriveItems({ name: entry.interior.at(0) ?? 'document', value: entry.value });
  if (items.length === 0) return { mark: '', progress: null };
  const done = items.filter((item) => terminal.has(item.state)).length;
  if (done === items.length) return { mark: '[x]', progress: null };
  if (done === 0) return { mark: '[ ]', progress: null };
  return { mark: '[~]', progress: { terminal: done, total: items.length } };
}

function isPrefixOf(prefix: readonly string[], segments: readonly string[]): boolean {
  return prefix.length <= segments.length && prefix.every((part, i) => part === segments[i]);
}

/**
 * Map one address: everything it reaches, and everything that reaches it.
 *
 * Two questions in one bounded breadth-first walk over an edge list that already
 * exists. Nothing is stored and nothing is indexed across calls (D11) — the
 * corpus is scanned, the graph is built, and this is a reading of it.
 *
 * What is new here is that the reading is ITEM-scoped. An edge belongs to the
 * addressed row when its location falls inside that row's derived location
 * prefix, so seeding at an AC row answers about the AC row rather than about the
 * file it happens to live in.
 *
 * Both arms are seeded into ONE walk so they share the node budget by distance
 * rather than by whichever arm was expanded first; the seed is scheduled once,
 * so a citation that points back at it closes the cycle instead of duplicating
 * it. The budget is not split evenly — level order guarantees only that a deeper
 * node never displaces a nearer one on the other arm.
 */
export function mapAddress(
  seed: { path: string; interior: string[] },
  edges: readonly DdLinkEdge[],
  deps: DdMapDeps,
  options: DdMapOptions,
): DdMapResult {
  const issues: DdLinkIssue[] = [];
  const indexes = new Map<string, DdDocumentIndex | null>();

  const indexFor = (path: string): DdDocumentIndex | null => {
    const cached = indexes.get(path);
    if (cached !== undefined) return cached;
    const loaded = deps.docLoader.load(path);
    if (!loaded.ok) {
      indexes.set(path, null);
      return null;
    }
    const resolved = deps.schemaResolver.resolve(loaded.doc.dd.schema, loaded.path);
    if (!resolved.ok) {
      indexes.set(path, null);
      return null;
    }
    const index = indexDocument(path, loaded.doc, resolved.schema);
    indexes.set(path, index);
    return index;
  };

  interface Descriptor {
    address: string;
    path: string | null;
    interior: string[];
    kind: DdAddressableKind | 'unresolved';
    mark: DdMapMark;
    progress: DdMapNode['progress'];
    label: string | null;
    resolved: boolean;
  }

  const descriptors = new Map<string, Descriptor>();

  const describe = (path: string, interior: string[]): Descriptor => {
    const index = indexFor(path);
    const entry = index ? addressableAt(index, interior) : undefined;
    const address = displayAddress(options.repoRoot, path, interior);
    if (!entry) {
      return {
        address,
        path,
        interior,
        kind: 'unresolved',
        mark: '',
        progress: null,
        label: null,
        resolved: false,
      };
    }
    const { mark, progress } = markOf(entry);
    return {
      address,
      path,
      interior,
      kind: entry.kind,
      mark,
      progress,
      label: labelOf(entry.value),
      resolved: true,
    };
  };

  const seedId = nodeId(seed.path, seed.interior);
  const seedKey = `seed\u0000${seedId}`;
  descriptors.set(seedKey, describe(seed.path, seed.interior));

  /** The seed is one node on both arms: a citation back to it closes a cycle. */
  const keyFor = (arm: 'in' | 'out', id: string): string =>
    id === seedId ? seedKey : `${arm}\u0000${id}`;

  const register = (key: string, descriptor: Descriptor): void => {
    if (!descriptors.has(key)) descriptors.set(key, descriptor);
  };

  const outboundSteps = (
    arm: 'in' | 'out',
    from: Descriptor,
  ): { key: string; edge: DdMapEdge }[] => {
    if (from.path === null) return [];
    const index = indexFor(from.path);
    if (!index) return [];
    const anchor = addressableAt(index, from.interior);
    if (!anchor) return [];
    const fromKey = keyFor(arm, nodeId(from.path, from.interior));
    const steps: { key: string; edge: DdMapEdge }[] = [];
    for (const edge of edges) {
      if (edge.from !== from.path) continue;
      if (options.rels !== undefined && !options.rels.includes(edge.rel)) continue;
      if (!isWithinLocation(edge.location, anchor.location)) continue;
      const parsed = parseAddress(edge.address);
      if (edge.to === null || isAddressFailure(parsed)) {
        // A dangling cell is a node, not a silence: the map exists to show that
        // this row points at something that is not there.
        const key = `${arm}\u0000!${edge.from}\u0000${edge.location}`;
        register(key, {
          address: edge.address,
          path: null,
          interior: [],
          kind: 'unresolved',
          mark: '',
          progress: null,
          label: null,
          resolved: false,
        });
        steps.push({
          key,
          edge: {
            from: fromKey,
            to: key,
            address: edge.address,
            location: edge.location,
            rel: edge.rel,
            arm,
          },
        });
        continue;
      }
      const interior = parsed.segments.map((segment) => segment.value);
      const key = keyFor(arm, nodeId(edge.to, interior));
      register(key, describe(edge.to, interior));
      steps.push({
        key,
        edge: {
          from: fromKey,
          to: key,
          address: edge.address,
          location: edge.location,
          rel: edge.rel,
          arm,
        },
      });
    }
    return steps;
  };

  const inboundSteps = (arm: 'in', to: Descriptor): { key: string; edge: DdMapEdge }[] => {
    if (to.path === null) return [];
    const toKey = keyFor(arm, nodeId(to.path, to.interior));
    const steps: { key: string; edge: DdMapEdge }[] = [];
    for (const edge of edges) {
      if (edge.to !== to.path) continue;
      if (options.rels !== undefined && !options.rels.includes(edge.rel)) continue;
      const parsed = parseAddress(edge.address);
      if (isAddressFailure(parsed)) continue;
      const target = parsed.segments.map((segment) => segment.value);
      // An edge reaches this node when it lands AT it or INSIDE it: a citation of
      // `#acceptance_criteria/ac-0201` reaches the section too, but a citation of
      // the section does not reach one particular row inside it.
      if (!isPrefixOf(to.interior, target)) continue;
      const index = indexFor(edge.from);
      const interior = index ? anchorForLocation(index, edge.location) : [];
      const key = keyFor(arm, nodeId(edge.from, interior));
      if (key === toKey) continue;
      register(key, describe(edge.from, interior));
      steps.push({
        key,
        edge: {
          from: key,
          to: toKey,
          address: edge.address,
          location: edge.location,
          rel: edge.rel,
          arm,
        },
      });
    }
    return steps;
  };

  const expand = (key: string): { key: string; edge: DdMapEdge }[] => {
    const descriptor = descriptors.get(key);
    if (!descriptor?.resolved) return [];
    const arm = key.slice(0, key.indexOf('\u0000')) as DdMapArm;
    if (arm === 'seed') {
      return [
        ...(options.direction === 'in' ? [] : outboundSteps('out', descriptor)),
        ...(options.direction === 'out' ? [] : inboundSteps('in', descriptor)),
      ];
    }
    return arm === 'out' ? outboundSteps('out', descriptor) : inboundSteps('in', descriptor);
  };

  const walk = boundedWalk<DdMapEdge>([seedKey], expand, {
    depth: options.depth,
    maxNodes: options.maxNodes,
  });

  // The walk's own keys carry a NUL separator, which is the right thing INSIDE a
  // Set and the wrong thing in an envelope. Emitted identity is `n0…nN` in visit
  // order — the same convention `toMermaid` uses, stable for the same corpus, and
  // safe for every consumer that reads this with `jq`.
  const emitted = new Map(walk.order.map((visit, index) => [visit.key, `n${index}`]));
  const nodes: DdMapNode[] = walk.order.map((visit) => {
    const descriptor = descriptors.get(visit.key);
    const arm = visit.key.slice(0, visit.key.indexOf('\u0000')) as DdMapArm;
    const via = visit.via;
    const parentKey = via === null ? null : arm === 'out' ? via.from : via.to;
    return {
      key: emitted.get(visit.key) ?? visit.key,
      address: descriptor?.address ?? visit.key,
      path: descriptor?.path ?? null,
      interior: descriptor?.interior ?? [],
      arm,
      distance: visit.distance,
      // The edge that first REACHED this node, read in walk direction: outbound
      // nodes hang off their citer, inbound nodes off the node they cite.
      parent: parentKey === null ? null : (emitted.get(parentKey) ?? parentKey),
      kind: descriptor?.kind ?? 'unresolved',
      mark: descriptor?.mark ?? '',
      progress: descriptor?.progress ?? null,
      label: descriptor?.label ?? null,
      resolved: descriptor?.resolved ?? false,
    };
  });

  const cuts: DdMapCut[] = walk.cuts.map((cut) => ({
    address: descriptors.get(cut.key)?.address ?? cut.key,
    reason: cut.reason,
    arm: cut.key.slice(0, cut.key.indexOf('\u0000')) as DdMapArm,
  }));

  const seedIndex = indexFor(seed.path);
  const seedEntry = seedIndex ? addressableAt(seedIndex, seed.interior) : undefined;
  if (!seedEntry) {
    issues.push(
      linkIssue(
        'link-scan-incomplete',
        'WARN',
        nodeId(seed.path, seed.interior),
        'the seed document could not be indexed — its outbound edges are unknown',
        seed.path,
      ),
    );
  }

  return {
    seed: {
      address: displayAddress(options.repoRoot, seed.path, seed.interior),
      path: seed.path,
      interior: seed.interior,
      location: seedEntry?.location ?? null,
      kind: seedEntry?.kind ?? 'document',
    },
    bounds: { depth: options.depth, max_nodes: options.maxNodes, direction: options.direction },
    nodes,
    edges: walk.edges.map((edge) => ({
      ...edge,
      from: emitted.get(edge.from) ?? edge.from,
      to: emitted.get(edge.to) ?? edge.to,
    })),
    truncated: { cut: cuts.length > 0, nodes: cuts },
    issues,
  };
}
