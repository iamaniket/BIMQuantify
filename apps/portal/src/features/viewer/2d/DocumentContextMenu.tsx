'use client';

import { FileBadge, Flag, Paperclip, FrameCorners } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
  type JSX,
} from 'react';

import type { DocumentEvents, DocumentViewerHandle } from '@bimstitch/viewer';

import { prettyKey } from '@/components/shared/viewer/shared/settings/prettyKey';
import type { DocumentShortcutMap } from '@/lib/documentSettings';
import { stashPendingPdfContextPoint } from '@/features/viewer/shared/inspector/pendingPdfContextPoint';

type ContextMenuData = DocumentEvents['contextmenu:open'];

type MenuItem = {
  label: string;
  icon?: JSX.Element;
  action: () => void;
  separator?: boolean;
  shortcut?: string | undefined;
};

type Props = {
  handle: DocumentViewerHandle | null;
  onRequestInspector: (view: 'attachments' | 'findings' | 'certificates') => void;
  shortcuts?: DocumentShortcutMap;
};

const ICON_CLASS = 'h-4 w-4 shrink-0 text-foreground-secondary';

// ---------------------------------------------------------------------------
// Menu item row
// ---------------------------------------------------------------------------

function MenuItemRow({
  item,
}: {
  item: MenuItem;
}): JSX.Element {
  if (item.separator) {
    return <div className="my-1 h-px bg-border" />;
  }

  return (
    <button
      type="button"
      onClick={item.action}
      className={
        'flex w-full items-center gap-3 rounded px-3 py-1.5 text-left text-sm '
        + 'text-foreground hover:bg-background-secondary'
      }
    >
      {item.icon ?? <span className="h-4 w-4 shrink-0" />}
      <span className="flex-1">{item.label}</span>
      {item.shortcut ? (
        <kbd className="ml-auto shrink-0 font-sans text-[11px] text-foreground-tertiary">
          {item.shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Positioned wrapper
// ---------------------------------------------------------------------------

const PositionedMenu = forwardRef(function PositionedMenu(
  {
    x,
    y,
    items,
  }: {
    x: number;
    y: number;
    items: MenuItem[];
  },
  ref: ForwardedRef<HTMLDivElement>,
): JSX.Element {
  const innerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const parent = el.parentElement;
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const menuW = el.offsetWidth;
    const menuH = el.offsetHeight;

    let left = x;
    let top = y;

    if (left + menuW > parentRect.width) {
      left = Math.max(0, parentRect.width - menuW);
    }
    if (top + menuH > parentRect.height) {
      top = Math.max(0, parentRect.height - menuH);
    }

    setPos({ left, top });
    setReady(true);
  }, [x, y]);

  return (
    <div
      ref={(node) => {
        (innerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      className={
        'pointer-events-auto absolute min-w-[200px] rounded-lg border border-border bg-background p-1 shadow-2xl '
        + (ready ? 'opacity-100' : 'opacity-0')
      }
      style={{ left: pos.left, top: pos.top }}
    >
      {items.map((item, i) => (
        <MenuItemRow
          key={item.label || `sep-${String(i)}`}
          item={item}
        />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function DocumentContextMenu({ handle, onRequestInspector, shortcuts }: Props): JSX.Element | null {
  const t = useTranslations('viewer.docContextMenu');
  const [menu, setMenu] = useState<ContextMenuData | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sc = useCallback(
    (action: keyof DocumentShortcutMap): string | undefined => {
      const combo = shortcuts?.[action];
      return combo ? prettyKey(combo) : undefined;
    },
    [shortcuts],
  );

  useEffect(() => {
    if (!handle) return undefined;

    const offOpen = handle.events.on('contextmenu:open', (data) => {
      setMenu(data);
    });

    const offClose = handle.events.on('contextmenu:close', () => {
      setMenu(null);
    });

    return () => {
      offOpen();
      offClose();
    };
  }, [handle]);

  // Close menu when clicking outside of it
  useEffect(() => {
    if (!menu || !handle) return undefined;

    const onOutsideClick = (ev: MouseEvent): void => {
      const el = menuRef.current;
      if (el && !el.contains(ev.target as Node)) {
        handle.commands.execute('contextMenu.close').catch(() => undefined);
      }
    };

    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [menu, handle]);

  const closeMenu = useCallback(() => {
    handle?.commands.execute('contextMenu.close').catch(() => undefined);
  }, [handle]);

  const stashPoint = useCallback(() => {
    if (menu?.pagePoint) {
      stashPendingPdfContextPoint({ page: menu.page, x: menu.pagePoint.x, y: menu.pagePoint.y });
    }
  }, [menu]);

  const items = useMemo((): MenuItem[] => {
    if (!menu) return [];

    return [
      {
        label: t('addFindings'),
        icon: <Flag className={ICON_CLASS} />,
        shortcut: sc('addFinding'),
        action: () => {
          stashPoint();
          onRequestInspector('findings');
          closeMenu();
        },
      },
      {
        label: t('attach'),
        icon: <Paperclip className={ICON_CLASS} />,
        shortcut: sc('addAttachment'),
        action: () => {
          stashPoint();
          onRequestInspector('attachments');
          closeMenu();
        },
      },
      {
        label: t('viewCertificates'),
        icon: <FileBadge className={ICON_CLASS} />,
        shortcut: sc('viewCertificates'),
        action: () => {
          stashPoint();
          onRequestInspector('certificates');
          closeMenu();
        },
      },
      { label: '', separator: true, action: () => undefined },
      {
        label: t('fitPage'),
        icon: <FrameCorners className={ICON_CLASS} />,
        shortcut: sc('fitPage'),
        action: () => {
          handle?.fitPage();
          closeMenu();
        },
      },
    ];
  }, [t, menu, handle, closeMenu, onRequestInspector, sc, stashPoint]);

  if (!menu) return null;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-30">
      <PositionedMenu
        ref={menuRef}
        x={menu.position.x}
        y={menu.position.y}
        items={items}
      />
    </div>
  );
}
