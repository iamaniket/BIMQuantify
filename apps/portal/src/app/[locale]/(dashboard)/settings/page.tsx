'use client';

import { Check, Monitor, Moon, SlidersHorizontal, Sun, UserRound } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { useLocale, useTranslations } from 'next-intl';

import {
  getLocaleLabel,
  isLocale,
  supportedLocales,
  type Locale,
} from '@bimstitch/i18n';

import { Button, Card, CardBody, CardHeader, PageHeader } from '@bimstitch/ui';

import { usePathname, useRouter } from '@/i18n/navigation';

type ThemeOption = {
  value: 'light' | 'dark' | 'system';
  label: string;
  description: string;
  icon: typeof Sun;
};

type PlaceholderSetting = {
  title: string;
  description: string;
};

export default function SettingsPage(): JSX.Element {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const locale = useLocale() as Locale;
  const t = useTranslations('settings');
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);

  const setLocale = (nextLocale: Locale): void => {
    if (!isLocale(nextLocale) || nextLocale === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });
    });
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedTheme = mounted ? (theme ?? 'system') : 'system';
  const selectedLanguage = getLocaleLabel(locale);

  const themeOptions: ThemeOption[] = [
    {
      value: 'light',
      label: t('themeOptions.lightLabel'),
      description: t('themeOptions.lightDescription'),
      icon: Sun,
    },
    {
      value: 'dark',
      label: t('themeOptions.darkLabel'),
      description: t('themeOptions.darkDescription'),
      icon: Moon,
    },
    {
      value: 'system',
      label: t('themeOptions.systemLabel'),
      description: t('themeOptions.systemDescription'),
      icon: Monitor,
    },
  ];

  const accountSettings: PlaceholderSetting[] = [
    {
      title: t('placeholders.profileDetailsTitle'),
      description: t('placeholders.profileDetailsDescription'),
    },
    {
      title: t('placeholders.securityTitle'),
      description: t('placeholders.securityDescription'),
    },
  ];

  const userSettings: PlaceholderSetting[] = [
    {
      title: t('placeholders.viewerDefaultsTitle'),
      description: t('placeholders.viewerDefaultsDescription'),
    },
    {
      title: t('placeholders.notificationsTitle'),
      description: t('placeholders.notificationsDescription'),
    },
    {
      title: t('placeholders.workspaceBehaviorTitle'),
      description: t('placeholders.workspaceBehaviorDescription'),
    },
  ];

  const activeThemeLabel = mounted
    ? selectedTheme === 'system'
      ? `${t('themeOptions.systemLabel')} (${resolvedTheme === 'dark' ? t('themeOptions.darkLabel').toLowerCase() : t('themeOptions.lightLabel').toLowerCase()} active)`
      : selectedTheme.charAt(0).toUpperCase() + selectedTheme.slice(1)
    : t('loadingThemePreference');

  return (
    <main className="w-full overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        actions={(
          <div className="flex flex-wrap gap-2">
            <div className="rounded-full border border-border bg-background px-3 py-1 text-caption font-medium text-foreground-secondary">
              {t('activeTheme', { theme: activeThemeLabel })}
            </div>
            <div className="rounded-full border border-border bg-background px-3 py-1 text-caption font-medium text-foreground-secondary">
              {t('activeLanguage', { language: selectedLanguage })}
            </div>
          </div>
        )}
        className="mb-6"
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="border-border/80">
          <CardHeader className="gap-2 border-b border-border/80 pb-4">
            <div className="flex items-center gap-2 text-foreground">
              <SlidersHorizontal className="h-5 w-5 text-primary" />
              <h2 className="text-body1 font-semibold">{t('appearanceTitle')}</h2>
            </div>
            <p className="text-body2 text-foreground-secondary">
              {t('appearanceDescription')}
            </p>
          </CardHeader>
          <CardBody className="gap-4 py-5">
            <div className="grid gap-3 md:grid-cols-3">
              {themeOptions.map(({ value, label, description, icon: Icon }) => {
                const isActive = mounted && selectedTheme === value;

                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setTheme(value); }}
                    className={`flex min-h-36 flex-col rounded-xl border p-4 text-left transition-colors ${
                      isActive
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border bg-background hover:border-border-hover hover:bg-background-secondary'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-background-secondary text-foreground">
                        <Icon className="h-5 w-5" />
                      </div>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white">
                          <Check className="h-3.5 w-3.5" />
                          {t('selected')}
                        </span>
                      )}
                    </div>
                    <div className="mt-5 space-y-2">
                      <div className="text-body1 font-semibold text-foreground">{label}</div>
                      <p className="text-body2 text-foreground-secondary">{description}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl border border-dashed border-border bg-background-secondary/60 p-4">
              <div className="text-body2 font-semibold text-foreground">{t('plannedAppearanceTitle')}</div>
              <p className="mt-1 text-body2 text-foreground-secondary">
                {t('plannedAppearanceDescription')}
              </p>
            </div>

            <div className="rounded-xl border border-border bg-background-secondary/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-body2 font-semibold text-foreground">{t('languageTitle')}</div>
                  <p className="mt-1 text-body2 text-foreground-secondary">{t('languageDescription')}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {supportedLocales.map((option) => {
                  const isActive = locale === option;
                  const label = getLocaleLabel(option);

                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => { setLocale(option); }}
                      className={`flex min-h-28 flex-col rounded-xl border p-4 text-left transition-colors ${
                        isActive
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-border bg-background hover:border-border-hover hover:bg-background'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-body1 font-semibold text-foreground">{label}</div>
                        {isActive && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white">
                            <Check className="h-3.5 w-3.5" />
                            {t('selected')}
                          </span>
                        )}
                      </div>
                      <p className="mt-3 text-body2 text-foreground-secondary">{t('languageHelper')}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-6">
          <Card className="border-border/80">
            <CardHeader className="gap-2 border-b border-border/80 pb-4">
              <div className="flex items-center gap-2 text-foreground">
                <UserRound className="h-5 w-5 text-primary" />
                <h2 className="text-body1 font-semibold">{t('accountTitle')}</h2>
              </div>
              <p className="text-body2 text-foreground-secondary">
                {t('accountDescription')}
              </p>
            </CardHeader>
            <CardBody className="gap-3 py-5">
              {accountSettings.map(({ title, description }) => (
                <div key={title} className="rounded-xl border border-border bg-background-secondary/60 p-4">
                  <div className="text-body2 font-semibold text-foreground">{title}</div>
                  <p className="mt-1 text-body2 text-foreground-secondary">{description}</p>
                </div>
              ))}
              <Button type="button" variant="border" className="self-start" disabled>
                {t('accountButton')}
              </Button>
            </CardBody>
          </Card>

          <Card className="border-border/80">
            <CardHeader className="gap-2 border-b border-border/80 pb-4">
              <h2 className="text-body1 font-semibold text-foreground">{t('roadmapTitle')}</h2>
              <p className="text-body2 text-foreground-secondary">
                {t('roadmapDescription')}
              </p>
            </CardHeader>
            <CardBody className="gap-3 py-5">
              {userSettings.map(({ title, description }) => (
                <div key={title} className="rounded-xl border border-border bg-background p-4">
                  <div className="text-body2 font-semibold text-foreground">{title}</div>
                  <p className="mt-1 text-body2 text-foreground-secondary">{description}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </main>
  );
}