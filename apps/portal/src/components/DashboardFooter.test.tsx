import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

// next-intl's createNavigation pulls in `next/navigation`, which isn't fully
// resolvable under happy-dom — stub Link with a plain anchor.
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { DashboardFooter } from './DashboardFooter';

describe('DashboardFooter', () => {
  it('renders English legal links', () => {
    render(
      <IntlWrapper locale="en">
        <DashboardFooter />
      </IntlWrapper>,
    );

    expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
      'href',
      '/legal/privacy',
    );
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      '/legal/terms',
    );
    expect(screen.getByRole('link', { name: 'DPA' })).toHaveAttribute(
      'href',
      '/legal/dpa',
    );
  });

  it('renders Dutch labels', () => {
    render(
      <IntlWrapper locale="nl">
        <DashboardFooter />
      </IntlWrapper>,
    );

    expect(screen.getByRole('link', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voorwaarden' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Verwerkersovereenkomst' }),
    ).toBeInTheDocument();
  });
});
