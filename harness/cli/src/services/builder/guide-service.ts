import { parse } from '@ai-substrate/dd';
import { ErrorCodes } from '../../output/error-codes.js';
import {
  posixDirname,
  posixJoin,
  posixNormalize,
  posixRelative,
  resolveInRepo,
} from '../shared/posix-path.js';
import { builderOwnsPath, ownershipWarnings } from './ownership-service.js';
import {
  builderContext,
  builderFailure,
  readBuilderDocument,
  writeBuilderDocument,
} from './records.js';
import type {
  BuilderDeps,
  BuilderIssue,
  BuilderResult,
  Guide,
  GuideCheckReport,
  GuideInput,
  OwnershipWarning,
} from './types.js';

/** Loading proves DD shape and document identity, not architectural or delivery readiness. */
export function readBuilderGuide(deps: BuilderDeps, input: GuideInput): BuilderResult<Guide> {
  const context = builderContext(deps, input.plan);
  if (!context.ok) return context;
  const { planPath, guidePath } = context.value;
  const plan = readBuilderDocument(deps, planPath, 'builder/plan');
  if (!plan.ok) return plan;
  if (input.init && !deps.fs.exists(guidePath)) {
    if (!deps.templatesDir?.trim())
      return builderFailure(
        ErrorCodes.BUILDER_RUNTIME,
        'Guide initialization requires the packaged templatesDir capability.',
        'Provide BuilderDeps.templatesDir pointing to the packaged Builder templates, then retry guide --init.',
      );
    const templateDir = resolveInRepo(deps.templatesDir, deps.repoRoot);
    const templatePath = posixJoin(templateDir, 'impl-guide.template.json');
    const template = deps.fs.readTextFileNoFollow(templateDir, templatePath, 4 * 1024 * 1024);
    if (template.status !== 'ok')
      return builderFailure(
        ErrorCodes.BUILDER_RUNTIME,
        `Packaged guide template is unavailable: ${templatePath} (${template.reason}).`,
        'Restore a readable regular impl-guide.template.json inside the explicit templatesDir; no fallback guide was created.',
      );
    const doc = parse(template.text);
    if (Array.isArray(doc) || doc.dd.schema !== 'builder/impl-guide')
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        'The packaged guide template is not a builder/impl-guide document.',
        'Repair the packaged impl-guide.template.json before initializing a guide.',
        Array.isArray(doc) ? doc : undefined,
      );
    if (new Set(doc.sections.map((section) => section.name)).size !== doc.sections.length)
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        'Packaged guide template sections must be unique.',
        'Remove duplicate template sections; no guide was created.',
      );
    // Preserve the template's draft declarations; bind only its selected product plan.
    doc.sections = doc.sections.map((section) =>
      section.name === 'meta' &&
      section.value !== null &&
      typeof section.value === 'object' &&
      !Array.isArray(section.value)
        ? {
            ...section,
            value: {
              ...section.value,
              plan: `${posixRelative(posixDirname(guidePath), planPath)}#meta`,
            },
          }
        : section,
    );
    const written = writeBuilderDocument(deps, guidePath, doc);
    if (!written.ok) return written;
  }
  const loaded = readBuilderDocument(deps, guidePath, 'builder/impl-guide');
  if (!loaded.ok) return loaded;
  const sections = loaded.value.value.sections;
  if (new Set(sections.map((section) => section.name)).size !== sections.length) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'Guide sections must be unique.',
      'Remove duplicate guide sections before loading.',
    );
  }
  const guide = Object.fromEntries(
    sections.map(({ name, value }) => [name, value]),
  ) as unknown as Guide;
  const [target, anchor] = guide.meta.plan.split('#');
  if (anchor !== 'meta' || resolveInRepo(target, posixDirname(guidePath)) !== planPath) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'The guide names a different product plan.',
      'Bind guide.meta.plan to the selected plan meta section.',
    );
  }
  return { ok: true, value: guide };
}

function relativePath(path: string, allowRoot = false): boolean {
  for (const character of path) if (character.charCodeAt(0) < 32) return false;
  return (
    !!path.trim() &&
    path === path.trim() &&
    !/[\\*?[\]{}:]/.test(path) &&
    !path.startsWith('/') &&
    !path.split('/').includes('..') &&
    posixNormalize(path) === path &&
    (allowRoot || path !== '.')
  );
}

/** Structural proof only. Responsibility quality and observable semantics require independent review. */
export function checkBuilderGuide(
  guide: Guide,
  planCriteria: readonly { id: string }[],
): GuideCheckReport {
  const issues: BuilderIssue[] = [];
  const warnings: OwnershipWarning[] = [];
  const warn = (
    code: string,
    field: string,
    message: string,
    owner = 'unmapped',
    file?: string,
  ) => {
    warnings.push({
      file: file?.trim() ? file : `<guide:${field}>`,
      owning_unit: owner.trim() || 'unmapped',
      stage: 'guide',
      code,
      message,
      next_action: `Review ${field} with the named unit and update the ownership guidance if useful; this warning does not block work.`,
    });
  };
  const issue = (code: string, path: string, message: string) => {
    issues.push({
      code,
      path,
      message,
      next_action: `Correct ${path} in the implementation guide and repeat the structural check.`,
    });
  };
  const text = (value: string, path: string) => {
    if (!value.trim()) issue('empty', path, 'A substantive declaration is required.');
  };
  const list = (values: readonly string[], path: string) => {
    if (values.length === 0) issue('empty', path, 'At least one declaration is required.');
    for (const [index, value] of values.entries()) text(value, `${path}/${index}`);
  };
  const unique = (ids: readonly string[], path: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (!id.trim() || seen.has(id))
        issue('duplicate-id', path, `Empty or duplicate identity: ${id}`);
      seen.add(id);
    }
  };
  const paths = (values: readonly string[], path: string) => {
    list(values, path);
    unique(values, path);
    for (const value of values)
      if (!relativePath(value)) {
        issue('path', path, `Not a normalized repository-relative path: ${value}`);
      }
  };
  const mapPaths = (values: readonly string[], field: string, owner: string) => {
    if (values.length === 0) warn('map-empty', field, 'No ownership paths are declared.', owner);
    const seen = new Set<string>();
    for (const value of values) {
      const root = value.endsWith('/**')
        ? value.slice(0, -3)
        : value.endsWith('/')
          ? value.slice(0, -1)
          : value;
      if (!relativePath(root))
        warn(
          'map-path',
          field,
          `Not a normalized repository-relative ownership hint: ${value}`,
          owner,
          value,
        );
      if (seen.has(value))
        warn('map-duplicate', field, `Ownership hint is repeated: ${value}`, owner, value);
      seen.add(value);
    }
  };
  const units = new Map(guide.units.map((unit) => [unit.id, unit]));
  const checks = new Set(guide.checks.map((check) => check.id));
  const criteria = new Set(planCriteria.map((criterion) => criterion.id));
  const planFile = guide.meta.plan.split('#')[0];
  const criterionId = (address: string): string | undefined => {
    const [file, anchor, extra] = address.split('#');
    if (extra !== undefined || posixNormalize(file) !== posixNormalize(planFile)) return undefined;
    const match = /^acceptance_criteria\/([^/]+)$/.exec(anchor ?? '');
    return match?.[1];
  };
  const proof = (addresses: readonly string[], path: string) => {
    list(addresses, path);
    unique(addresses, path);
    for (const address of addresses) {
      const [file, anchor, extra] = address.split('#');
      const match = /^checks\/([^/]+)$/.exec(anchor ?? '');
      if (
        extra !== undefined ||
        (file !== '' && posixNormalize(file) !== 'impl-guide.dd.json') ||
        !match ||
        !checks.has(match[1])
      ) {
        issue(
          'unknown-check',
          path,
          `Proof must resolve to a declared check in this guide: ${address}`,
        );
      }
    }
  };
  text(guide.meta.title, 'meta/title');
  if (!Number.isSafeInteger(guide.meta.version) || guide.meta.version < 1)
    issue('version', 'meta/version', 'A positive integer version is required.');
  text(guide.architecture.principles, 'architecture/principles');
  text(guide.architecture.composition_root, 'architecture/composition_root');
  list(guide.architecture.contracts, 'architecture/contracts');
  text(guide.fan_out.rationale, 'fan_out/rationale');
  text(guide.isolation.note, 'isolation/note');
  if (guide.units.length === 0)
    issue('empty', 'units', 'Declare at least one independently owned responsibility.');
  if (guide.checks.length === 0) issue('empty', 'checks', 'Declare executable checks.');
  if (criteria.size === 0)
    issue(
      'empty',
      'capabilities',
      'A guide cannot prove coverage of an empty product acceptance contract.',
    );
  unique(
    guide.units.map((unit) => unit.id),
    'units',
  );
  unique(
    guide.checks.map((check) => check.id),
    'checks',
  );
  unique(
    guide.capabilities.map((capability) => capability.id),
    'capabilities',
  );
  unique(
    planCriteria.map((criterion) => criterion.id),
    'plan/acceptance_criteria',
  );
  for (const check of guide.checks) {
    text(check.description, `checks/${check.id}/description`);
    if (
      !check.command.trim() ||
      check.command.includes('\0') ||
      check.args.some((arg) => arg.includes('\0')) ||
      !relativePath(check.cwd, true) ||
      !Number.isSafeInteger(check.timeout_ms) ||
      check.timeout_ms <= 0
    ) {
      issue(
        'executable-check',
        `checks/${check.id}`,
        'Declare an executable argv, confined cwd and positive timeout.',
      );
    }
  }
  for (const [index, unit] of guide.units.entries()) {
    const at = `units/${unit.id}`;
    text(unit.name, `${at}/name`);
    text(unit.responsibility, `${at}/responsibility`);
    text(unit.interface, `${at}/interface`);
    mapPaths(unit.paths, `${at}/paths`, unit.id);
    proof(unit.proof, `${at}/proof`);
    unique(unit.depends_on, `${at}/depends_on`);
    if (!Number.isSafeInteger(unit.wave) || unit.wave < 0)
      issue('wave', `${at}/wave`, 'Waves must be non-negative integers.');
    for (let previousIndex = 0; previousIndex < index; previousIndex++) {
      const previous = guide.units[previousIndex];
      const overlapping = new Set([
        ...unit.paths.filter((path) => builderOwnsPath(previous, path)),
        ...previous.paths.filter((path) => builderOwnsPath(unit, path)),
      ]);
      for (const path of overlapping) {
        for (const owner of [previous.id, unit.id])
          warn(
            'write-overlap',
            `${at}/paths`,
            `${path} is mapped to both ${previous.id} and ${unit.id}.`,
            owner,
            path,
          );
      }
    }
    for (const dependency of unit.depends_on) {
      const owner = units.get(dependency);
      if (!owner || owner.id === unit.id)
        issue('dependency', `${at}/depends_on`, `Unknown or self dependency: ${dependency}`);
      else if (owner.wave >= unit.wave)
        issue('wave', `${at}/wave`, `Dependency ${dependency} must be in an earlier wave.`);
    }
    for (const [index, read] of unit.reads.entries()) {
      const field = `${at}/reads/${index}`;
      mapPaths(read.paths, `${field}/paths`, read.owner);
      const owner = units.get(read.owner);
      if (!owner || owner.id === unit.id || !unit.depends_on.includes(read.owner)) {
        for (const path of read.paths.length ? read.paths : [undefined])
          warn(
            'read-owner',
            `${field}/owner`,
            `Read owner ${read.owner} is not a different declared dependency.`,
            read.owner,
            path,
          );
      }
      for (const path of read.paths)
        if (!owner || !builderOwnsPath(owner, path))
          warn(
            'read-coverage',
            `${field}/paths`,
            `${read.owner || 'The declared owner'} has no matching map for ${path}.`,
            read.owner,
            path,
          );
    }
    for (const address of unit.acceptance) {
      const id = criterionId(address);
      if (!id || !criteria.has(id))
        issue(
          'unknown-criterion',
          `${at}/acceptance`,
          `Unknown product acceptance criterion: ${address}`,
        );
    }
  }
  // Colour DFS, rather than wave checks alone, also diagnoses cycles with invalid wave declarations.
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) {
      issue('cycle', 'units', `Dependency cycle reaches ${id}.`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of units.get(id)?.depends_on ?? [])
      if (units.has(dependency)) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of units.keys()) visit(id);
  const covered = new Set<string>();
  for (const capability of guide.capabilities) {
    const at = `capabilities/${capability.id}`;
    const id = criterionId(capability.criterion);
    const owner = units.get(capability.owner);
    if (!capability.path.trim())
      warn(
        'capability-path',
        `${at}/path`,
        'The observable capability path is not described.',
        capability.owner,
      );
    proof(capability.proof, `${at}/proof`);
    if (!id || !criteria.has(id))
      issue('unknown-criterion', at, `Unknown product criterion: ${capability.criterion}`);
    else covered.add(id);
    if (!owner)
      warn(
        'capability-owner',
        `${at}/owner`,
        `Observable owner ${capability.owner} does not name a declared implementation unit.`,
        capability.owner,
      );
  }
  for (const id of criteria)
    if (!covered.has(id))
      warn('capability-gap', 'capabilities', `No observable capability declaration covers ${id}.`);
  paths(guide.baseline.files, 'baseline/files');
  proof(guide.baseline.proof, 'baseline/proof');
  if (!relativePath(guide.baseline.receipt) || !guide.baseline.receipt.endsWith('.dd.json'))
    issue(
      'path',
      'baseline/receipt',
      'Use a confined DD record path relative to the guide directory.',
    );
  for (const warning of ownershipWarnings(guide.units, guide.baseline.files, guide.units, 'guide'))
    warn(
      'baseline-owner',
      'baseline/files',
      `No unit maps shared contract file ${warning.file}.`,
      warning.owning_unit,
      warning.file,
    );
  const coders = guide.units.filter((unit) => unit.role === 'coder');
  if (
    (guide.fan_out.decision === 'solo-pm' &&
      (coders.length > 0 || guide.isolation.mode !== 'solo')) ||
    (guide.fan_out.decision === 'coders' &&
      (coders.length === 0 || guide.isolation.mode === 'solo'))
  ) {
    issue(
      'fan-out',
      'fan_out',
      'The solo/coders decision, unit roles and isolation mode disagree.',
    );
  }
  unique(
    guide.roles.map((role) => role.id),
    'roles',
  );
  unique(
    guide.roles.map((role) => role.role),
    'roles',
  );
  for (const role of guide.roles) {
    if (role.role !== 'coder' && role.role !== 'reviewer')
      issue('role', 'roles', `Unknown runtime role: ${role.role}`);
    text(role.harness, `roles/${role.id}/harness`);
    text(role.model, `roles/${role.id}/model`);
    if (role.effort !== undefined) text(role.effort, `roles/${role.id}/effort`);
  }
  const composition = units.get(guide.composition.owner);
  if (composition?.role !== 'pm')
    warn(
      'composition-owner',
      'composition/owner',
      'Composition is not mapped to a declared PM unit.',
      guide.composition.owner,
    );
  list(guide.composition.steps, 'composition/steps');
  proof(guide.composition.proof, 'composition/proof');
  unique(guide.composition.order, 'composition/order');
  const order = new Map(guide.composition.order.map((id, index) => [id, index]));
  for (const id of guide.composition.order) {
    const unit = units.get(id);
    if (unit?.role !== 'coder')
      issue(
        'composition-order',
        'composition/order',
        `Only declared coder deliveries may be imported: ${id}`,
      );
    else
      for (const dependency of unit.depends_on)
        if (
          units.get(dependency)?.role === 'coder' &&
          (order.get(dependency) ?? Infinity) >= (order.get(id) ?? -1)
        ) {
          issue('composition-order', 'composition/order', `${dependency} must precede ${id}.`);
        }
  }
  for (const coder of coders) {
    if (!order.has(coder.id))
      issue('composition-order', 'composition/order', `Missing coder delivery ${coder.id}.`);
    if (
      composition &&
      (!composition.depends_on.includes(coder.id) || composition.wave <= coder.wave)
    )
      warn(
        'composition-wave',
        'composition/owner',
        `The declared composition owner does not follow and depend on ${coder.id}.`,
        composition.id,
      );
  }
  text(guide.review.when, 'review/when');
  list(guide.review.inputs, 'review/inputs');
  list(guide.review.proof, 'review/proof');
  return { valid: issues.length === 0, issues, warnings, architectural_judgement: 'not-performed' };
}
