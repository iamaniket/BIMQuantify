'use client';

import { RotateCcw, X } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useRef,
  useState,
  type JSX,
} from 'react';

import {
  Button, Tabs, TabsContent, TabsList, TabsTrigger,
} from '@bimstitch/ui';

import {
  comboFromKeyboardEvent,
  DEFAULT_DOCUMENT_SETTINGS,
  DOCUMENT_ACTION_LABEL_KEYS,
  saveDocumentSettings,
  type DocumentAction,
  type DocumentSettings,
} from '@/lib/documentSettings';

import { ColorField, Section } from '@/components/shared/viewer/shared/settings/primitives';

type Props = {
  settings: DocumentSettings;
  onSettingsChange: (next: DocumentSettings) => void;
  onClose: () => void;
};

const ACTION_ORDER: DocumentAction[] = [
  'zoomIn',
  'zoomOut',
  'fitPage',
  'fitWidth',
  'actualSize',
  'rotateRight',
  'rotateLeft',
  'nextPage',
  'prevPage',
  'firstPage',
  'lastPage',
  'toolSelect',
  'toolPan',
  'toolZoom',
];

function ShortcutsSection({
  settings,
  onChange,
}: {
  settings: DocumentSettings;
  onChange: (next: DocumentSettings) => void;
}): JSX.Element {
  const t = useTranslations('viewer.documentSettings');
  const [capturing, setCapturing] = useState<DocumentAction | null>(null);

  useEffect(() => {
    if (capturing === null) return undefined;
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopPropagation();
      const combo = comboFromKeyboardEvent(ev);
      if (combo === '' || combo === 'Escape') {
        setCapturing(null);
        return;
      }
      onChange({
        ...settings,
        shortcuts: { ...settings.shortcuts, [capturing]: combo },
      });
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  return (
    <Section title={t('keyboardShortcuts')} note={t('noteLive')}>
      <ul
        className="max-h-64 space-y-1 overflow-y-auto"
        data-testid="document-settings-shortcuts"
      >
        {ACTION_ORDER.map((action) => {
          const combo = settings.shortcuts[action] ?? '';
          return (
            <li
              key={action}
              className="flex items-center justify-between gap-2 text-caption"
            >
              <span className="truncate text-foreground-secondary">
                {t(DOCUMENT_ACTION_LABEL_KEYS[action])}
              </span>
              <button
                type="button"
                onClick={() => { setCapturing(action); }}
                className="min-w-[5rem] rounded border border-border px-2 py-0.5 font-sans text-foreground hover:bg-background-secondary"
              >
                {capturing === action ? t('pressKey') : combo || '—'}
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function MouseSection(): JSX.Element {
  const t = useTranslations('viewer.documentSettings');
  const rows: { gesture: string; action: string }[] = [
    { gesture: t('gesture.ctrlWheel'), action: t('gesture.actionZoomCursor') },
    { gesture: t('gesture.middleDrag'), action: t('gesture.actionPan') },
    { gesture: t('gesture.leftDragPan'), action: t('gesture.actionPan') },
    { gesture: t('gesture.leftClickZoom'), action: t('gesture.actionZoomInCursor') },
    { gesture: t('gesture.altLeftClickZoom'), action: t('gesture.actionZoomOutCursor') },
    { gesture: t('gesture.doubleClick'), action: t('gesture.actionFitPage') },
  ];

  return (
    <Section title={t('mouseBindings')} note={t('noteBuiltIn')}>
      <ul
        className="max-h-64 space-y-1 overflow-y-auto"
        data-testid="document-settings-mouse"
      >
        {rows.map((r) => (
          <li
            key={r.gesture}
            className="flex items-center justify-between gap-2 text-caption"
          >
            <span className="truncate font-sans text-foreground-secondary">
              {r.gesture}
            </span>
            <span className="text-foreground">{r.action}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function DocumentSettingsPopover({
  settings,
  onSettingsChange,
  onClose,
}: Props): JSX.Element {
  const t = useTranslations('viewer.documentSettings');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (ev: MouseEvent): void => {
      const node = ref.current;
      if (!node) return;
      if (!node.contains(ev.target as Node)) onClose();
    };
    const onEsc = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const update = (next: DocumentSettings): void => {
    saveDocumentSettings(next);
    onSettingsChange(next);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('ariaLabel')}
      data-testid="document-settings-popover"
      className="absolute bottom-12 left-1/2 z-20 w-[26rem] -translate-x-1/2 rounded-md border border-border bg-background p-4 shadow-lg"
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-body2 font-medium text-foreground">{t('title')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('closeSettings')}
          className="inline-flex h-8 w-8 items-center justify-center rounded text-foreground-secondary hover:bg-background-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Tabs defaultValue="general">
        <TabsList className="shrink-0">
          <TabsTrigger value="general" className="flex-1 text-caption">
            {t('tabGeneral')}
          </TabsTrigger>
          <TabsTrigger value="keyboard" className="flex-1 text-caption">
            {t('tabKeyboard')}
          </TabsTrigger>
          <TabsTrigger value="mouse" className="flex-1 text-caption">
            {t('tabMouse')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="max-h-[24rem] overflow-y-auto">
          <div className="space-y-4 pt-3">
            <Section title={t('pageBackground')}>
              <ColorField
                label={t('pageBackgroundColor')}
                value={settings.pageBackground}
                onChange={(hex) => {
                  update({ ...settings, pageBackground: hex });
                }}
              />
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="keyboard" className="max-h-[24rem] overflow-y-auto">
          <div className="space-y-4 pt-3">
            <ShortcutsSection settings={settings} onChange={update} />
          </div>
        </TabsContent>

        <TabsContent value="mouse" className="max-h-[24rem] overflow-y-auto">
          <div className="space-y-4 pt-3">
            <MouseSection />
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <Button
          variant="ghost"
          size="md"
          onClick={() => {
            update(DEFAULT_DOCUMENT_SETTINGS);
          }}
          className="text-caption text-foreground-secondary"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {('resetDefaults')}
        </Button>
      </div>
    </div>
  );
}
