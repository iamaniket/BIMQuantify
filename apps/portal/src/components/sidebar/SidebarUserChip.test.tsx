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

import { SidebarUserChip } from './SidebarUserChip';

describe('SidebarUserChip', () => {
  it('renders English user name and role', () => {
    render(
      <IntlWrapper locale="en">
        <SidebarUserChip />
      </IntlWrapper>,
    );

    expect(screen.getByText('Lieke Beumer')).toBeInTheDocument();
    expect(screen.getByText('Wkb inspector · Admin')).toBeInTheDocument();
  });

  it('renders Dutch user name and role', () => {
    render(
      <IntlWrapper locale="nl">
        <SidebarUserChip />
      </IntlWrapper>,
    );

    expect(screen.getByText('Lieke Beumer')).toBeInTheDocument();
    expect(screen.getByText('Wkb-inspecteur · Beheerder')).toBeInTheDocument();
  });
});
