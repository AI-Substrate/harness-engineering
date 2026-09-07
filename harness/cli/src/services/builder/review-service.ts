import { ErrorCodes } from '../../output/error-codes.js';
import { posixJoin, resolveInRepo } from '../shared/posix-path.js';
import {
  builderCommand,
  builderHead,
  loadBuilderGuide,
  sameBuilderFile,
  validAmendment,
  verifyBuilderBasis,
  verifyBuilderComposition,
} from './composition-service.js';
import {
  builderFailure,
  builderRecordPath,
  readBuilderDocument,
  readBuilderRecord,
  writeBuilderRecord,
} from './records.js';
import type {
  AckReceipt,
  BuilderContext,
  BuilderDeps,
  BuilderResult,
  CompositionReceipt,
  DispatchReceipt,
  Guide,
  ReviewInput,
  ReviewReceipt,
  Stored,
} from './types.js';

/** Decode only the supported identity surface of the configured transport. */
export function callerFromWhoami(text: string, command: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const envelope = parsed as Record<string, unknown>;
  if ('error' in envelope) return undefined;
  let id: unknown;
  if (envelope.ok === true && envelope.command === 'pij whoami' && envelope.v === 2) {
    const data = envelope.data;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return undefined;
    id = (data as Record<string, unknown>).id;
  } else if (
    /(?:^|[\\/])pij(?:\.(?:cmd|exe))?$/.test(command) &&
    !('v' in envelope) &&
    !('ok' in envelope) &&
    !('command' in envelope) &&
    !('data' in envelope)
  ) {
    // The explicitly configured public wrapper has a flat whoami JSON surface.
    // Versioned/error payloads never fall through to this transport-specific shape.
    id = envelope.id;
  }
  return typeof id === 'string' && id.length > 0 && id.trim() === id ? id : undefined;
}

async function reviewIdentity(
  deps: BuilderDeps,
  context: BuilderContext,
  review: ReviewReceipt,
): Promise<BuilderResult<true>> {
  const observed = review.observed;
  if (
    review.requested.role !== 'reviewer' ||
    !observed.ready ||
    review.reviewer_id !== observed.peer_id ||
    review.requested.harness !== observed.harness ||
    review.requested.model !== observed.model ||
    (review.requested.effort !== undefined && review.requested.effort !== observed.effort) ||
    !observed.evidence.length ||
    !observed.native_session ||
    !observed.pid
  )
    return builderFailure(
      ErrorCodes.BUILDER_RUNTIME,
      'Reviewer configuration or native binding is unverified.',
      'Provide the independently observed reviewer identity/configuration and its actual evidence.',
    );
  // Resolve the caller from the supported runtime boundary, never private pij state.
  let caller = deps.env.get('PIJ_SESSION_ID');
  if (!caller) {
    const identity = await builderCommand(deps, deps.pij, ['whoami', '--json']);
    if (!identity.ok) return identity;
    caller = callerFromWhoami(identity.value, deps.pij.command);
  }
  if (!caller || caller.trim() !== caller)
    return builderFailure(
      ErrorCodes.BUILDER_RUNTIME,
      'The governing peer identity cannot be observed.',
      'Run review recording from an identified PM session or restore the configured whoami transport and its supported identity envelope.',
    );
  const excluded = new Set([caller]);
  // Historical identities remain excluded even when their unit was removed or
  // the next baseline has not been sealed. This is inspection, not authorization.
  const history = deps.fs.exists(context.teamDir)
    ? deps.fs.listRegularFilesNoFollow(context.teamDir)
    : [];
  if (history === null)
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Implementation history cannot be safely enumerated.',
      'Restore readable regular historical receipts before assigning an independent reviewer.',
    );
  for (const name of history.filter((file) =>
    /^(?:dispatch-[^/]+|ack-[^/]+|composition(?:-[^/]+)?)\.dd\.json$/.test(file),
  )) {
    const path = posixJoin(context.teamDir, name);
    if (name.startsWith('composition')) {
      const composition = readBuilderRecord<CompositionReceipt>(deps, path, 'composition');
      if (!composition.ok) return composition;
      for (const unit of composition.value.value.units) excluded.add(unit.peer_id);
      // Whoever declared an amendment authored part of the composed bytes and
      // cannot be its independent reviewer (gibbon, #200 review).
      for (const amendment of composition.value.value.amendments ?? [])
        if (validAmendment(amendment)) excluded.add(amendment.declared_by);
      continue;
    }
    const record = readBuilderRecord<DispatchReceipt | AckReceipt>(
      deps,
      path,
      name.startsWith('dispatch-') ? 'dispatch' : 'ack',
    );
    if (!record.ok) return record;
    const identity = record.value.value.observed;
    excluded.add(identity.peer_id);
    if (record.value.value.record_type === 'ack') excluded.add(record.value.value.peer_id);
    if (identity.native_session === observed.native_session || identity.pid === observed.pid)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'The reviewer shares an implementation runtime.',
        'Use a genuinely independent peer, not a renamed implementation session.',
      );
  }
  if (excluded.has(review.reviewer_id))
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'The PM or an implementation peer cannot review its own artifact.',
      'Obtain review from an independent peer.',
    );
  if (!deps.fs.realpath(observed.root))
    return builderFailure(
      ErrorCodes.BUILDER_RUNTIME,
      'The observed reviewer root is unavailable.',
      'Retain an observable reviewer checkout while recording its review.',
    );
  return { ok: true, value: true };
}

function reviewTime(recordedAt: string): number {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(recordedAt) ? Date.parse(recordedAt) : Number.NaN;
}

/** Receipt fields, not a mutable pointer or filename, identify the current attempt. */
function reviewHistory(
  deps: BuilderDeps,
  context: BuilderContext,
  scope: ReviewReceipt['scope'],
): BuilderResult<Array<{ stored: Stored<ReviewReceipt>; time: number }>> {
  const files = deps.fs.exists(context.teamDir)
    ? deps.fs.listRegularFilesNoFollow(context.teamDir)
    : [];
  if (files === null)
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Review history cannot be safely enumerated.',
      'Restore readable regular review receipts without discarding historical evidence.',
    );
  const history: Array<{ stored: Stored<ReviewReceipt>; time: number }> = [];
  const identities = new Set<string>();
  for (const file of files) {
    if (!/^review(?:-[^/]+)?\.dd\.json$/.test(file)) continue;
    const stored = readBuilderRecord<ReviewReceipt>(
      deps,
      posixJoin(context.teamDir, file),
      'review',
    );
    if (!stored.ok) return stored;
    const receipt = stored.value.value;
    if (receipt.scope !== scope) continue;
    const time = reviewTime(receipt.recorded_at);
    if (!Number.isFinite(time) || identities.has(receipt.id))
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Review history has an invalid timestamp or duplicated attempt identity.',
        'Resolve the ambiguous evidence explicitly; do not select an older approval or overwrite a preserved receipt.',
      );
    identities.add(receipt.id);
    history.push({ stored: stored.value, time });
  }
  return { ok: true, value: history };
}

/** Re-observe a recorded review without re-labelling its historical document hashes. */
export async function verifyBuilderReview(
  deps: BuilderDeps,
  context: BuilderContext,
  guide: Guide,
  scope: ReviewReceipt['scope'],
): Promise<BuilderResult<Stored<ReviewReceipt>>> {
  const history = reviewHistory(deps, context, scope);
  if (!history.ok) return history;
  let latest: (typeof history.value)[number] | undefined;
  let ambiguous = false;
  for (const entry of history.value) {
    if (!latest || entry.time > latest.time) {
      latest = entry;
      ambiguous = false;
    } else if (entry.time === latest.time) ambiguous = true;
  }
  if (!latest || ambiguous)
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'There is no uniquely current review attempt.',
      'Publish a new independently reviewed receipt with a distinct identity and strictly later recorded_at; retain all earlier receipts.',
    );
  const stored = latest.stored;
  const review = stored.value;
  if (
    review.scope !== scope ||
    review.verdict !== 'approved' ||
    review.findings.some(
      (finding) => finding.disposition === 'open' && finding.severity !== 'low',
    ) ||
    review.findings.some((finding) => finding.disposition !== 'open' && !finding.evidence?.trim())
  )
    return builderFailure(
      ErrorCodes.BUILDER_PROOF,
      'Review is not approved or material findings lack resolution evidence.',
      'Resolve material findings, attach evidence for fixed/accepted findings and obtain an approved review.',
    );
  const identity = await reviewIdentity(deps, context, review);
  if (!identity.ok) return identity;
  const report = sameBuilderFile(deps, {
    ...review.report,
    path: relocatedReport(context, review),
  });
  if (!report.ok) return report;
  const basis = await verifyBuilderBasis(deps, context, {
    source_sha: review.subject_sha,
    plan: review.plan,
    guide: review.guide,
  });
  if (!basis.ok) return basis;
  if (scope === 'composition') {
    const composition = await verifyBuilderComposition(deps, context, guide);
    if (!composition.ok) return composition;
    if (composition.value.value.artifact_sha !== review.subject_sha)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Review names a different composed artifact.',
        'Review the exact verified composition SHA.',
      );
    if (composition.value.value.units.some((unit) => unit.peer_id === review.reviewer_id))
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'An accepted implementation peer signed the composition review.',
        'Use an independent reviewer.',
      );
  }
  return { ok: true, value: stored };
}

function relocatedReport(context: BuilderContext, review: ReviewReceipt): string {
  const historicalPlan = resolveInRepo(review.plan.path, context.repoRoot);
  const historicalDir = historicalPlan.slice(0, historicalPlan.lastIndexOf('/'));
  const report = resolveInRepo(review.report.path, context.repoRoot);
  return report.startsWith(`${historicalDir}/`)
    ? `${context.planDir}${report.slice(historicalDir.length)}`
    : report;
}

export async function recordBuilderReview(
  deps: BuilderDeps,
  input: ReviewInput,
): Promise<BuilderResult<Stored<ReviewReceipt>>> {
  const loaded = loadBuilderGuide(deps, input.plan);
  if (!loaded.ok) return loaded;
  const { context, guide } = loaded.value;
  const receipt = input.receipt;
  const recordedAt = reviewTime(receipt.recorded_at);
  if (
    typeof receipt.id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(receipt.id) ||
    !['decomposition', 'composition'].includes(receipt.scope) ||
    !Number.isFinite(recordedAt)
  )
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Review attempt identity, scope or timestamp is invalid.',
      'Use a filename-safe distinct identity, a known review scope and an absolute recorded_at timestamp.',
    );
  const lock = `${builderRecordPath(context, 'review', receipt.scope)}.publish.lock`;
  const token = deps.nonce();
  let claimed = false;
  try {
    deps.fs.mkdirp(context.teamDir);
    claimed = deps.fs.createExclusive(lock, token);
    if (!claimed)
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        'Review publication is already claimed.',
        'Wait for the owning publisher or explicitly recover its interrupted claim; do not race another review attempt.',
      );
    const history = reviewHistory(deps, context, receipt.scope);
    if (!history.ok) return history;
    const existing = history.value.find((entry) => entry.stored.value.id === receipt.id);
    if (existing && JSON.stringify(existing.stored.value) !== JSON.stringify(receipt))
      return builderFailure(
        ErrorCodes.BUILDER_CONFLICT,
        'A different review attempt already uses this identity.',
        'Keep the original receipt intact and assign a new identity to the revised review.',
      );
    if (history.value.some((entry) => entry !== existing && entry.time >= recordedAt))
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'A revised review must be strictly newer than the preserved attempts.',
        'Use the actual later review timestamp; never backdate a review to bypass current evidence.',
      );
    const head = await builderHead(deps);
    if (!head.ok) return head;
    const plan = readBuilderDocument(deps, context.planPath, 'builder/plan');
    if (!plan.ok) return plan;
    if (
      receipt.plan.path !== plan.value.ref.path ||
      receipt.plan.sha256 !== plan.value.ref.sha256 ||
      receipt.guide.path !== guide.ref.path ||
      receipt.guide.sha256 !== guide.ref.sha256
    )
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Review does not bind the current plan and guide bytes.',
        'Give the reviewer the current exact inputs and collect a new receipt.',
      );
    const identity = await reviewIdentity(deps, context, receipt);
    if (!identity.ok) return identity;
    const report = sameBuilderFile(deps, receipt.report);
    if (!report.ok) return report;
    if (receipt.scope === 'composition') {
      const composition = await verifyBuilderComposition(deps, context, guide.value);
      if (!composition.ok) return composition;
      if (
        receipt.subject_sha !== composition.value.value.artifact_sha ||
        composition.value.value.units.some((unit) => unit.peer_id === receipt.reviewer_id)
      )
        return builderFailure(
          ErrorCodes.BUILDER_PROOF,
          'Review subject or independence does not match the composition.',
          'Review the actual composed SHA with a peer outside the implementation team.',
        );
    } else if (receipt.subject_sha !== head.value)
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Decomposition review must name the current committed subject.',
        'Commit the reviewed decomposition and bind review to its SHA.',
      );
    if (
      receipt.verdict === 'approved' &&
      receipt.findings.some(
        (finding) =>
          finding.severity !== 'low' &&
          (finding.disposition === 'open' || !finding.evidence?.trim()),
      )
    )
      return builderFailure(
        ErrorCodes.BUILDER_PROOF,
        'Approved review contains unresolved material findings.',
        'Resolve findings with evidence or record changes-requested honestly.',
      );
    if (existing) return { ok: true, value: existing.stored };
    // Factual progress may not live in subject_sha. Retain exact review input bytes
    // separately so later completion/relocation does not forge historical hashes.
    for (const ref of [receipt.plan, receipt.guide]) {
      const contents = deps.fs.readText(resolveInRepo(ref.path, deps.repoRoot));
      if (contents === null)
        return builderFailure(
          ErrorCodes.BUILDER_PROOF,
          'Review input disappeared.',
          'Restore the exact reviewed inputs.',
        );
      const snapshot = posixJoin(context.teamDir, `basis-${ref.sha256}.json`);
      if (!deps.fs.createExclusive(snapshot, contents)) {
        const previous = sameBuilderFile(deps, { path: snapshot, sha256: ref.sha256 });
        if (!previous.ok) return previous;
      }
    }
    const path = builderRecordPath(context, 'review', `${receipt.scope}-${receipt.id}`);
    return writeBuilderRecord(deps, path, receipt);
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      `Review publication failed: ${String(error)}`,
      'Inspect the retained review evidence and claim before retrying; never overwrite historical receipts.',
    );
  } finally {
    if (claimed) {
      try {
        if (deps.fs.readText(lock) === token) deps.fs.deleteFile(lock);
      } catch {
        // As with record-writer locks, a retained claim blocks the next publisher.
      }
    }
  }
}
