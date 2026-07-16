declare module 'picomatch' {
  export interface PicomatchOptions {
    dot?: boolean;
  }

  export type PicomatchMatcher = (input: string) => boolean;

  export default function picomatch(
    globs: string | readonly string[],
    options?: PicomatchOptions,
  ): PicomatchMatcher;
}
