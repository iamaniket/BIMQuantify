'use client';

import { Sun } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type JSX } from 'react';

const HC_KEY = 'bimdossier.highContrast';

export function HighContrastToggle(): JSX.Element {
  const t = useTranslations('inspection.accessibility');
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(HC_KEY) === 'true') {
      setActive(true);
      document.documentElement.setAttribute('data-high-contrast', 'true');
    }
  }, []);

  const toggle = useCallback(() => {
    const next = !active;
    setActive(next);
    if (next) {
      document.documentElement.setAttribute('data-high-contrast', 'true');
      localStorage.setItem(HC_KEY, 'true');
    } else {
      document.documentElement.removeAttribute('data-high-contrast');
      localStorage.setItem(HC_KEY, 'false');
    }
  }, [active]);

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex min-h-12 min-w-12 items-center justify-center rounded-md p-2 text-foreground-secondary hover:bg-background-secondary"
      aria-label={t('toggleLabel')}
      aria-pressed={active}
    >
      <Sun className="h-5 w-5" />
    </button>
  );
}
