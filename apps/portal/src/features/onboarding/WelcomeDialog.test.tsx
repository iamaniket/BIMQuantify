import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
}));

import { WelcomeDialog } from './WelcomeDialog';

describe('WelcomeDialog', () => {
  it('greets an admin by org name and lists only admin capabilities (EN)', () => {
    render(
      <IntlWrapper locale="en">
        <WelcomeDialog open orgName="Acme BV" isAdmin onClose={() => {}} />
      </IntlWrapper>,
    );

    expect(screen.getByText('Welcome to Acme BV')).toBeInTheDocument();
    expect(
      screen.getByText("You've joined as an administrator. Here's how to get started:"),
    ).toBeInTheDocument();
    expect(screen.getByText('Manage your team and invite colleagues')).toBeInTheDocument();
    // member-only capability must not leak into the admin view
    expect(screen.queryByText("View your organization's projects")).not.toBeInTheDocument();
  });

  it('lists member capabilities and Dutch copy for a member', () => {
    render(
      <IntlWrapper locale="nl">
        <WelcomeDialog open orgName="Beta NV" isAdmin={false} onClose={() => {}} />
      </IntlWrapper>,
    );

    expect(screen.getByText('Welkom bij Beta NV')).toBeInTheDocument();
    expect(screen.getByText('Bekijk de projecten van je organisatie')).toBeInTheDocument();
    // admin subtitle must not show for a member
    expect(
      screen.queryByText('Je bent toegevoegd als beheerder. Zo ga je aan de slag:'),
    ).not.toBeInTheDocument();
  });

  it('navigates to /projects and closes when "Get started" is clicked', () => {
    const onClose = vi.fn();
    render(
      <IntlWrapper locale="en">
        <WelcomeDialog open orgName="Acme BV" isAdmin onClose={onClose} />
      </IntlWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/projects');
  });
});
