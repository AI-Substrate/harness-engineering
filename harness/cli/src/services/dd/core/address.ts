export interface DdAddressSegment {
  kind: 'name' | 'id';
  value: string;
}

export interface DdAddress {
  /** Null means the bare-`#` same-document form. */
  file: string | null;
  segments: DdAddressSegment[];
}

export interface DdAddressFailure {
  class: 'address-malformed';
  location: 'address';
  message: string;
}

const SEGMENT_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;

function malformed(message: string): DdAddressFailure {
  return { class: 'address-malformed', location: 'address', message };
}

export function isAddressFailure(result: DdAddress | DdAddressFailure): result is DdAddressFailure {
  return 'class' in result;
}

/**
 * Parse the locked `file#name/id/name/id...` grammar without resolving any target.
 * Segment kinds are positional hints until P4 resolves optional ids against a schema.
 */
export function parseAddress(raw: string): DdAddress | DdAddressFailure {
  if (raw.includes('@')) return malformed('"@" is reserved and is not part of the v1 grammar');
  const boundary = raw.indexOf('#');
  if (boundary < 0 || boundary !== raw.lastIndexOf('#')) {
    return malformed('address must contain exactly one "#" file/interior boundary');
  }
  const filePart = raw.slice(0, boundary);
  const interior = raw.slice(boundary + 1);
  if (interior.length === 0) return malformed('address interior must not be empty');

  const values = interior.split('/');
  if (values.some((segment) => segment.length === 0)) {
    return malformed('address interior must not contain empty segments');
  }
  const segments: DdAddressSegment[] = [];
  for (const [index, value] of values.entries()) {
    if (!SEGMENT_PATTERN.test(value)) {
      return malformed(
        `segment "${value}" must start with a letter and contain only [A-Za-z0-9._-]`,
      );
    }
    segments.push({ kind: index % 2 === 0 ? 'name' : 'id', value });
  }
  return { file: filePart.length === 0 ? null : filePart, segments };
}

export function formatAddress(address: DdAddress): string {
  return `${address.file ?? ''}#${address.segments.map((segment) => segment.value).join('/')}`;
}

export function normalizeFilePath(raw: string): string {
  const withPosixSeparators = raw.replaceAll('\\', '/');
  const absolute = withPosixSeparators.startsWith('/');
  const stack: string[] = [];
  for (const part of withPosixSeparators.split('/')) {
    if (part.length === 0 || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack.at(-1) !== '..') {
        stack.pop();
      } else if (!absolute) {
        stack.push(part);
      }
      continue;
    }
    stack.push(part);
  }
  return `${absolute ? '/' : ''}${stack.join('/')}`;
}

/** Canonicalize path separators/dot segments; the schema/id interior is unchanged. */
export function normalizeAddress(address: DdAddress): DdAddress {
  return {
    file: address.file === null ? null : normalizeFilePath(address.file),
    segments: address.segments.map((segment) => ({ ...segment })),
  };
}
