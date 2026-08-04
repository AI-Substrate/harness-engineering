/**
 * The `dd` links, ledger and doctor layer — the graph made mechanical.
 *
 * One resolver engine sits behind every face: `dd address validate --resolve`,
 * `dd link resolve`, `dd link verify-basis`, `dd links`, `dd graph` and the
 * radius-∞ doctor. Consumers outside this CLI — the flow spine's gate first —
 * import `verifyBasis` and the model types from here, never from a module path.
 *
 * Like dd-core and the schema layer, nothing here imports `output/` or an act:
 * findings are structured values, and the mapping onto the CLI's E-codes lives
 * in `acts/dd/`.
 */

// The two injected seams `DdLinkResolverDeps` is made of, re-exported so an external
// consumer can NAME them without importing a dd internal module path.
export type { SchemaResolver } from '../core/validate.js';
export type { DocLoader } from '../core/walk.js';
export {
  type DdBasisResult,
  type DdLedgerUpdate,
  findLedgerEntry,
  updateLedgerEntry,
  verifyBasis,
} from './basis.js';
export {
  type DdDoctorDeps,
  type DdDoctorFinding,
  type DdDoctorOptions,
  type DdDoctorReport,
  runDoctor,
} from './doctor.js';
export { toMermaid } from './graph.js';
export { MemoizingDocLoader } from './loader.js';
export {
  addressableAt,
  anchorForLocation,
  type DdAddressable,
  type DdAddressableKind,
  type DdDocumentIndex,
  type DdMapArm,
  type DdMapCut,
  type DdMapDeps,
  type DdMapDirection,
  type DdMapEdge,
  type DdMapMark,
  type DdMapNode,
  type DdMapOptions,
  type DdMapResult,
  indexDocument,
  isWithinLocation,
  mapAddress,
  resolveMapSeed,
} from './map.js';
export * from './model.js';
export {
  type DdLinksReport,
  type DdMapPalette,
  linksFor,
  MAP_WIDTH,
  PLAIN_MAP_PALETTE,
  renderMapTree,
  resolveLinksTarget,
  wrapPlain,
} from './report.js';
export {
  type DdLinkResolveOptions,
  type DdLinkResolverDeps,
  resolveLink,
} from './resolver.js';
export { DD_SUFFIX, type DdCorpusScan, scanCorpus } from './scan.js';
export {
  boundedWalk,
  type DdTraverseDeps,
  type DdTraverseOptions,
  type DdWalkBounds,
  type DdWalkCut,
  type DdWalkResult,
  type DdWalkStep,
  type DdWalkVisit,
  reachableFrom,
  traverseCorpus,
  UNBOUNDED,
} from './traverse.js';
