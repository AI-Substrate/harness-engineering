import { ErrorCodes } from '../../output/error-codes.js';
import type { ResolvedTree, ResolvedValue } from '../settings/settings.js';
import { builderFailure } from './records.js';
import type { ResolveRoles, RoleBinding } from './types.js';

function branch(tree: ResolvedTree, key: string): ResolvedTree | undefined {
  const value = tree[key];
  return value !== undefined && !('origin' in value) ? (value as ResolvedTree) : undefined;
}

/** Consume the existing settings resolver; governance is repository-owned, not machine-local. */
export const resolveBuilderRoles: ResolveRoles = (settings, guide, overrides = {}) => {
  const builder = branch(settings.governance, 'builder');
  const roles = builder && branch(builder, 'roles');
  if (
    (settings.governance.builder !== undefined && !builder) ||
    (builder?.roles !== undefined && !roles)
  ) {
    return builderFailure(
      ErrorCodes.BUILDER_INVALID,
      'governance.builder.roles must be an object.',
      'Correct repository role settings using the existing settings schema.',
    );
  }
  const resolved: RoleBinding[] = [];
  for (const role of ['coder', 'reviewer'] as const) {
    const repo = roles && branch(roles, role);
    const declarations = guide.roles.filter((profile) => profile.role === role);
    if ((roles?.[role] !== undefined && !repo) || declarations.length > 1) {
      return builderFailure(
        ErrorCodes.BUILDER_INVALID,
        `Ambiguous or malformed ${role} role settings.`,
        'Declare one guide profile per role and object-valued repository role defaults.',
      );
    }
    const values: Partial<Pick<RoleBinding, 'harness' | 'model' | 'effort'>> = {};
    const source: Partial<RoleBinding['source']> = {};
    for (const field of ['harness', 'model', 'effort'] as const) {
      const leaf = repo?.[field];
      if (
        leaf !== undefined &&
        (!('origin' in leaf) || (leaf as ResolvedValue).origin !== 'repo')
      ) {
        return builderFailure(
          ErrorCodes.BUILDER_INVALID,
          `Invalid repository ${role}.${field}.`,
          'Use repository governance settings, not local or synthetic role defaults.',
        );
      }
      const candidates = [
        { value: leaf === undefined ? undefined : (leaf as ResolvedValue).value, origin: 'repo' },
        { value: declarations[0]?.[field], origin: 'guide' },
        { value: overrides[role]?.[field], origin: 'override' },
      ] as const;
      for (const candidate of candidates) {
        if (candidate.value === undefined) continue;
        if (
          typeof candidate.value !== 'string' ||
          candidate.value.trim() === '' ||
          /[\r\n\0]/.test(candidate.value)
        ) {
          return builderFailure(
            ErrorCodes.BUILDER_INVALID,
            `Invalid ${candidate.origin} ${role}.${field}.`,
            'Supply a non-empty exact runtime selector; omit effort rather than inventing a default.',
          );
        }
        values[field] = candidate.value;
        source[field] = candidate.origin;
      }
    }
    if (!values.harness || !values.model || !source.harness || !source.model) {
      return builderFailure(
        ErrorCodes.BUILDER_NOT_READY,
        `Missing harness or model for ${role}.`,
        'Set repository governance.builder.roles, guide roles, or explicit dispatch overrides.',
      );
    }
    resolved.push({
      role,
      harness: values.harness,
      model: values.model,
      ...(values.effort !== undefined && { effort: values.effort }),
      source: {
        harness: source.harness,
        model: source.model,
        ...(source.effort !== undefined && { effort: source.effort }),
      },
    });
  }
  return { ok: true, value: resolved };
};
