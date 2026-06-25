'use client';

import { Eye, Flag, Glasses, Search } from '@bimdossier/ui/icons';
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
import { useShallow } from 'zustand/react/shallow';

import type { ItemId, ViewerHandle, ViewerEvents } from '@bimdossier/viewer';

import { prettyKey } from '@/components/shared/viewer/shared/settings/prettyKey';
import { useViewerEntityStore } from '@/stores/viewerEntityStore';

import { PENDING_ELEMENT_POINT_KEY } from '../shared/inspector/pendingElementPoint';

type ContextMenuData = ViewerEvents['contextmenu:open'];

type MenuItem = {
  label: string;
  icon?: JSX.Element;
  command?: string;
  /** When set, the clicked element is selected before the command runs. */
  targetItem?: ItemId;
  /** Pretty-printed shortcut combo shown on the trailing edge. */
  shortcut?: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean;
};

type Props = {
  handle: ViewerHandle | null;
  viewerReady: boolean | undefined;
};

const ICON_CLASS = 'h-4 w-4 shrink-0 text-foreground-secondary';

/** Dashed-circle isolation glyph, same as the model-tree's TreeRow. */
function IsolateIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={ICON_CLASS}
    >
      <circle cx="8" cy="8" r="5.5" strokeDasharray="3 2" />
      <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shortcut lookup — fetches bindings once on menu open
// ---------------------------------------------------------------------------

type ShortcutMap = Map<string, string>;

function useShortcutMap(handle: ViewerHandle | null, ready?: boolean): ShortcutMap {
  const [map, setMap] = useState<ShortcutMap>(new Map());

  useEffect(() => {
    if (!handle) return;
    handle.commands
      .execute<Array<{ combo: string; command: string }>>('shortcuts.list')
      .then((list) => {
        const m = new Map<string, string>();
        for (const b of list) m.set(b.command, b.combo);
        setMap(m);
      })
      .catch(() => undefined);
    // `ready` triggers re-query after viewer rebuild
  }, [handle, ready]);

  return map;
}

// ---------------------------------------------------------------------------
// Build the grouped menu
// ---------------------------------------------------------------------------

function buildMenu(
  t: ReturnType<typeof useTranslations>,
  shortcuts: ShortcutMap,
  hasSelection: boolean,
  isAllSelected: boolean,
  hasHidden: boolean,
  hasXray: boolean,
  item: ContextMenuData['item'],
): MenuItem[] {
  const hasItem = item !== null;
  const sc = (cmd: string): string | undefined => {
    const combo = shortcuts.get(cmd);
    return combo ? prettyKey(combo) : undefined;
  };

  return [
    // ── Group 1: Inspect (item-scoped) ──────────────────────────────
    hasItem
      ? {
          label: t('inspectProperties'),
          icon: <Search className={ICON_CLASS} />,
          command: 'inspect.properties',
          targetItem: item,
          shortcut: sc('inspect.properties'),
        }
      : null,
    hasItem
      ? {
          label: t('addFindings'),
          icon: <Flag className={ICON_CLASS} />,
          command: 'inspect.findings',
          targetItem: item,
          shortcut: sc('inspect.findings'),
        }
      : null,
    hasItem ? { label: '', separator: true } : null,

    // ── Group 2: Visibility ─────────────────────────────────────────
    hasHidden
      ? { label: t('showAll'), icon: <Eye className={ICON_CLASS} />, command: 'visibility.showAll', shortcut: sc('visibility.showAll') }
      : { label: t('hideAll'), icon: <Eye className={ICON_CLASS} />, command: 'visibility.hideAll', shortcut: sc('visibility.hideAll') },
    hasItem
      ? { label: t('hide'), icon: <Eye className={ICON_CLASS} />, command: 'visibility.hide', targetItem: item, shortcut: sc('visibility.hide') }
      : null,
    hasItem
      ? { label: t('isolate'), icon: <IsolateIcon />, command: 'visibility.isolate', targetItem: item, shortcut: sc('visibility.isolate') }
      : null,
    { label: '', separator: true },

    // ── Group 3: X-Ray (whole-model toggle) ─────────────────────────
    {
      label: hasXray ? t('clearXray') : t('xrayAll'),
      icon: <Glasses className={ICON_CLASS} />,
      command: 'xray.toggleAll',
      shortcut: sc('xray.toggleAll'),
    },
    { label: '', separator: true },

    // ── Group 4: Selection ──────────────────────────────────────────
    !isAllSelected
      ? { label: t('selectAll'), command: 'selection.selectAll', shortcut: sc('selection.selectAll') }
      : null,
    hasSelection
      ? { label: t('clearSelection'), command: 'selection.clear', shortcut: sc('selection.clear') }
      : null,
    hasSelection && !isAllSelected
      ? { label: t('invertSelection'), command: 'selection.invert', shortcut: sc('selection.invert') }
      : null,
  ].filter(Boolean) as MenuItem[];
}

// ---------------------------------------------------------------------------
// Menu item row
// ---------------------------------------------------------------------------

function MenuItemRow({
  item,
  onCommand,
}: {
  item: MenuItem;
  onCommand: (cmd: string, targetItem?: ItemId) => void;
}): JSX.Element {
  if (item.separator) {
    return <div className="my-1 h-px bg-border" />;
  }

  const isDisabled = item.disabled === true;

  const handleClick = (): void => {
    if (isDisabled) return;
    if (item.action) {
      item.action();
    } else if (item.command) {
      onCommand(item.command, item.targetItem);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      className={
        'flex w-full items-center gap-3 rounded px-3 py-1.5 text-left text-sm '
        + (isDisabled
          ? 'cursor-not-allowed bg-background-tertiary text-foreground-disabled'
          : 'text-foreground hover:bg-background-secondary')
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
    onCommand,
  }: {
    x: number;
    y: number;
    items: MenuItem[];
    onCommand: (cmd: string, targetItem?: ItemId) => void;
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
          onCommand={onCommand}
        />
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function ContextMenu({ handle, viewerReady }: Props): JSX.Element | null {
  const t = useTranslations('viewer.contextMenu');
  const [menu, setMenu] = useState<ContextMenuData | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Derived from the canonical entity store (kept in sync with the viewer by
  // useViewerBridge) — no separate event-subscription shadow. Shape preserved
  // so the menu-item enablement below reads unchanged.
  const viewerState = useViewerEntityStore(
    useShallow((s) => ({
      selectionCount: s.selectedAll ? Number.MAX_SAFE_INTEGER : s.selected.size,
      hasHidden: s.hidden.size > 0,
      hasXray: s.xrayed.size > 0,
      isIsolated: s.isolationActive,
    })),
  );
  const shortcuts = useShortcutMap(handle, viewerReady);

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
    // `viewerReady` triggers re-subscription after viewer rebuild (events.clear)
  }, [handle, viewerReady]);

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

  const runCommand = useCallback(
    (cmd: string, targetItem?: ItemId) => {
      if (!handle) return;
      // Item-scoped rows: select the target first so the command reads
      // it from the selection, then execute the command.
      if (targetItem) {
        handle.commands.execute('selection.set', targetItem).catch(() => undefined);
      }
      // Anchor handoff: when the user opens an attach/finding/certificate flow
      // from a 3D pick, stash the world-space point so the inspector body can
      // anchor the new item to it (linked_file_type='ifc' + {x,y,z}). Mirrors
      // the PDF pin handoff. Consumed (removed) at upload time.
      if (cmd.startsWith('inspect.') && menu?.point) {
        const { x, y, z } = menu.point;
        sessionStorage.setItem(PENDING_ELEMENT_POINT_KEY, JSON.stringify({ x, y, z }));
      }
      handle.commands.execute(cmd).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(`[context-menu] ${cmd} failed:`, err);
      });
      handle.commands.execute('contextMenu.close').catch(() => undefined);
    },
    [handle, menu],
  );

  const items = useMemo(() => {
    if (!menu) return [];
    return buildMenu(
      t,
      shortcuts,
      viewerState.selectionCount > 0,
      viewerState.selectionCount === Number.MAX_SAFE_INTEGER,
      viewerState.hasHidden || viewerState.isIsolated,
      viewerState.hasXray,
      menu.item,
    );
  }, [t, shortcuts, viewerState, menu]);

  if (!menu) return null;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-30">
      <PositionedMenu
        ref={menuRef}
        x={menu.position.x}
        y={menu.position.y}
        items={items}
        onCommand={runCommand}
      />
    </div>
  );
}
