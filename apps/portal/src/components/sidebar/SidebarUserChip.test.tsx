import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

vi.mock('./SidebarContext', () => ({
  useSidebar: () => ({
    collapsed: false,
    toggle: () => {},
    setCollapsed: () => {},
    forceCollapsed: false,
  }),
}));

vi.mock('./SidebarCollapseToggle', () => ({
  SidebarCollapseToggle: () => <button type="button" aria-label="Collapse sidebar" />,
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    me: {
      user: {
        id: 'user-1',
        email: 'test@example.com',
        full_name: 'Test User',
        is_active: true,
        is_superuser: false,
        is_verified: true,
        active_organization_id: 'org-1',
      },
      active_organization_id: 'org-1',
      memberships: [],
    },
    activeMembership: {
      organization_id: 'org-1',
      organization_name: 'Acme Construction',
      organization_status: 'active',
      member_status: 'active',
      is_org_admin: true,
      seat_limit: 10,
      seat_count_used: 3,
    },
  }),
}));

import { SidebarUserChip } from './SidebarUserChip';

describe('SidebarUserChip', () => {
  it('renders English user name and role', () => {
    render(
      <IntlWrapper locale="en">
        <SidebarUserChip />
      </IntlWrapper>,
    );

    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('Acme Construction · Admin')).toBeInTheDocument();
  });

  it('renders Dutch user name and role', () => {
    render(
      <IntlWrapper locale="nl">
        <SidebarUserChip />
      </IntlWrapper>,
    );

    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('Acme Construction · Beheerder')).toBeInTheDocument();
  });
});
