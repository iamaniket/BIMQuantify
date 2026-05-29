// Settings for the PDF (DocumentViewer) toolbar — kept entirely separate
// from `viewerSettings.ts` so changes to one cannot affect the other.

const STORAGE_KEY = 'bimstitch.documentSettings.v1';

/** Logical actions the PDF viewer exposes. */
export type DocumentAction =
  | 'zoomIn'
  | 'zoomOut'
  | 'fitPage'
  | 'fitWidth'
  | 'actualSize'
  | 'rotateRight'
  | 'rotateLeft'
  | 'nextPage'
  | 'prevPage'
  | 'firstPage'
  | 'lastPage'
  | 'toolSelect'
  | 'toolPan'
  | 'toolZoom';

/** Pre-defined mouse gestures we surface in the settings UI. */
export type DocumentMouseGesture =
  | 'wheel+Ctrl' // already non-rebindable in v1, listed for transparency
  | 'click:middle'
  | 'click:left' // active when Pan tool / Zoom tool is selected
  | 'click:Alt+left';

export type DocumentShortcutMap = Partial<Record<DocumentAction, string>>;
export type DocumentMouseBindingMap = Partial<Record<DocumentMouseGesture, DocumentAction | 'pan' | 'zoomIn' | 'zoomOut' | 'none'>>;

export type DocumentSettings = {
  pageBackground: string; // CSS colour applied behind the page canvas
  shortcuts: DocumentShortcutMap;
  mouseBindings: DocumentMouseBindingMap;
};

export const DEFAULT_DOCUMENT_SHORTCUTS: DocumentShortcutMap = {
  zoomIn: '+',
  zoomOut: '-',
  fitPage: '0',
  fitWidth: 'W',
  actualSize: '1',
  rotateRight: 'R',
  rotateLeft: 'Shift+R',
  nextPage: 'ArrowRight',
  prevPage: 'ArrowLeft',
  firstPage: 'Home',
  lastPage: 'End',
  toolSelect: 'V',
  toolPan: 'H',
  toolZoom: 'Z',
};

export const DEFAULT_DOCUMENT_MOUSE_BINDINGS: DocumentMouseBindingMap = {
  'wheel+Ctrl': 'zoomIn', // semantic: zoom; direction follows wheel sign
  'click:middle': 'pan',
  'click:left': 'pan', // tool-gated inside DocumentViewer
  'click:Alt+left': 'zoomOut',
};

export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = {
  pageBackground: '#f3f4f6',
  shortcuts: DEFAULT_DOCUMENT_SHORTCUTS,
  mouseBindings: DEFAULT_DOCUMENT_MOUSE_BINDINGS,
};

function mergeWithDefaults(p: Partial<DocumentSettings>): DocumentSettings {
  const d = DEFAULT_DOCUMENT_SETTINGS;
  return {
    pageBackground: p.pageBackground ?? d.pageBackground,
    shortcuts: { ...d.shortcuts, ...(p.shortcuts ?? {}) },
    mouseBindings: { ...d.mouseBindings, ...(p.mouseBindings ?? {}) },
  };
}

export function loadDocumentSettings(): DocumentSettings {
  if (typeof window === 'undefined') return DEFAULT_DOCUMENT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_DOCUMENT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<DocumentSettings>;
    return mergeWithDefaults(parsed);
  } catch {
    return DEFAULT_DOCUMENT_SETTINGS;
  }
}

export function saveDocumentSettings(settings: DocumentSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage can throw (quota, private mode); silently ignore.
  }
}

/** Same key-combo grammar as the IFC keyboard plugin: `Ctrl+Shift+Alt+Meta+key`. */
export function comboFromKeyboardEvent(ev: KeyboardEvent): string {
  const ordered: string[] = [];
  if (ev.ctrlKey) ordered.push('Ctrl');
  if (ev.altKey) ordered.push('Alt');
  if (ev.shiftKey) ordered.push('Shift');
  if (ev.metaKey) ordered.push('Meta');
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(ev.key)) return '';
  let { key } = ev;
  if (key === ' ') key = 'Space';
  if (key === '+' || key === '=') key = '+';
  if (key.length === 1) key = key.toUpperCase();
  ordered.push(key);
  return ordered.join('+');
}

/**
 * i18n key suffixes for action labels, resolved at React render sites under
 * the `viewer.documentSettings.action.*` namespace. Storing keys (not literals)
 * keeps this module free of `useTranslations`.
 */
export const DOCUMENT_ACTION_LABEL_KEYS: Record<DocumentAction, string> = {
  zoomIn: 'action.zoomIn',
  zoomOut: 'action.zoomOut',
  fitPage: 'action.fitPage',
  fitWidth: 'action.fitWidth',
  actualSize: 'action.actualSize',
  rotateRight: 'action.rotateRight',
  rotateLeft: 'action.rotateLeft',
  nextPage: 'action.nextPage',
  prevPage: 'action.prevPage',
  firstPage: 'action.firstPage',
  lastPage: 'action.lastPage',
  toolSelect: 'action.toolSelect',
  toolPan: 'action.toolPan',
  toolZoom: 'action.toolZoom',
};
