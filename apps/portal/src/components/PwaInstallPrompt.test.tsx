import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IntlWrapper } from '@/__tests__/intl-wrapper';

import { PwaInstallPrompt } from './PwaInstallPrompt';

type Outcome = 'accepted' | 'dismissed';

function fakeBeforeInstallPrompt(outcome: Outcome): Event & {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: Outcome }>;
} {
  const ev = new Event('beforeinstallprompt') as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: Outcome }>;
  };
  ev.prompt = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(ev, 'userChoice', {
    value: Promise.resolve({ outcome }),
  });
  return ev;
}

describe('PwaInstallPrompt', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // Force display-mode: browser so isStandalone() returns false.
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays hidden until beforeinstallprompt fires', () => {
    render(
      <IntlWrapper locale="en">
        <PwaInstallPrompt />
      </IntlWrapper>,
    );
    expect(screen.queryByTestId('pwa-install-prompt')).toBeNull();
  });

  it('renders prompt when beforeinstallprompt fires and installs on accept', async () => {
    render(
      <IntlWrapper locale="en">
        <PwaInstallPrompt />
      </IntlWrapper>,
    );

    const ev = fakeBeforeInstallPrompt('accepted');
    await act(async () => {
      window.dispatchEvent(ev);
    });

    expect(screen.getByTestId('pwa-install-prompt')).toBeInTheDocument();
    expect(screen.getByText('Install BIMstitch')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pwa-install-accept'));
    expect(ev.prompt).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByTestId('pwa-install-prompt')).toBeNull();
    });
  });

  it('dismiss button hides the prompt and persists dismissal', async () => {
    render(
      <IntlWrapper locale="en">
        <PwaInstallPrompt />
      </IntlWrapper>,
    );

    const ev = fakeBeforeInstallPrompt('dismissed');
    await act(async () => {
      window.dispatchEvent(ev);
    });

    fireEvent.click(screen.getByTestId('pwa-install-dismiss'));
    expect(screen.queryByTestId('pwa-install-prompt')).toBeNull();
    expect(window.localStorage.getItem('bimstitch.pwaInstallDismissedAt')).not.toBeNull();
  });

  it('stays hidden if a recent dismissal is persisted', async () => {
    window.localStorage.setItem(
      'bimstitch.pwaInstallDismissedAt',
      String(Date.now()),
    );

    render(
      <IntlWrapper locale="en">
        <PwaInstallPrompt />
      </IntlWrapper>,
    );

    const ev = fakeBeforeInstallPrompt('accepted');
    await act(async () => {
      window.dispatchEvent(ev);
    });
    expect(screen.queryByTestId('pwa-install-prompt')).toBeNull();
  });
});
