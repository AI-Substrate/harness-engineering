import { parse } from '@ai-substrate/dd';
import { ErrorCodes } from '../../output/error-codes.js';
import { isWithin, posixDirname, posixJoin, resolveInRepo, toPosix } from '../shared/posix-path.js';
import { builderFailure, readBuilderDocument, writeBuilderDocument } from './records.js';
import type { BuilderDeps, BuilderResult } from './types.js';

/** Stage whole missing packages. Existing packages belong to the consumer, including partial/custom packages. */
export function stageBuilderSchemas(deps: BuilderDeps, root: string): BuilderResult<string[]> {
  const source = deps.fs.realpath(deps.schemasDir);
  const target = posixJoin(root, '.dd/schemas/builder');
  const rootIdentity = deps.fs.realpath(root);
  if (
    source === null ||
    rootIdentity === null ||
    !isWithin(toPosix(rootIdentity), toPosix(deps.fs.normalizeBundleTargetIdentity(target)))
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_OWNERSHIP,
      'Packaged schemas or the local schema target cannot be safely resolved.',
      'Provide the packaged builder schema directory and a real, non-escaping workspace.',
    );
  }
  const packages = deps.fs.readdir(source).sort();
  if (
    !packages.includes('allocation') ||
    !packages.includes('plan') ||
    !packages.includes('impl-guide')
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Required packaged Builder schemas are missing.',
      'Install a complete local harness package; no home or registry schema fallback is used.',
    );
  }
  const staged: string[] = [];
  try {
    deps.fs.mkdirp(target);
    for (const name of packages) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
      const from = posixJoin(source, name);
      const destination = posixJoin(target, name);
      if (deps.fs.exists(destination)) continue;
      const files = deps.fs.listRegularFilesNoFollow(from);
      if (files === null || !files.includes('schema.json')) {
        return builderFailure(
          ErrorCodes.BUILDER_INVALID,
          `Invalid packaged schema: ${name}`,
          'Restore the regular, complete packaged schema directory.',
        );
      }
      const temp = deps.fs.createSiblingTempDir(destination, '.builder-schema-');
      try {
        for (const file of files) {
          const bytes = deps.fs.readBytesNoFollow(posixJoin(from, file));
          if (bytes === null) throw new Error(`Cannot read packaged schema file ${file}`);
          const output = posixJoin(temp, file);
          deps.fs.mkdirp(posixDirname(output));
          deps.fs.writeBytes(output, bytes);
        }
        deps.fs.publishDirectoryExclusive(temp, destination, `builder-schema-${name}`);
        staged.push(name);
      } finally {
        if (deps.fs.exists(temp)) deps.fs.removeDir(temp);
      }
    }
    return { ok: true, value: staged };
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      `Schema staging refused: ${String(error)}`,
      'Inspect the local package or concurrent publisher, then retry; existing schema packages remain untouched.',
      { staged },
    );
  }
}

/** Bootstrap inputs are drafts, not readiness/proof. Only the guide CLI authors its guide. */
export function stageBuilderPlanAssets(
  deps: BuilderDeps,
  planInput: string,
): BuilderResult<string[]> {
  const planPath = resolveInRepo(planInput, deps.repoRoot);
  const planDir = posixDirname(planPath);
  const templates = deps.templatesDir === undefined ? null : deps.fs.realpath(deps.templatesDir);
  if (templates === null)
    return builderFailure(
      ErrorCodes.BUILDER_NOT_READY,
      'Packaged Builder templates are unavailable.',
      'Provide the locally packaged Builder templates directory; no home or network fallback is used.',
    );
  const plan = readBuilderDocument(deps, planPath, 'builder/plan');
  if (!plan.ok) return plan;
  const meta = plan.value.value.sections.find((section) => section.name === 'meta');
  if (
    meta === undefined ||
    meta.value === null ||
    typeof meta.value !== 'object' ||
    Array.isArray(meta.value)
  )
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'The plan metadata is not an object.',
      'Repair the canonical plan metadata through the plan owner.',
    );
  const metadata = meta.value as Record<string, unknown>;
  const backlink = 'assets/backpressure.dd.json#rows';
  if (metadata.backpressure !== undefined && metadata.backpressure !== backlink)
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      'The plan already links a different backpressure source.',
      'Reconcile the existing survey explicitly; bootstrap never replaces authored survey links.',
    );
  const copies = [
    ['backpressure.template.json', 'assets/backpressure.dd.json'],
    ['coder-packet.template.md', 'assets/team/coder-packet.template.md'],
    ['reviewer-packet.template.md', 'assets/team/reviewer-packet.template.md'],
    ['roles.template.json', 'assets/team/model-settings.template.json'],
  ] as const;
  const staged: string[] = [];
  try {
    for (const [name, relative] of copies) {
      const target = posixJoin(planDir, relative);
      const identity = toPosix(deps.fs.normalizeBundleTargetIdentity(target));
      const root = deps.fs.realpath(deps.repoRoot);
      if (root === null || !isWithin(toPosix(root), identity))
        return builderFailure(
          ErrorCodes.BUILDER_OWNERSHIP,
          `Bootstrap destination escapes the workspace: ${target}`,
          'Restore the original asset directory; do not follow an escaping ancestor symlink.',
        );
      if (deps.fs.exists(target)) {
        const existing = deps.fs.readTextFileNoFollow(deps.repoRoot, target, 4 * 1024 * 1024);
        if (existing.status !== 'ok')
          return builderFailure(
            ErrorCodes.BUILDER_CONFLICT,
            `Existing bootstrap asset is unsafe or unreadable: ${target}`,
            'Inspect the authored asset without overwriting it.',
          );
        continue;
      }
      const source = deps.fs.readTextFileNoFollow(
        templates,
        posixJoin(templates, name),
        4 * 1024 * 1024,
      );
      if (source.status !== 'ok')
        return builderFailure(
          ErrorCodes.BUILDER_NOT_READY,
          `Required packaged template is unavailable: ${name}`,
          'Restore the complete local package and retry this allocation; existing assets remain intact.',
        );
      if (name === 'backpressure.template.json') {
        const doc = parse(source.text);
        if (Array.isArray(doc) || doc.dd.schema !== 'builder/backpressure')
          return builderFailure(
            ErrorCodes.BUILDER_INVALID,
            'The packaged backpressure template is not a canonical survey document.',
            'Repair the packaged template; never publish malformed or invented proof.',
          );
        const written = writeBuilderDocument(deps, target, doc);
        if (!written.ok) return written;
      } else {
        deps.fs.mkdirp(posixDirname(target));
        if (!deps.fs.createExclusive(target, source.text))
          return builderFailure(
            ErrorCodes.BUILDER_CONFLICT,
            `Bootstrap asset was concurrently created: ${target}`,
            'Re-read the asset before retrying; no existing content was overwritten.',
          );
      }
      staged.push(target);
    }
    const survey = readBuilderDocument(
      deps,
      posixJoin(planDir, 'assets/backpressure.dd.json'),
      'builder/backpressure',
    );
    if (!survey.ok) return survey;
    if (metadata.backpressure === undefined) {
      const updated = {
        ...plan.value.value,
        sections: plan.value.value.sections.map((section) =>
          section === meta
            ? { ...section, value: { ...metadata, backpressure: backlink } }
            : section,
        ),
      };
      const written = writeBuilderDocument(deps, planPath, updated, {
        expectedSha256: plan.value.ref.sha256,
      });
      if (!written.ok) return written;
    }
    return { ok: true, value: staged };
  } catch (error) {
    return builderFailure(
      ErrorCodes.BUILDER_CONFLICT,
      `Bootstrap staging interrupted: ${String(error)}`,
      'Repair the failure and retry; existing survey, guide and templates are never overwritten.',
      { staged },
    );
  }
}
