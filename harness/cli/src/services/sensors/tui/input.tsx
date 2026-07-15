import { useInput, type Key } from 'ink';

export type TuiMode = 'table' | 'detail';
export type TuiInputAction =
  | { type: 'select'; index: number }
  | { type: 'detail' }
  | { type: 'back' }
  | { type: 'older' }
  | { type: 'newer' }
  | { type: 'rerun'; index: number }
  | { type: 'snapshot' }
  | { type: 'rerun-all' }
  | { type: 'clear-rerun' }
  | { type: 'close' }
  | { type: 'quit-request' }
  | { type: 'quit-confirm' }
  | { type: 'none' };

export interface InputRouteState {
  mode: TuiMode;
  selectedIndex: number;
  rowCount: number;
  quitArmed: boolean;
}

export function routeInput(
  input: string,
  key: Pick<Key, 'upArrow' | 'downArrow' | 'leftArrow' | 'rightArrow' | 'return' | 'escape'> &
    Partial<Pick<Key, 'ctrl'>>,
  state: InputRouteState,
): TuiInputAction {
  if (key.ctrl && input === 'c') return { type: 'quit-confirm' };
  if (state.mode === 'detail') {
    if (key.escape) return { type: 'back' };
    if (key.leftArrow) return { type: 'older' };
    if (key.rightArrow) return { type: 'newer' };
    if (input === 'r') return { type: 'rerun', index: state.selectedIndex };
  } else {
    if (key.upArrow && state.rowCount > 0) {
      return {
        type: 'select',
        index: (state.selectedIndex - 1 + state.rowCount) % state.rowCount,
      };
    }
    if (key.downArrow && state.rowCount > 0) {
      return { type: 'select', index: (state.selectedIndex + 1) % state.rowCount };
    }
    if (key.return && state.rowCount > 0) return { type: 'detail' };
    if (/^[1-9]$/.test(input)) {
      const index = Number(input) - 1;
      return index < state.rowCount ? { type: 'rerun', index } : { type: 'none' };
    }
  }
  if (input === 'a') return { type: 'rerun-all' };
  if (input === 's') return { type: 'snapshot' };
  if (input === 'c') return { type: 'clear-rerun' };
  if (input === 'w') return { type: 'close' };
  if (input === 'q') return { type: state.quitArmed ? 'quit-confirm' : 'quit-request' };
  return { type: 'none' };
}

export interface InputRouterProps extends InputRouteState {
  onAction(action: TuiInputAction): void;
}

/** The sole global `useInput` owner; all key semantics route by current mode. */
export function InputRouter({ onAction, ...state }: InputRouterProps) {
  useInput((input, key) => onAction(routeInput(input, key, state)));
  return null;
}
