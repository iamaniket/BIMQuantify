import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

vi.mock('@/features/projects/useProjects', () => ({
  useProjects: () => ({
    data: [{ id: '1' }, { id: '2' }, { id: '3' }],
  }),
}));

vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/projects',
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('@/components/shared/sidebar/SidebarContext', () => ({
  useSidebar: () => ({
    collapsed: false,
    toggle: () => {},
    setCollapsed: () => {},
    forceCollapsed: false,
  }),
}));

vi.mock('@bimdossier/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { SidebarWorkspaceNav } from './SidebarWorkspaceNav';

describe('SidebarWorkspaceNav', () => {
  it('renders English workspace item, section label, and API-backed project count', () => {
    render(
      <IntlWrapper locale="en">
        <SidebarWorkspaceNav />
      </IntlWrapper>,
    );

    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders Dutch workspace item and section label', () => {
    render(
      <IntlWrapper locale="nl">
        <SidebarWorkspaceNav />
      </IntlWrapper>,
    );

    expect(screen.getByText('Werkruimte')).toBeInTheDocument();
    expect(screen.getByText('Projecten')).toBeInTheDocument();
  });
});
