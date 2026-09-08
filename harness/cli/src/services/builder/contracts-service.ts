import { type DdDoc, parse } from '@ai-substrate/dd';
import { ErrorCodes } from '../../output/error-codes.js';
import { isWithin, posixDirname, posixRelative, resolveInRepo } from '../shared/posix-path.js';
import { checkBuilderGuide, readBuilderGuide } from './guide-service.js';
import {
  builderContext,
  builderFailure,
  builderRecordPath,
  digestBuilderFile,
  readBuilderDocument,
  readBuilderRecord,
  runBuilderCheck,
  sameBuilderDocumentIntent,
  sha256,
  writeBuilderRecord,
} from './records.js';
import type {
  BaselineInput,
  BaselineReceipt,
  BuilderContext,
  BuilderDeps,
  BuilderIssue,
  BuilderResult,
  Check,
  CheckReceipt,
  CompositionReceipt,
  FileDigest,
  Guide,
  OwnershipWarning,
  ReadinessInput,
  ReadinessReport,
  ReviewReceipt,
  Stored,
  Unit,
} from './types.js';

type Inputs = {
  context: BuilderContext;
  guide: Guide;
  planRef: FileDigest;
  guideRef: FileDigest;
  files: FileDigest[];
  checks: Check[];
  receiptPath: string;
  warnings: OwnershipWarning[];
};
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const proofId = (address: string) => address.slice(address.lastIndexOf('/') + 1);
const sameRef = (left: FileDigest, right: FileDigest) =>
  left.path === right.path && left.sha256 === right.sha256;

function loadInputs(deps: BuilderDeps, plan: string): BuilderResult<Inputs> {
  const context = builderContext(deps, plan);
  if (!context.ok) return context;
  const loaded = readBuilderGuide(deps, { plan });
  if (!loaded.ok) return loaded;
  const document = readBuilderDocument(deps, context.value.planPath, 'builder/plan');
  if (!document.ok) return document;
  const criteria = document.value.value.sections.find(
    (section) => section.name === 'acceptance_criteria',
  )?.value;
  const report = checkBuilderGuide(loaded.value, (criteria ?? []) as { id: string }[]);
  const warnings = report.warnings ?? [];
  if (!report.valid)
    return {
      ...builderFailure(
        ErrorCodes.BUILDER_NOT_READY,
        'The implementation guide is not structurally ready.',
        'Correct every named guide issue; independent architectural review remains a separate requirement.',
        report.issues,
      ),
      warnings,
    };
  const guideRef = digestBuilderFile(deps, context.value.guidePath);
  if (!guideRef.ok) return { ...guideRef, warnings };
  const files: FileDigest[] = [];
  for (const path of loaded.value.baseline.files) {
    const digest = confinedDigest(deps, path);
    if (!digest.ok) return { ...digest, warnings };
    files.push(digest.value);
  }
  const required = new Set(loaded.value.baseline.proof.map(proofId));
  const receiptPath = resolveInRepo(
    loaded.value.baseline.receipt,
    posixDirname(context.value.guidePath),
  );
  return {
    ok: true,
    value: {
      context: context.value,
      guide: loaded.value,
      planRef: document.value.ref,
      guideRef: guideRef.value,
      files,
      checks: loaded.value.checks.filter((check) => required.has(check.id)),
      receiptPath,
      warnings,
    },
  };
}

function confinedDigest(deps: BuilderDeps, path: string): BuilderResult<FileDigest> {
  const resolved = resolveInRepo(path, deps.repoRoot);
  const real = deps.fs.realpath(resolved);
  const root = deps.fs.realpath(deps.repoRoot);
  if (
    root === null ||
    real === null ||
    !isWithin(root, real) ||
    !isWithin(deps.repoRoot, resolved)
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      `Evidence is missing or outside the repository: ${path}`,
      'Restore the declared regular file inside the repository; do not substitute another evidence path.',
    );
  }
  return digestBuilderFile(deps, resolved);
}

async function git(deps: BuilderDeps, args: string[]): Promise<BuilderResult<string>> {
  try {
    const result = await deps.exec.run('git', args, { cwd: deps.repoRoot, timeoutMs: 30000 });
    if (result.code !== 0)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        `Git could not observe ${args.join(' ')}.`,
        'Restore the required committed Git evidence and retry.',
        result,
      );
    return { ok: true, value: result.stdout };
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      `Git observation failed: ${error instanceof Error ? error.message : String(error)}`,
      'Restore Git access and retry; no readiness was established.',
    );
  }
}

async function head(deps: BuilderDeps): Promise<BuilderResult<string>> {
  const root = await git(deps, ['rev-parse', '--show-toplevel']);
  if (!root.ok) return root;
  if (deps.fs.realpath(root.value.trim()) !== deps.fs.realpath(deps.repoRoot)) {
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Git is observing a different repository root.',
      'Run from the verified plan repository without Git directory overrides.',
    );
  }
  const result = await git(deps, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!result.ok) return result;
  const sha = result.value.trim();
  return OBJECT_ID.test(sha)
    ? { ok: true, value: sha }
    : builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Git did not return a full committed HEAD.',
        'Create or restore the source commit before sealing.',
      );
}

/** Compare raw blobs, not decoded git-show output: contracts can include binary fixtures. */
async function committedFiles(
  deps: BuilderDeps,
  sha: string,
  files: readonly FileDigest[],
): Promise<BuilderResult<true>> {
  if (!OBJECT_ID.test(sha))
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'The baseline does not name a full Git object ID.',
      'Seal evidence against an observed commit.',
    );
  const paths = [...new Set(files.map((file) => file.path))];
  const tree = await git(deps, ['--literal-pathspecs', 'ls-tree', '-z', sha, '--', ...paths]);
  if (!tree.ok) return tree;
  const blobs = new Map<string, string>();
  for (const entry of tree.value.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match || !OBJECT_ID.test(match[2]) || blobs.has(match[3]))
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'A committed input is not a unique regular-file blob.',
        'Commit regular files, not symlinks, trees or submodules, as baseline inputs.',
      );
    blobs.set(match[3], match[2]);
  }
  if (paths.some((path) => !blobs.has(path)))
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Declared evidence is missing from the source commit.',
      'Commit every declared contract, plan and guide before sealing.',
    );
  const hashes = await git(deps, ['hash-object', '--no-filters', '--', ...paths]);
  if (!hashes.ok) return hashes;
  const actual = hashes.value.trim().split('\n');
  if (
    actual.length !== paths.length ||
    paths.some((path, index) => blobs.get(path) !== actual[index])
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Working evidence differs from the committed baseline.',
      'Restore the sealed bytes or deliberately review and seal a new committed baseline.',
    );
  }
  return { ok: true, value: true };
}

function unchanged(deps: BuilderDeps, refs: readonly FileDigest[]): BuilderResult<true> {
  for (const ref of refs) {
    const current = confinedDigest(deps, ref.path);
    if (!current.ok) return current;
    if (!sameRef(current.value, ref))
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        `Evidence changed: ${ref.path}`,
        'Restore the reviewed evidence or review and seal a new baseline.',
      );
  }
  return { ok: true, value: true };
}

function reviewEvidence(
  deps: BuilderDeps,
  path: string,
  inputs: Pick<Inputs, 'planRef' | 'guideRef'>,
  sha: string,
  relocate: (ref: FileDigest) => FileDigest = (ref) => ref,
): BuilderResult<Stored<ReviewReceipt>> {
  const digest = confinedDigest(deps, path);
  if (!digest.ok) return digest;
  const loaded = readBuilderRecord<ReviewReceipt>(deps, path, 'review');
  if (!loaded.ok) return loaded;
  const review = loaded.value.value;
  if (
    review.scope !== 'decomposition' ||
    review.verdict !== 'approved' ||
    review.subject_sha !== sha ||
    !sameRef(review.plan, inputs.planRef) ||
    !sameRef(review.guide, inputs.guideRef) ||
    review.findings.some((finding) => finding.disposition === 'open') ||
    !review.observed.ready ||
    review.observed.peer_id !== review.reviewer_id ||
    review.requested.role !== 'reviewer' ||
    review.observed.harness !== review.requested.harness ||
    review.observed.model !== review.requested.model ||
    (review.requested.effort !== undefined && review.observed.effort !== review.requested.effort)
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Independent decomposition review is missing, red, unbound or stale.',
      'Record an approved independent review of this exact commit and plan/guide digests, with observed runtime and resolved findings.',
    );
  }
  const report = unchanged(deps, [relocate(review.report)]);
  if (!report.ok) return report;
  return loaded;
}

function proofIssues(
  checks: readonly Check[],
  receipts: readonly CheckReceipt[],
  root: string,
): BuilderIssue[] {
  const issues: BuilderIssue[] = [];
  for (const check of checks) {
    const matches = receipts.filter((receipt) => receipt.id === check.id);
    const receipt = matches[0];
    if (
      matches.length !== 1 ||
      !receipt ||
      receipt.exit_code !== 0 ||
      receipt.command !== check.command ||
      receipt.cwd !== resolveInRepo(check.cwd, root) ||
      receipt.args.length !== check.args.length ||
      receipt.args.some((arg, index) => arg !== check.args[index])
    ) {
      issues.push({
        code: 'baseline-proof',
        path: `checks/${check.id}`,
        message: `Required proof ${check.id} is absent, red, duplicate or bound to a different command.`,
        next_action:
          'Run the declared baseline checks through contracts --seal on the reviewed commit.',
      });
    }
  }
  return issues;
}

const FRESH_SEAL_ACTION =
  'Preserve any existing seal. Select a fresh guide.baseline.receipt identity before committing revised guide/inputs, obtaining their review and running contracts --seal.';

function immutableSealConflict(path: string, details?: unknown) {
  return builderFailure(
    ErrorCodes.BUILDER_CONFLICT,
    `Existing baseline receipt is immutable and cannot be reused for this attempt: ${path}`,
    FRESH_SEAL_ACTION,
    details,
  );
}

export async function sealBuilderContracts(
  deps: BuilderDeps,
  input: BaselineInput,
): Promise<BuilderResult<Stored<BaselineReceipt>>> {
  const loaded = loadInputs(deps, input.plan);
  if (!loaded.ok) return { ...loaded, next_action: `${loaded.next_action} ${FRESH_SEAL_ACTION}` };
  const result = await sealLoadedContracts(deps, input, loaded.value);
  return result.ok ? result : { ...result, warnings: loaded.value.warnings };
}

async function sealLoadedContracts(
  deps: BuilderDeps,
  input: BaselineInput,
  inputs: Inputs,
): Promise<BuilderResult<Stored<BaselineReceipt>>> {
  const previous = deps.fs.exists(inputs.receiptPath)
    ? readBuilderRecord<BaselineReceipt>(deps, inputs.receiptPath, 'baseline')
    : null;
  if (previous) {
    if (!previous.ok) return immutableSealConflict(inputs.receiptPath, previous);
    const requestedReview = confinedDigest(deps, input.review);
    const recordedReview = relocatedRef(previous.value.value.review, previous.value.value, inputs);
    if (!requestedReview.ok || !sameRef(requestedReview.value, recordedReview)) {
      return immutableSealConflict(
        inputs.receiptPath,
        'The requested review does not match the existing seal.',
      );
    }
    // Readiness observes historical proof; it never executes checks or republishes it.
    const readiness = await checkBuilderReadiness(deps, { plan: input.plan });
    if (!readiness.ok || readiness.value.status !== 'ready')
      return immutableSealConflict(inputs.receiptPath, readiness);
    if (!sameRef(readiness.value.baseline.ref, previous.value.ref))
      return immutableSealConflict(
        inputs.receiptPath,
        'The receipt changed during reuse observation.',
      );
    return { ok: true, value: previous.value };
  }
  const source = await head(deps);
  if (!source.ok) return source;
  const review = reviewEvidence(deps, input.review, inputs, source.value);
  if (!review.ok) return review;
  const refs = [inputs.planRef, inputs.guideRef, ...inputs.files];
  const committed = await committedFiles(deps, source.value, refs);
  if (!committed.ok) return committed;
  const checks: CheckReceipt[] = [];
  for (const check of inputs.checks) {
    const result = await runBuilderCheck(deps, check);
    if (!result.ok) return result;
    if (result.value.exit_code !== 0)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        `Baseline proof ${check.id} failed.`,
        'Fix the named check, commit the correction, refresh its review and seal again.',
        result.value,
      );
    checks.push(result.value);
  }
  const after = await head(deps);
  if (!after.ok) return after;
  if (after.value !== source.value)
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      'HEAD moved while baseline checks ran.',
      'Repeat review and sealing on one stable commit.',
    );
  const stable = unchanged(deps, [...refs, review.value.ref, review.value.value.report]);
  if (!stable.ok) return stable;
  if (deps.fs.exists(inputs.receiptPath))
    return immutableSealConflict(
      inputs.receiptPath,
      'Another writer published a seal while proof was running.',
    );
  return writeBuilderRecord(deps, inputs.receiptPath, {
    record_type: 'baseline',
    id: `baseline-${source.value}`,
    recorded_at: deps.clock.nowIso(),
    source_sha: source.value,
    plan: inputs.planRef,
    guide: inputs.guideRef,
    files: inputs.files,
    checks,
    review: review.value.ref,
    warnings: inputs.warnings,
  });
}

function notReady(
  result: { message: string; next_action: string; details?: unknown },
  status: 'not-ready' | 'cant-tell' = 'not-ready',
  warnings: OwnershipWarning[] = [],
): BuilderResult<ReadinessReport> {
  const fallback = { code: 'baseline', message: result.message, next_action: result.next_action };
  const issues: BuilderIssue[] =
    Array.isArray(result.details) && result.details.length > 0
      ? result.details.map((detail: unknown) => {
          if (detail === null || typeof detail !== 'object') return fallback;
          const entry = detail as Partial<BuilderIssue>;
          return {
            code: typeof entry.code === 'string' ? entry.code : 'document-invalid',
            message: typeof entry.message === 'string' ? entry.message : result.message,
            next_action:
              typeof entry.next_action === 'string' ? entry.next_action : result.next_action,
            ...(typeof entry.path === 'string' && { path: entry.path }),
          };
        })
      : [fallback];
  return { ok: true, value: { status, issues, warnings } };
}

/** Only the canonical plan-to-archive move can relocate immutable evidence. */
function relocatedRef(ref: FileDigest, baseline: BaselineReceipt, inputs: Inputs): FileDigest {
  const oldDir = posixDirname(baseline.plan.path);
  const currentDir = posixRelative(inputs.context.repoRoot, inputs.context.planDir);
  if (currentDir === oldDir) return ref;
  const plan = /^docs\/plans\/(?:archive\/)?([^/]+)$/.exec(oldDir);
  if (!plan || ![`docs/plans/${plan[1]}`, `docs/plans/archive/${plan[1]}`].includes(currentDir))
    return ref;
  return ref.path.startsWith(`${oldDir}/`)
    ? { ...ref, path: `${currentDir}${ref.path.slice(oldDir.length)}` }
    : ref;
}

/** Resolve local DD addresses using their real source locations; shared records owns intent policy. */
function resolveDocumentAddresses(doc: DdDoc, documentPath: string, repoRoot: string): DdDoc {
  const resolvePath = (path: string) =>
    /^[a-z]+:\/\//i.test(path)
      ? path
      : posixRelative(repoRoot, resolveInRepo(path, posixDirname(documentPath)));
  const resolveValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const address = /^([^\s#]*\.dd\.(?:json|md))(#[^\s]*)?$/.exec(value);
      return address ? `${resolvePath(address[1])}${address[2] ?? ''}` : value;
    }
    if (Array.isArray(value)) return value.map(resolveValue);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, resolveValue(child)]),
      );
    return value;
  };
  return {
    ...doc,
    sections: doc.sections.map((section) => ({ ...section, value: resolveValue(section.value) })),
    references: (doc.references ?? []).map((reference) => ({
      ...reference,
      path: resolvePath(reference.path),
    })),
  };
}

async function historicalDocuments(
  deps: BuilderDeps,
  inputs: Inputs,
  baseline: BaselineReceipt,
): Promise<BuilderResult<true>> {
  for (const [original, current] of [
    [baseline.plan, inputs.planRef],
    [baseline.guide, inputs.guideRef],
  ]) {
    if (relocatedRef(original, baseline, inputs).path !== current.path)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'The baseline belongs to a different plan or guide.',
        'Select the original plan or its canonical archive relocation.',
      );
    const historical = await git(deps, ['show', `${baseline.source_sha}:${original.path}`]);
    if (!historical.ok) return historical;
    if (sha256(historical.value) !== original.sha256)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Historical document bytes do not match the sealed digest.',
        'Restore the actual reviewed baseline; do not rewrite its receipt.',
      );
    const before = parse(historical.value);
    const now = deps.fs.readTextFileNoFollow(
      deps.repoRoot,
      resolveInRepo(current.path, deps.repoRoot),
      4 * 1024 * 1024,
    );
    if (now.status !== 'ok' || sha256(now.text) !== current.sha256)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Current document changed during observation.',
        'Repeat readiness against stable document bytes.',
      );
    const after = parse(now.text);
    if (
      Array.isArray(before) ||
      Array.isArray(after) ||
      !sameBuilderDocumentIntent(
        resolveDocumentAddresses(
          before,
          resolveInRepo(original.path, deps.repoRoot),
          deps.repoRoot,
        ),
        resolveDocumentAddresses(after, resolveInRepo(current.path, deps.repoRoot), deps.repoRoot),
        posixRelative(posixDirname(inputs.context.planDir), inputs.context.planDir),
      )
    ) {
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        `Material implementation intent changed: ${current.path}`,
        'Review changed intent and seal a new baseline; factual progress alone does not require resealing.',
      );
    }
  }
  return { ok: true, value: true };
}

async function dependencyEvidence(
  deps: BuilderDeps,
  inputs: Inputs,
  baseline: Stored<BaselineReceipt>,
  unit: Unit,
  currentHead: string,
): Promise<BuilderResult<FileDigest[]>> {
  const units = new Map(inputs.guide.units.map((candidate) => [candidate.id, candidate]));
  const required = new Set<string>();
  const visit = (id: string) => {
    if (required.has(id)) return;
    required.add(id);
    for (const dependency of units.get(id)?.depends_on ?? []) visit(dependency);
  };
  unit.depends_on.forEach(visit);
  const checks = new Set(inputs.checks.map((check) => check.id));
  const missing = [...required].filter((id) => {
    const dependency = units.get(id);
    return !dependency || dependency.proof.some((address) => !checks.has(proofId(address)));
  });
  if (missing.length === 0) return { ok: true, value: [] };
  const composition = readBuilderRecord<CompositionReceipt>(
    deps,
    builderRecordPath(inputs.context, 'composition'),
    'composition',
  );
  if (!composition.ok)
    return builderFailure(
      ErrorCodes.BUILDER_NOT_READY,
      `Dependencies lack committed proof: ${missing.join(', ')}`,
      'Complete and verify those dependencies in the composition receipt before dispatching this unit.',
    );
  const receipt = composition.value.value;
  const proofIds = new Set(inputs.guide.composition.proof.map(proofId));
  const proof = proofIssues(
    inputs.guide.checks.filter((check) => proofIds.has(check.id)),
    receipt.checks,
    deps.repoRoot,
  );
  if (
    !sameRef(relocatedRef(receipt.baseline, baseline.value, inputs), baseline.ref) ||
    !receipt.artifact_sha ||
    !OBJECT_ID.test(receipt.artifact_sha) ||
    proof.length > 0 ||
    receipt.files.length === 0 ||
    missing.some(
      (id) =>
        receipt.units.filter(
          (delivery) =>
            delivery.unit_id === id && delivery.baseline_sha === baseline.value.source_sha,
        ).length !== 1,
    )
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_NOT_READY,
      'Dependency composition is absent, unverified or bound to a different baseline.',
      'Verify the committed dependency composition and its named integration proof; imported claims alone do not permit dispatch.',
    );
  }
  const ancestor = await git(deps, [
    'merge-base',
    '--is-ancestor',
    receipt.artifact_sha,
    currentHead,
  ]);
  if (!ancestor.ok) return ancestor;
  const stable = unchanged(deps, receipt.files);
  if (!stable.ok) return stable;
  const committed = await committedFiles(deps, receipt.artifact_sha, receipt.files);
  if (!committed.ok) return committed;
  return { ok: true, value: [composition.value.ref, ...receipt.files] };
}

export async function checkBuilderReadiness(
  deps: BuilderDeps,
  input: ReadinessInput,
): Promise<BuilderResult<ReadinessReport>> {
  const loaded = loadInputs(deps, input.plan);
  if (!loaded.ok) return notReady(loaded, 'not-ready', loaded.warnings);
  const inputs = loaded.value;
  const unavailable = (
    result: { message: string; next_action: string; details?: unknown },
    status: 'not-ready' | 'cant-tell' = 'not-ready',
  ) => notReady(result, status, inputs.warnings);
  const unit =
    input.unit === undefined
      ? undefined
      : inputs.guide.units.find((candidate) => candidate.id === input.unit);
  if (
    input.unit !== undefined &&
    (unit?.role !== 'coder' || inputs.guide.fan_out.decision !== 'coders')
  ) {
    return unavailable({
      message: `Unit ${input.unit} is not a dispatchable coder.`,
      next_action: 'Select a declared coder unit; PM and solo decisions are never peer dispatches.',
    });
  }
  const stored = readBuilderRecord<BaselineReceipt>(deps, inputs.receiptPath, 'baseline');
  if (!stored.ok) return unavailable(stored);
  const baseline = stored.value.value;
  if (
    baseline.files.length !== inputs.files.length ||
    inputs.files.some(
      (file) => baseline.files.filter((candidate) => sameRef(file, candidate)).length !== 1,
    )
  ) {
    return unavailable({
      message: 'The plan, guide or shared contract files differ from the sealed baseline.',
      next_action:
        'Restore the bound inputs or deliberately review and seal a new committed baseline.',
    });
  }
  const proof = proofIssues(inputs.checks, baseline.checks, deps.repoRoot);
  if (proof.length > 0)
    return { ok: true, value: { status: 'not-ready', issues: proof, warnings: inputs.warnings } };
  const relocate = (ref: FileDigest) => relocatedRef(ref, baseline, inputs);
  const reviewRef = relocate(baseline.review);
  const reviewDigest = unchanged(deps, [reviewRef]);
  if (!reviewDigest.ok) return unavailable(reviewDigest);
  const review = reviewEvidence(
    deps,
    reviewRef.path,
    { planRef: baseline.plan, guideRef: baseline.guide },
    baseline.source_sha,
    relocate,
  );
  if (!review.ok) return unavailable(review);
  const source = await head(deps);
  if (!source.ok) return unavailable(source, 'cant-tell');
  if (!OBJECT_ID.test(baseline.source_sha))
    return unavailable({
      message: 'The baseline source SHA is invalid.',
      next_action: 'Seal a baseline from an observed full commit SHA.',
    });
  // Publishing receipts and later implementation commits are allowed; rewriting the baseline is not.
  const ancestor = await git(deps, [
    'merge-base',
    '--is-ancestor',
    baseline.source_sha,
    source.value,
  ]);
  if (!ancestor.ok) return unavailable(ancestor);
  const documents = await historicalDocuments(deps, inputs, baseline);
  if (!documents.ok) return unavailable(documents);
  const refs = [inputs.planRef, inputs.guideRef, ...inputs.files];
  const committed = await committedFiles(deps, baseline.source_sha, inputs.files);
  if (!committed.ok) return unavailable(committed);
  const dependencies = unit
    ? await dependencyEvidence(deps, inputs, stored.value, unit, source.value)
    : { ok: true as const, value: [] };
  if (!dependencies.ok) return unavailable(dependencies);
  const stable = unchanged(deps, [
    ...refs,
    stored.value.ref,
    reviewRef,
    review.value.ref,
    relocate(review.value.value.report),
    ...dependencies.value,
  ]);
  if (!stable.ok) return unavailable(stable);
  const after = await head(deps);
  if (!after.ok) return unavailable(after, 'cant-tell');
  if (after.value !== source.value)
    return unavailable(
      {
        message: 'HEAD moved during readiness observation.',
        next_action: 'Repeat readiness against a stable workspace.',
      },
      'cant-tell',
    );
  return {
    ok: true,
    value: {
      status: 'ready',
      issues: [],
      warnings: inputs.warnings,
      context: inputs.context,
      guide: inputs.guide,
      baseline: stored.value,
    },
  };
}
