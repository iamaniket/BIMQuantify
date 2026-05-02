import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

vi.mock('./SidebarContext', () => ({
  useSidebar: () => ({ collapsed: false, toggle: () => {}, setCollapsed: () => {} }),
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ tokens: null, setTokens: vi.fn(), hasHydrated: true }),
}));

vi.mock('@bimstitch/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { SidebarUserChip } from './SidebarUserChip';

describe('SidebarUserChip', () => {
  it('renders English labels when locale is en', () => {
    render(
      <IntlWrapper locale="en">
        <SidebarUserChip />
      </IntlWrapper>,
    );

    expect(screen.getByText('Wkb inspector · Admin')).toBeInTheDocument();
  });

  it('renders Dutch labels when locale is nl', () => {
    render(
      <IntlWrapper locale="nl">
        <SidebarUserChip />
      </IntlWrapper>,
    );

    expect(screen.getByText('Wkb-inspecteur · Beheerder')).toBeInTheDocument();
  });
});
