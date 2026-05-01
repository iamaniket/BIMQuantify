'use client';

import { Settings, Shield, HelpCircle } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@bimstitch/ui';

import { useSidebar } from './SidebarContext';

const items = [
  { key: 'admin', label: 'Admin console', icon: Shield },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'help', label: 'Help & docs', icon: HelpCircle },
] as const;

export function SidebarNav(): JSX.Element {
  const { collapsed } = useSidebar();
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-0.5 px-3 pb-1 pt-2">
      {items.map(({ key, label, icon: Icon }) => {
        const isActive = active === key;

        const button = (
          <button
            key={key}
            type="button"
            onClick={() => { setActive(key); }}
            className={`relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-body3 font-medium transition-colors ${
              isActive
                ? 'bg-white/15 font-semibold text-white'
                : 'text-white/80 hover:bg-white/10 hover:text-white'
            } ${collapsed ? 'justify-center px-0' : ''}`}
          >
            {isActive && (
              <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r bg-blue-400" />
            )}
            <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-blue-400' : 'text-white/55'}`} />
            {!collapsed && <span>{label}</span>}
          </button>
        );

        if (collapsed) {
          return (
            <Tooltip key={key}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          );
        }

        return button;
      })}
    </div>
  );
}
