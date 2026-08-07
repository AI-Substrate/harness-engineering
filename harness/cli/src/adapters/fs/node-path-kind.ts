import { lstatSync } from 'node:fs';
import type { PathKind, PathKindPort } from './path-kind-port.js';

/** Real `lstat` classification — never dereferences the final component. */
export class NodePathKind implements PathKindPort {
  kindNoFollow(path: string): PathKind {
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) return 'symlink';
      if (stat.isDirectory()) return 'directory';
      if (stat.isFile()) return 'file';
      return 'unknown';
    } catch (err) {
      // ENOENT is the only "nothing here" answer. Anything else (EACCES on a
      // parent, an I/O error) means we could not look — which is not the same
      // as looking and finding nothing, and must never be reported as such.
      return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT' ? 'absent' : 'unknown';
    }
  }
}
