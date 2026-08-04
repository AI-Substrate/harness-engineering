import { DEFAULT_REL } from './constants.js';
import { isRecord } from './value.js';

/**
 * The reserved field name every list item may carry.
 *
 * The bucket exists so a schema does not have to grow a bespoke field every time
 * an author wants to attach one more edge to one more row. It is a CONVENTION
 * recognised by core, which is why the relation travels in the DATA here rather
 * than on a declared shape — there is no declared shape to hang it on.
 *
 * A schema that declares its own `links` field wins: the convention only fills a
 * hole, it never overrides an explicit declaration.
 */
export const LINKS_BUCKET_FIELD = 'links';

export interface DdBucketLink {
  /** The relation this edge carries; absent means `ref`, exactly as on a declared shape. */
  rel: string;
  /** The address itself. */
  ref: string;
  /** Optional human label, rendered in place of the address's last segment. */
  label?: string;
}

export interface DdBucketProblem {
  location: string;
  message: string;
}

export interface DdBucketReading {
  entries: Array<DdBucketLink & { index: number }>;
  problems: DdBucketProblem[];
}

/**
 * Read an object's links bucket, reporting every malformed entry rather than
 * dropping it.
 *
 * Silence would be the wrong failure mode twice over: a typo'd `rel` key would
 * quietly demote a `satisfies` edge to `ref`, and a missing `ref` would make an
 * edge that a human can see in the JSON invisible to every walker.
 */
export function readLinksBucket(value: unknown, location: string): DdBucketReading {
  const entries: Array<DdBucketLink & { index: number }> = [];
  const problems: DdBucketProblem[] = [];
  if (value === undefined || value === null) return { entries, problems };
  if (!Array.isArray(value)) {
    return {
      entries,
      problems: [{ location, message: 'a links bucket must be an array of {rel, ref} entries' }],
    };
  }
  value.forEach((entry, index) => {
    const at = `${location}[${index}]`;
    // A bare address string is the `ref`-relation shorthand. Accepting it is the
    // same rule the declared side already follows — an undeclared relation IS
    // `ref` — and it keeps the pre-bucket habit of writing a plain list of
    // addresses working rather than silently voiding it.
    if (typeof entry === 'string') {
      if (entry.trim().length === 0) {
        problems.push({ location: at, message: 'a links bucket entry must not be empty' });
        return;
      }
      entries.push({ index, rel: DEFAULT_REL, ref: entry });
      return;
    }
    if (!isRecord(entry)) {
      problems.push({
        location: at,
        message: 'a links bucket entry must be an address or an object',
      });
      return;
    }
    if (typeof entry.ref !== 'string' || entry.ref.trim().length === 0) {
      problems.push({
        location: `${at}.ref`,
        message: 'a links bucket entry needs a "ref" address',
      });
      return;
    }
    if (
      entry.rel !== undefined &&
      (typeof entry.rel !== 'string' || entry.rel.trim().length === 0)
    ) {
      problems.push({
        location: `${at}.rel`,
        message: 'a links bucket "rel" must be a non-empty string',
      });
      return;
    }
    if (entry.label !== undefined && typeof entry.label !== 'string') {
      problems.push({
        location: `${at}.label`,
        message: 'a links bucket "label" must be a string',
      });
      return;
    }
    entries.push({
      index,
      rel: typeof entry.rel === 'string' ? entry.rel : DEFAULT_REL,
      ref: entry.ref,
      ...(typeof entry.label === 'string' && { label: entry.label }),
    });
  });
  return { entries, problems };
}

/** Whether an object carries a populated bucket — the renderer's column predicate. */
export function hasLinksBucket(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value[LINKS_BUCKET_FIELD]) &&
    (value[LINKS_BUCKET_FIELD] as unknown[]).length > 0
  );
}
