declare module 'react' {
  export type ReactNode = unknown;
  export type SetStateAction<S> = S | ((previous: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useEffect(
    effect: () => undefined | (() => void),
    dependencies?: readonly unknown[],
  ): void;
  export function useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T;
  export function useCallback<T>(callback: T, dependencies: readonly unknown[]): T;
  export function memo<T>(component: T): T;
  export function createElement(type: unknown, props: unknown, ...children: unknown[]): unknown;
  const React: { createElement: typeof createElement };
  export default React;
}

declare module 'react/jsx-runtime' {
  export const Fragment: unknown;
  export function jsx(type: unknown, props: unknown, key?: unknown): JSX.Element;
  export function jsxs(type: unknown, props: unknown, key?: unknown): JSX.Element;
}

declare namespace JSX {
  type Element = unknown;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicAttributes {
    key?: unknown;
  }
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}
