import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/projects',
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('./SidebarContext', () => ({
  useSidebar: () => ({
    collapsed: false,
    toggle: () => {},
    setCollapsed: () => {},
    forceCollapsed: false,
  }),
}));

vi.mock('@bimstitch/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { SidebarWorkspaceNav } from './SidebarWorkspaceNav';

describe('SidebarWorkspaceNav', () => {
  it('renders English workspace items and the section label', () => {
    render(
      <IntlWrapper locale="en">
        <SidebarWorkspaceNav />
      </IntlWrapper>,
    );

    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('BBL library')).toBeInTheDocument();
    expect(screen.getByText('WKB library')).toBeInTheDocument();
  });

  it('renders Dutch workspace items', () => {
    render(
      <IntlWrapper locale="nl">
        <SidebarWorkspaceNav />
      </IntlWrapper>,
    );

    expect(screen.getByText('Werkruimte')).toBeInTheDocument();
    expect(screen.getByText('Projecten')).toBeInTheDocument();
    expect(screen.getByText('BBL-bibliotheek')).toBeInTheDocument();
    expect(screen.getByText('Wkb-bibliotheek')).toBeInTheDocument();
  });
});
