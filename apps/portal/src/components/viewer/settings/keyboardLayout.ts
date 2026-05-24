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

export const KEYBOARD_ROWS: KeyDef[][] = [
  [
    k('Escape', 'Esc', W(1.5)),
    k('', '', SPACER(0.5)),
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
    k('Backspace', 'Bksp', W(1.5)),
  ],
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
  ],
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
  ],
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
  ],
  [
    k('ControlLeft', 'Ctrl', MOD(1.5)),
    k('MetaLeft', 'Win', MOD(1.25)),
    k('AltLeft', 'Alt', MOD(1.25)),
    k('Space', 'Space', W(5.5)),
    k('AltRight', 'Alt', MOD(1.25)),
    k('ControlRight', 'Ctrl', MOD(1.25)),
    k('', '', SPACER(0.5)),
    k('ArrowLeft', '←'),
    k('ArrowUp', '↑'),
    k('ArrowDown', '↓'),
    k('ArrowRight', '→'),
  ],
];

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
    Space: 'Space',
    Enter: 'Enter',
    Backspace: 'Backspace',
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
  };
  return map[code] ?? code;
}
