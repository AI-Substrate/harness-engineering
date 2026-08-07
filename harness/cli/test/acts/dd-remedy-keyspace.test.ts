import { describe, expect, it } from 'vitest';
import { DD_REMEDIES, type DdRemedyKey, discriminatorOf } from '../../src/acts/dd/shared.js';
import type { DdIssueClass } from '../../src/services/dd/core/validate.js';
import type {
  DdLinkIssueClass,
  DdLinkUnresolvedReason,
} from '../../src/services/dd/links/model.js';

/**
 * The DECLARED-IRREGULARITIES control for the merged remedy key space.
 *
 * `discriminatorOf` answers `issue.reason ?? issue.class`, which merges two key
 * namespaces that were never designed to share one. That is the right shape —
 * re-keying the mapper on `class` would collapse all nine resolution failures
 * into `link-unresolved` and hand three working acts ONE remedy where they get
 * nine — but it is not a free shape. Both hazards are live, and they run in
 * OPPOSITE directions:
 *
 * | shape | instance |
 * |---|---|
 * | **collision** — one key, two concepts | `schema-unresolvable` |
 * | **duplication** — one concept, two keys | `malformed`/`address-malformed`, `path-escape`/`address-path-escape` |
 *
 * Neither is hypothetical and neither was eyeballed: the intersections are
 * COMPUTED below from the unions themselves. This file's job is to hold the
 * merged space to exactly the irregularities someone decided to accept — a NEW
 * collision, or a new twin, is a finding, not a fact of life.
 *
 * **Rejected alternative, recorded so it is not re-proposed**: auto-stripping the
 * `address-` prefix collapses the twins and creates no new collisions today
 * (checked — `address-*` stems ∩ reasons = exactly the two twins below). It was
 * rejected because it is an implicit rule that always returns something, which is
 * precisely the hazard `?? issue.class` already introduces. A declared table of
 * two irregularities beats a silent rule that happens to be right today.
 */

/**
 * The unions, at runtime.
 *
 * `satisfies Record<…, true>` is the load-bearing half: the compiler refuses this
 * object if a member is missing OR extra, so these lists cannot drift from the
 * types they mirror — a new class or reason fails the build here, before it can
 * quietly widen the merged key space unobserved.
 */
const ISSUE_CLASSES = {
  'address-malformed': true,
  'address-path-absolute': true,
  'address-path-escape': true,
  'address-path-non-posix': true,
  'address-target-missing': true,
  'address-target-untracked': true,
  'basis-stale': true,
  'duplicate-id': true,
  'enum-invalid': true,
  'human-skipped-receipt-required': true,
  'id-invalid': true,
  'link-type-mismatch': true,
  'schema-shape': true,
  'schema-unresolvable': true,
  'state-note-required': true,
} satisfies Record<DdIssueClass, true>;

const LINK_CLASSES = {
  'adapter-gap': true,
  'link-scan-failed': true,
  'link-scan-incomplete': true,
  'link-unresolved': true,
} satisfies Record<DdLinkIssueClass, true>;

const UNRESOLVED_REASONS = {
  'file-unreadable': true,
  'id-not-found': true,
  malformed: true,
  'no-base-document': true,
  'not-a-container': true,
  'part-unknown': true,
  'path-escape': true,
  'schema-unresolvable': true,
  'section-unknown': true,
} satisfies Record<DdLinkUnresolvedReason, true>;

const issueClasses = Object.keys(ISSUE_CLASSES) as DdIssueClass[];
const linkClasses = Object.keys(LINK_CLASSES) as DdLinkIssueClass[];
const reasons = Object.keys(UNRESOLVED_REASONS) as DdLinkUnresolvedReason[];

/**
 * IRREGULARITY 1 — identical keys: one key reached from two namespaces, answered
 * by ONE deliberately shared remedy.
 */
const DECLARED_SHARED: readonly DdRemedyKey[] = ['schema-unresolvable'];

/**
 * IRREGULARITY 2 — twinned keys: ONE concept wearing two names, because dd-core
 * prefixes what the links layer does not. Both must resolve to the same remedy
 * TEXT: a remedy on one twin and none on its twin is FX013 again, one layer down,
 * manufactured by the fix for FX013.
 */
const DECLARED_TWINS: ReadonlyArray<readonly [DdRemedyKey, DdRemedyKey]> = [
  ['malformed', 'address-malformed'],
  ['path-escape', 'address-path-escape'],
];

function intersect<A extends string, B extends string>(a: A[], b: B[]): string[] {
  const right = new Set<string>(b);
  return a.filter((key) => right.has(key)).sort();
}

describe('dd remedy key space — exactly the declared irregularities', () => {
  it('answers every key in the merged space, and only those keys', () => {
    const merged = new Set<string>([...issueClasses, ...linkClasses, ...reasons]);
    expect(Object.keys(DD_REMEDIES).sort()).toEqual([...merged].sort());
  });

  it('has exactly the declared COLLISIONS — one key, two concepts', () => {
    // Computed, not eyeballed. A new class named after an existing reason (or the
    // reverse) shows up here as an undeclared collision.
    expect(intersect(issueClasses, reasons)).toEqual([...DECLARED_SHARED].sort());
    // The other two relations are declared EMPTY, and are asserted so a collision
    // that appears there is a finding rather than a silent merge.
    expect(intersect(issueClasses, linkClasses)).toEqual([]);
    expect(intersect(linkClasses, reasons)).toEqual([]);
  });

  it('has exactly the declared TWINS — one concept, two keys', () => {
    const merged = new Set<string>([...issueClasses, ...linkClasses, ...reasons]);
    // A twin is a prefixed key whose STEM is itself a live key: `address-x` and
    // `x` are then two names for one concept, reported by two layers.
    const found = [...merged]
      .filter((key) => key.startsWith('address-') && merged.has(key.slice('address-'.length)))
      .map((key) => [key.slice('address-'.length), key] as const)
      .sort((a, b) => a[1].localeCompare(b[1]));
    expect(found).toEqual([...DECLARED_TWINS].sort((a, b) => a[1].localeCompare(b[1])));
  });

  it('answers BOTH halves of every declared twin, with the same remedy text', () => {
    for (const [stem, prefixed] of DECLARED_TWINS) {
      expect(DD_REMEDIES[stem], `${stem} must carry a remedy`).toBeTruthy();
      expect(DD_REMEDIES[prefixed], `${prefixed} must carry a remedy`).toBeTruthy();
      expect(
        DD_REMEDIES[prefixed],
        `${prefixed} and ${stem} are the same failure reported by two layers`,
      ).toBe(DD_REMEDIES[stem]);
    }
  });

  it('keeps every SHARED key subject-neutral', () => {
    // `core/validate.ts` resolves THIS document's schema; `links/resolver.ts`
    // resolves the TARGET's. Same resolver, same failure, different subject — so
    // a remedy that names either subject is silently wrong for the other.
    for (const key of DECLARED_SHARED) {
      const remedy = DD_REMEDIES[key];
      expect(remedy, `${key} must carry a remedy`).toBeTruthy();
      expect(remedy, `${key} is reached from two subjects — it may name neither`).not.toMatch(
        /\bthis document\b|\bthe target(?:'s| document)?\b|\bthe linked\b/i,
      );
    }
  });

  it('routes a reason-bearing finding by REASON and a bare finding by CLASS', () => {
    // The normalisation itself, pinned: the nine-way remedies the links acts get
    // today survive only while `reason` wins over `class`.
    expect(
      discriminatorOf({
        class: 'link-unresolved',
        severity: 'ERROR',
        location: '$',
        message: 'x',
        owner: '$',
        reason: 'malformed',
      }),
    ).toBe('malformed');
    expect(
      discriminatorOf({
        class: 'link-scan-failed',
        severity: 'WARN',
        location: '$',
        message: 'x',
        owner: '$',
      }),
    ).toBe('link-scan-failed');
    expect(
      discriminatorOf({
        class: 'address-target-untracked',
        severity: 'WARN',
        location: '$',
        message: 'x',
        owner: '$',
      }),
    ).toBe('address-target-untracked');
  });
});
