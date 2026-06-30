import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

const switchOrganizationMock = vi.fn(async () => {});

vi.mock('./SidebarContext', () => ({
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
  Eyebrow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    me: {
      active_organization_id: 'org-1',
      memberships: [
        {
          organization_id: 'org-1',
          organization_name: 'Acme Construction',
          member_status: 'active',
          role: 'owner',
          is_org_admin: true,
          seat_limit: 10,
          seat_count_used: 3,
        },
        {
          organization_id: 'org-2',
          organization_name: 'Beta Builders',
          member_status: 'active',
          role: 'editor',
          is_org_admin: false,
          seat_limit: 25,
          seat_count_used: 8,
        },
      ],
      project_roles: [],
      user: {
        id: 'user-1',
        email: 'test@example.com',
        full_name: 'Test User',
        is_active: true,
        is_superuser: false,
        is_verified: true,
        organization_id: null,
      },
    },
    activeMembership: {
      organization_id: 'org-1',
      organization_name: 'Acme Construction',
      member_status: 'active',
      role: 'owner',
      is_org_admin: true,
      seat_limit: 10,
      seat_count_used: 3,
    },
    switchOrganization: switchOrganizationMock,
    switchToFree: vi.fn(async () => {}),
  }),
}));

import { SidebarTenantCard } from './SidebarTenantCard';

describe('SidebarTenantCard', () => {
  it('renders tenant info and API-backed membership options', () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <IntlWrapper locale="en">
          <SidebarTenantCard />
        </IntlWrapper>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Tenant')).toBeInTheDocument();
    expect(screen.getByText('Acme Construction')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Acme Construction — 3 / 10 seats'));

    expect(screen.getByText('Beta Builders')).toBeInTheDocument();
  });

  it('switches org when selecting a different membership', async () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <IntlWrapper locale="en">
          <SidebarTenantCard />
        </IntlWrapper>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByLabelText('Acme Construction — 3 / 10 seats'));
    fireEvent.click(screen.getByText('Beta Builders'));

    expect(switchOrganizationMock).toHaveBeenCalledWith('org-2');
  });
});
