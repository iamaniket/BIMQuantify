'use client';

import { Bell, CheckCheck } from 'lucide-react';
import type { JSX } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@bimstitch/ui';

import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from '@/features/notifications/useNotifications';

import { useSidebar } from './SidebarContext';

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ago`;
}

export function SidebarNotifications(): JSX.Element {
  const { collapsed } = useSidebar();
  const { data: unreadData } = useUnreadCount();
  const { data: notifData } = useNotifications();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const unreadCount = unreadData === undefined ? 0 : unreadData.count;
  const notifications = notifData === undefined ? [] : notifData.items;

  const bellButton = (
    <button
      type="button"
      className={`relative flex items-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white ${
        collapsed
          ? 'mx-auto h-9 w-9 justify-center'
          : 'w-full gap-2.5 px-2.5 py-2 text-body3 font-medium'
      }`}
    >
      <Bell className="h-[1.3rem] w-[1.3rem] shrink-0 text-white/55" />
      {!collapsed && <span>Notifications</span>}
      {unreadCount > 0 && (
        <span
          className={`flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white ${
            collapsed
              ? 'absolute -right-0.5 -top-0.5 h-4 min-w-4 px-1'
              : 'ml-auto h-5 min-w-5 px-1.5'
          }`}
        >
          {unreadCount > 99 ? '99+' : String(unreadCount)}
        </span>
      )}
    </button>
  );

  return (
    <div className={`border-t border-white/12 ${collapsed ? 'px-2 py-2' : 'px-3 py-2'}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{bellButton}</TooltipTrigger>
              <TooltipContent side="right">
                Notifications{unreadCount > 0 ? ` (${String(unreadCount)})` : ''}
              </TooltipContent>
            </Tooltip>
          ) : (
            bellButton
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="right"
          align="end"
          sideOffset={8}
          className="w-80 max-h-96 overflow-y-auto"
        >
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  markAllRead.mutate();
                }}
                className="flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {notifications.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            notifications.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="flex flex-col items-start gap-1 py-2.5"
                onSelect={() => {
                  if (!n.is_read) {
                    markRead.mutate(n.id);
                  }
                }}
              >
                <div className="flex w-full items-start gap-2">
                  {!n.is_read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{n.title}</div>
                    <div className="text-xs text-muted-foreground">{n.body}</div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatTimeAgo(n.created_at)}
                  </span>
                </div>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
