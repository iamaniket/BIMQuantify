import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/settings',
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('./SidebarContext', () => ({
  useSidebar: () => ({ collapsed: false, toggle: () => {}, setCollapsed: () => {} }),
}));

vi.mock('@bimstitch/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { SidebarNav } from './SidebarNav';

describe('SidebarNav', () => {
  it('renders English labels when locale is en', () => {
    render(
      <IntlWrapper locale="en">
        <SidebarNav />
      </IntlWrapper>,
    );

    expect(screen.getByText('Admin console')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Help & docs')).toBeInTheDocument();
  });

  it('renders Dutch labels when locale is nl', () => {
    render(
      <IntlWrapper locale="nl">
        <SidebarNav />
      </IntlWrapper>,
    );

    expect(screen.getByText('Beheerconsole')).toBeInTheDocument();
    expect(screen.getByText('Instellingen')).toBeInTheDocument();
    expect(screen.getByText('Hulp en documentatie')).toBeInTheDocument();
  });
});
