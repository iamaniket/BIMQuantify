export type KeyDef = {
  code: string;
  label: string;
  width: number | undefined;
  isModifier: boolean | undefined;
  isSpacer: boolean | undefined;
};

function k(
  code: string,
  label: string,
  extra: {
    width: number | undefined;
    isModifier: boolean | undefined;
    isSpacer: boolean | undefined;
  } = { width: undefined, isModifier: undefined, isSpacer: undefined },
): KeyDef {
  return { code, label, ...extra };
}

const DEFAULTS = {
  width: undefined as number | undefined,
  isModifier: undefined as boolean | undefined,
  isSpacer: undefined as boolean | undefined,
};
const W = (w: number): typeof DEFAULTS => ({
  ...DEFAULTS,
  width: w,
});
const MOD = (w: number): typeof DEFAULTS => ({
  ...DEFAULTS,
  width: w,
  isModifier: true,
});
const SPACER = (w: number): typeof DEFAULTS => ({
  ...DEFAULTS,
  width: w,
  isSpacer: true,
});

export const KEY_UNIT = 30;
export const KEY_GAP = 2;

// Every row sums to 19u so the board is flush.
export const KEYBOARD_ROWS: KeyDef[][] = [
  // Row 0 — function row
  [
    k('Escape', 'Esc'),
    k('', '', SPACER(1.5)),
    k('F1', 'F1'),
    k('F2', 'F2'),
    k('F3', 'F3'),
    k('F4', 'F4'),
    k('', '', SPACER(0.5)),
    k('F5', 'F5'),
    k('F6', 'F6'),
    k('F7', 'F7'),
    k('F8', 'F8'),
    k('', '', SPACER(0.5)),
    k('F9', 'F9'),
    k('F10', 'F10'),
    k('F11', 'F11'),
    k('F12', 'F12'),
    k('', '', SPACER(0.5)),
    k('PrintScreen', 'PrtSc'),
    k('ScrollLock', 'ScrLk'),
    k('Pause', 'Pause'),
  ],
  // Row 1 — number row + nav
  [
    k('Backquote', '`'),
    k('Digit1', '1'),
    k('Digit2', '2'),
    k('Digit3', '3'),
    k('Digit4', '4'),
    k('Digit5', '5'),
    k('Digit6', '6'),
    k('Digit7', '7'),
    k('Digit8', '8'),
    k('Digit9', '9'),
    k('Digit0', '0'),
    k('Minus', '-'),
    k('Equal', '='),
    k('Backspace', 'Bksp', W(2)),
    k('', '', SPACER(1)),
    k('Insert', 'Ins'),
    k('Home', 'Home'),
    k('PageUp', 'PgUp'),
  ],
  // Row 2 — QWERTY + nav
  [
    k('Tab', 'Tab', W(1.5)),
    k('KeyQ', 'Q'),
    k('KeyW', 'W'),
    k('KeyE', 'E'),
    k('KeyR', 'R'),
    k('KeyT', 'T'),
    k('KeyY', 'Y'),
    k('KeyU', 'U'),
    k('KeyI', 'I'),
    k('KeyO', 'O'),
    k('KeyP', 'P'),
    k('BracketLeft', '['),
    k('BracketRight', ']'),
    k('Backslash', '\\', W(1.5)),
    k('', '', SPACER(1)),
    k('Delete', 'Del'),
    k('End', 'End'),
    k('PageDown', 'PgDn'),
  ],
  // Row 3 — home row
  [
    k('CapsLock', 'Caps', W(1.75)),
    k('KeyA', 'A'),
    k('KeyS', 'S'),
    k('KeyD', 'D'),
    k('KeyF', 'F'),
    k('KeyG', 'G'),
    k('KeyH', 'H'),
    k('KeyJ', 'J'),
    k('KeyK', 'K'),
    k('KeyL', 'L'),
    k('Semicolon', ';'),
    k('Quote', "'"),
    k('Enter', 'Enter', W(2.25)),
    k('', '', SPACER(4)),
  ],
  // Row 4 — shift row + arrow up
  [
    k('ShiftLeft', 'Shift', MOD(2.25)),
    k('KeyZ', 'Z'),
    k('KeyX', 'X'),
    k('KeyC', 'C'),
    k('KeyV', 'V'),
    k('KeyB', 'B'),
    k('KeyN', 'N'),
    k('KeyM', 'M'),
    k('Comma', ','),
    k('Period', '.'),
    k('Slash', '/'),
    k('ShiftRight', 'Shift', MOD(2.75)),
    k('', '', SPACER(2)),
    k('ArrowUp', '↑'),
    k('', '', SPACER(1)),
  ],
  // Row 5 — bottom row + arrows
  [
    k('ControlLeft', 'Ctrl', MOD(1.25)),
    k('MetaLeft', 'Win', MOD(1.25)),
    k('AltLeft', 'Alt', MOD(1.25)),
    k('Space', 'Space', W(6.25)),
    k('AltRight', 'Alt', MOD(1.25)),
    k('MetaRight', 'Win', MOD(1.25)),
    k('ContextMenu', 'Menu', MOD(1.25)),
    k('ControlRight', 'Ctrl', MOD(1.25)),
    k('', '', SPACER(1)),
    k('ArrowLeft', '←'),
    k('ArrowDown', '↓'),
    k('ArrowRight', '→'),
  ],
];

export const FROW_GAP = 7;

export function codeToComboKey(code: string): string {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad')) return code;
  const map: Record<string, string> = {
    Escape: 'Escape',
    Tab: 'Tab',
    CapsLock: 'CapsLock',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    MetaLeft: 'Meta',
    MetaRight: 'Meta',
    ContextMenu: 'ContextMenu',
    Space: 'Space',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Backquote: '`',
    Minus: '-',
    Equal: '+',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    PrintScreen: 'PrintScreen',
    ScrollLock: 'ScrollLock',
    Pause: 'Pause',
    F1: 'F1',
    F2: 'F2',
    F3: 'F3',
    F4: 'F4',
    F5: 'F5',
    F6: 'F6',
    F7: 'F7',
    F8: 'F8',
    F9: 'F9',
    F10: 'F10',
    F11: 'F11',
    F12: 'F12',
  };
  return map[code] ?? code;
}
