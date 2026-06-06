'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type JSX } from 'react';

// Subset of the BeforeInstallPromptEvent interface we use. Chrome/Edge fire
// this; Safari does not — see iosHint fallback below.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISSED_KEY = 'bimstitch.pwaInstallDismissedAt';
const DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

function wasRecentlyDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (raw === null) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari-only flag.
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

export function PwaInstallPrompt(): JSX.Element | null {
  const t = useTranslations('pwaInstall');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return undefined;

    const onPrompt = (e: Event): void => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt as EventListener);

    // iOS Safari never fires beforeinstallprompt — show the share-icon hint
    // after a short idle delay so we don't compete with the first paint.
    let iosTimer: number | null = null;
    if (isIosSafari()) {
      iosTimer = window.setTimeout(() => {
        setIosHint(true);
        setVisible(true);
      }, 3000);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt as EventListener);
      if (iosTimer !== null) window.clearTimeout(iosTimer);
    };
  }, []);

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // ignore — private mode or storage disabled
    }
    setVisible(false);
    setDeferredPrompt(null);
    setIosHint(false);
  };

  const install = async (): Promise<void> => {
    if (deferredPrompt === null) return;
    await deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setVisible(false);
      setDeferredPrompt(null);
    } else {
      dismiss();
    }
  };

  if (!visible) return null;

  return (
    <div
      data-testid="pwa-install-prompt"
      role="dialog"
      aria-labelledby="pwa-install-title"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-border bg-background p-4 shadow-lg"
    >
      <h2 id="pwa-install-title" className="text-body1 font-semibold text-foreground">
        {t('promptTitle')}
      </h2>
      <p className="mt-1 text-caption text-foreground-secondary">{t('promptBody')}</p>
      {iosHint ? (
        <p className="mt-2 text-caption text-foreground-tertiary">{t('iosHint')}</p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={dismiss}
          data-testid="pwa-install-dismiss"
          className="rounded-md px-3 py-1.5 text-caption text-foreground-secondary hover:bg-foreground/[0.06]"
        >
          {t('dismiss')}
        </button>
        {deferredPrompt !== null ? (
          <button
            type="button"
            onClick={() => { void install(); }}
            data-testid="pwa-install-accept"
            className="rounded-md bg-primary px-3 py-1.5 text-caption font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('install')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
