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
export * from './model.js';
export { type DdLinksReport, linksFor, resolveLinksTarget } from './report.js';
export {
  type DdLinkResolveOptions,
  type DdLinkResolverDeps,
  resolveLink,
} from './resolver.js';
export { DD_SUFFIX, type DdCorpusScan, scanCorpus } from './scan.js';
export {
  type DdTraverseDeps,
  type DdTraverseOptions,
  reachableFrom,
  traverseCorpus,
} from './traverse.js';
